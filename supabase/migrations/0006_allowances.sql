-- 0006_allowances.sql
-- Allowance rules (versioned), allowance obligations, payment transactions, workflow guards.

create type allowance_eligibility as enum ('not_evaluated', 'eligible', 'not_eligible', 'pending_requirements');
create type allowance_processing as enum (
  'not_evaluated', 'for_validation', 'requirements_incomplete', 'for_approval', 'approved', 'disapproved', 'for_processing', 'ready_for_payment'
);
create type payment_status as enum ('not_yet_paid', 'processing', 'paid', 'partially_paid', 'on_hold', 'returned_failed', 'cancelled');

create table allowance_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  name text not null,
  event_id uuid references examination_events (id),
  position_id uuid references assignment_positions (id),
  personnel_category personnel_category,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'PHP',
  requires_tin boolean not null default true,
  requires_bank_account boolean not null default true,
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  reason text not null check (btrim(reason) <> ''),
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

-- Rules are versioned and immutable: change by adding a new version; only deactivation/end-dating is allowed in place.
create function rules_versioning() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    execute format('select coalesce(max(version), 0) + 1 from %I', tg_table_name) into new.version;
    new.created_by := auth.uid();
    return new;
  end if;
  if (to_jsonb(new) - 'effective_to' - 'active') is distinct from (to_jsonb(old) - 'effective_to' - 'active') then
    raise exception 'Rules are immutable. Create a new version instead.';
  end if;
  return new;
end $$;
create trigger allowance_rules_ver before insert or update on allowance_rules for each row execute function rules_versioning();

create table allowance_records (
  id uuid primary key default gen_random_uuid(),
  record_no text not null unique default gen_code('ALW', 'allowance_no_seq'),
  assignment_id uuid not null unique references assignments (id),
  attendance_id uuid references attendance_records (id),
  event_id uuid not null references examination_events (id),
  volunteer_id uuid references volunteer_profiles (id),
  external_id uuid references external_personnel (id),
  payee_name text not null,
  personnel_category personnel_category not null,
  position_id uuid not null references assignment_positions (id),
  duty_date date not null,
  rule_id uuid references allowance_rules (id),
  rule_version integer,
  approved_amount numeric(12, 2) check (approved_amount is null or approved_amount >= 0),
  currency text not null default 'PHP',
  eligibility_status allowance_eligibility not null default 'not_evaluated',
  processing_status allowance_processing not null default 'not_evaluated',
  payment_status payment_status not null default 'not_yet_paid',
  requirements_note text,
  processed_by uuid references profiles (id),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  payment_date date,
  payment_reference text,
  voucher_ref text,
  remarks text,
  needs_review boolean not null default false,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index allowance_event_idx on allowance_records (event_id);
create index allowance_status_idx on allowance_records (processing_status, payment_status);
create index allowance_vol_idx on allowance_records (volunteer_id);
create index allowance_pos_idx on allowance_records (position_id);
create trigger allowance_touch before update on allowance_records for each row execute function touch_updated_at();

create table allowance_payments (
  id uuid primary key default gen_random_uuid(),
  allowance_id uuid not null references allowance_records (id),
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null,
  reference_no text not null check (btrim(reference_no) <> ''),
  batch_ref text,
  status text not null default 'paid' check (status in ('paid', 'returned')),
  remarks text,
  exception_reason text,
  return_reason text,
  recorded_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  returned_at timestamptz,
  unique (allowance_id, reference_no)
);
create index allowance_payments_idx on allowance_payments (allowance_id);

-- ---------------------------------------------------------------- allowance workflow guard
create function allowances_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  sys boolean := coalesce(current_setting('app.system_action', true), '') = 'on';
  pay_sync boolean := coalesce(current_setting('app.payment_sync', true), '') = 'on';
  can_process boolean := has_permission('allowance.process'); can_approve boolean := has_permission('allowance.approve');
  ok boolean := false; paid numeric; blockers text[];
begin
  if (new.assignment_id, new.event_id, new.volunteer_id, new.external_id, new.position_id, new.duty_date, new.record_no, new.personnel_category)
     is distinct from (old.assignment_id, old.event_id, old.volunteer_id, old.external_id, old.position_id, old.duty_date, old.record_no, old.personnel_category) then
    raise exception 'Allowance identity fields are immutable';
  end if;
  if sys then return new; end if;

  -- amount: editable while still being validated; afterwards only through adjust_allowance_amount()
  if new.approved_amount is distinct from old.approved_amount then
    if coalesce(current_setting('app.amount_adjust', true), '') <> 'on' then
      if old.processing_status not in ('not_evaluated', 'for_validation', 'requirements_incomplete', 'disapproved') or not can_process then
        raise exception 'The approved amount can no longer be edited directly. Use an amount adjustment with a reason.' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.processing_status is distinct from old.processing_status then
    ok := case
      when old.processing_status = 'for_validation' and new.processing_status in ('for_approval', 'requirements_incomplete') then can_process
      when old.processing_status = 'requirements_incomplete' and new.processing_status = 'for_validation' then can_process
      when old.processing_status = 'for_approval' and new.processing_status in ('approved', 'disapproved', 'for_validation') then can_approve
      when old.processing_status = 'disapproved' and new.processing_status = 'for_validation' then can_process
      when old.processing_status = 'approved' and new.processing_status = 'for_processing' then can_process
      when old.processing_status = 'for_processing' and new.processing_status = 'ready_for_payment' then can_process
      else false end;
    if not ok then raise exception 'Transition % -> % is not permitted for this user', old.processing_status, new.processing_status using errcode = '42501'; end if;
    if new.processing_status = 'for_approval' then
      if new.eligibility_status <> 'eligible' or coalesce(new.approved_amount, 0) <= 0 then raise exception 'Only eligible allowances with an amount can be sent for approval'; end if;
      if new.volunteer_id is not null then
        blockers := _volunteer_blockers(new.volunteer_id, 'allowance');
        if array_length(blockers, 1) > 0 then raise exception 'Requirements incomplete: %', array_to_string(blockers, '; '); end if;
      end if;
      new.processed_by := auth.uid();
    elsif new.processing_status in ('approved', 'disapproved') then
      if old.processed_by is not null and old.processed_by = auth.uid() then
        raise exception 'Segregation of duties: the approver must differ from the processing officer';
      end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status and not pay_sync then
    ok := case
      when new.payment_status = 'processing' and old.payment_status in ('not_yet_paid', 'on_hold', 'returned_failed') then new.processing_status = 'ready_for_payment' and (can_process or has_permission('payments.record'))
      when new.payment_status = 'on_hold' and old.payment_status in ('not_yet_paid', 'processing', 'partially_paid', 'returned_failed') then can_process or can_approve
      when new.payment_status = 'not_yet_paid' and old.payment_status = 'on_hold' then can_process or can_approve
      when new.payment_status = 'cancelled' and old.payment_status in ('not_yet_paid', 'processing', 'on_hold', 'returned_failed') then can_approve
      else false end;
    if not ok then raise exception 'Payment status change % -> % is not permitted', old.payment_status, new.payment_status using errcode = '42501'; end if;
    if new.payment_status = 'on_hold' and coalesce(btrim(current_setting('app.reason', true)), '') = '' then raise exception 'A reason is required to place a payment on hold'; end if;
  end if;
  return new;
end $$;
create trigger allowances_guard_trg before update on allowance_records for each row execute function allowances_guard();

create function allowance_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.volunteer_id is not null and (new.processing_status is distinct from old.processing_status or new.payment_status is distinct from old.payment_status)
     and (new.processing_status in ('approved', 'disapproved') or new.payment_status in ('paid', 'partially_paid', 'on_hold', 'returned_failed')) then
    select user_id into u from volunteer_profiles where id = new.volunteer_id;
    perform notify(u, 'allowances', 'Allowance update',
      'Allowance ' || new.record_no || ': ' || case when new.payment_status is distinct from old.payment_status then 'payment ' || replace(new.payment_status::text, '_', ' ') else replace(new.processing_status::text, '_', ' ') end,
      '/allowances');
  end if;
  return null;
end $$;
create trigger allowance_notify_trg after update on allowance_records for each row execute function allowance_notify();

-- ---------------------------------------------------------------- payments
create function payments_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare ar allowance_records; total numeric;
begin
  if tg_op = 'INSERT' then
    perform require_permission('payments.record');
    select * into ar from allowance_records where id = new.allowance_id for update;
    if not found then raise exception 'Allowance record not found'; end if;
    if ar.processing_status <> 'ready_for_payment' then raise exception 'Payments can only be recorded for allowances that are Ready for Payment'; end if;
    if ar.payment_status in ('on_hold', 'cancelled') then raise exception 'Payment is % for this allowance', replace(ar.payment_status::text, '_', ' '); end if;
    select coalesce(sum(amount), 0) into total from allowance_payments where allowance_id = new.allowance_id and status = 'paid';
    if total + new.amount > coalesce(ar.approved_amount, 0) then
      if not has_permission('allowance.approve') or coalesce(btrim(new.exception_reason), '') = '' then
        raise exception 'Payment of % exceeds the remaining balance of %. An authorised exception with a reason is required.', new.amount, coalesce(ar.approved_amount, 0) - total;
      end if;
    end if;
    new.status := 'paid'; new.recorded_by := auth.uid(); new.returned_at := null; new.return_reason := null;
    return new;
  end if;
  -- update: the only permitted change is marking a payment as returned/failed
  perform require_permission('payments.record');
  if old.status = 'paid' and new.status = 'returned' and coalesce(btrim(new.return_reason), '') <> ''
     and (to_jsonb(new) - 'status' - 'return_reason' - 'returned_at') = (to_jsonb(old) - 'status' - 'return_reason' - 'returned_at') then
    new.returned_at := now();
    return new;
  end if;
  raise exception 'Recorded payments are immutable; mark as returned with a reason instead';
end $$;
create trigger payments_guard_trg before insert or update on allowance_payments for each row execute function payments_guard();

create function payments_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare ar allowance_records; total numeric; last_pay allowance_payments; returned_n integer; newstatus payment_status;
begin
  select * into ar from allowance_records where id = new.allowance_id;
  select coalesce(sum(amount), 0) into total from allowance_payments where allowance_id = new.allowance_id and status = 'paid';
  select count(*) into returned_n from allowance_payments where allowance_id = new.allowance_id and status = 'returned';
  select * into last_pay from allowance_payments where allowance_id = new.allowance_id and status = 'paid' order by paid_on desc, created_at desc limit 1;
  newstatus := case when total > 0 and total >= coalesce(ar.approved_amount, 0) then 'paid'
                    when total > 0 then 'partially_paid'
                    when returned_n > 0 then 'returned_failed'
                    else 'processing' end;
  perform set_config('app.payment_sync', 'on', true);
  update allowance_records set payment_status = newstatus, payment_date = last_pay.paid_on, payment_reference = last_pay.reference_no where id = ar.id;
  perform set_config('app.payment_sync', 'off', true);
  return null;
end $$;
create trigger payments_sync_trg after insert or update on allowance_payments for each row execute function payments_sync();

-- ---------------------------------------------------------------- generation from verified attendance (internal)
create function allowance_sync_attendance(p_att uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  att attendance_records; a assignments; pos assignment_positions; ar allowance_records; rule allowance_rules; duty date;
  elig allowance_eligibility; blockers text[] := '{}'; note text; attended boolean; ext_ok boolean; has_rule boolean := false; was_sys text;
begin
  select * into att from attendance_records where id = p_att;
  if att.verification_status <> 'verified' then return; end if;
  select * into a from assignments where id = att.assignment_id;
  select * into pos from assignment_positions where id = a.position_id;
  select exam_date into duty from examination_dates where id = a.exam_date_id;
  select * into ar from allowance_records where assignment_id = a.id;
  attended := att.status in ('present', 'late', 'partially_completed');

  if not attended then elig := 'not_eligible'; note := 'Attendance does not qualify (' || att.status || ')';
  elsif not pos.allowance_eligible then elig := 'not_eligible'; note := 'Position is not allowance-eligible';
  else
    if a.external_id is not null then
      select allowance_eligible into ext_ok from external_personnel where id = a.external_id;
      if not coalesce(ext_ok, false) then elig := 'not_eligible'; note := 'Personnel is not allowance-eligible'; end if;
    end if;
    if elig is null then
      select * into rule from allowance_rules r
       where r.active and r.effective_from <= duty and (r.effective_to is null or r.effective_to >= duty)
         and (r.position_id is null or r.position_id = a.position_id)
         and (r.personnel_category is null or r.personnel_category = a.personnel_category)
         and (r.event_id is null or r.event_id = a.event_id)
       order by ((r.event_id is not null)::int * 4 + (r.position_id is not null)::int * 2 + (r.personnel_category is not null)::int) desc, r.version desc
       limit 1;
      has_rule := found;
      if not has_rule then
        elig := 'pending_requirements'; blockers := array['No active allowance rule applies'];
      else
        if a.volunteer_id is not null then
          blockers := _volunteer_blockers(a.volunteer_id, 'allowance');
          if not rule.requires_tin then blockers := array_remove(blockers, 'TIN is missing'); end if;
          if not rule.requires_bank_account then
            blockers := array_remove(array_remove(blockers, 'Bank account is missing'), 'Bank account is not verified');
          end if;
        end if;
        elig := case when array_length(blockers, 1) > 0 then 'pending_requirements' else 'eligible' end;
      end if;
      note := nullif(array_to_string(blockers, '; '), '');
    end if;
  end if;

  was_sys := current_setting('app.system_action', true);
  perform set_config('app.system_action', 'on', true);
  if ar.id is null then
    if elig = 'not_eligible' then perform set_config('app.system_action', coalesce(was_sys, 'off'), true); return; end if;
    insert into allowance_records (assignment_id, attendance_id, event_id, volunteer_id, external_id, payee_name, personnel_category, position_id, duty_date,
                                   rule_id, rule_version, approved_amount, currency, eligibility_status, processing_status, requirements_note)
    values (a.id, att.id, a.event_id, a.volunteer_id, a.external_id, a.person_name, a.personnel_category, a.position_id, duty,
            rule.id, rule.version, rule.amount, coalesce(rule.currency, 'PHP'), elig,
            case elig when 'eligible' then 'for_validation' else 'requirements_incomplete' end::allowance_processing, note);
  elsif ar.processing_status in ('not_evaluated', 'for_validation', 'requirements_incomplete', 'disapproved') then
    update allowance_records set
      attendance_id = att.id, eligibility_status = elig,
      rule_id = coalesce(rule.id, rule_id), rule_version = coalesce(rule.version, rule_version),
      approved_amount = case when has_rule then rule.amount else approved_amount end,
      processing_status = case elig when 'eligible' then 'for_validation' when 'pending_requirements' then 'requirements_incomplete' else 'not_evaluated' end::allowance_processing,
      requirements_note = note, needs_review = false, review_note = null
    where id = ar.id;
  else
    if elig is distinct from ar.eligibility_status then
      update allowance_records set needs_review = true, review_note = coalesce(note, 'Attendance changed after approval; re-validate') where id = ar.id;
    else
      update allowance_records set requirements_note = note where id = ar.id;
    end if;
  end if;
  perform set_config('app.system_action', coalesce(was_sys, 'off'), true);
end $$;

-- Re-evaluate every verified attendance for an event (e.g. after bank details were verified).
create function generate_allowances(p_event uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  perform require_permission('allowance.process');
  for r in select id from attendance_records where event_id = p_event and verification_status = 'verified' loop
    perform allowance_sync_attendance(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- RPCs
create function set_allowance_processing(p_id uuid, p_status allowance_processing, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_permission('allowance.process') or has_permission('allowance.approve')) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_status = 'disapproved' and coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update allowance_records set processing_status = p_status where id = p_id;
  if not found then raise exception 'Allowance record not found'; end if;
  if p_status in ('approved', 'disapproved') then perform log_approval('allowance', p_id, p_status::text, p_reason); end if;
end $$;

create function set_allowance_payment_status(p_id uuid, p_status payment_status, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_permission('allowance.process') or has_permission('allowance.approve') or has_permission('payments.record')) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update allowance_records set payment_status = p_status, remarks = case when p_reason is not null then p_reason else remarks end where id = p_id;
  if not found then raise exception 'Allowance record not found'; end if;
end $$;

create function adjust_allowance_amount(p_id uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare paid numeric;
begin
  perform require_permission('allowance.approve');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if p_amount < 0 then raise exception 'Amount cannot be negative'; end if;
  select coalesce(sum(amount), 0) into paid from allowance_payments where allowance_id = p_id and status = 'paid';
  if p_amount < paid then raise exception 'The amount cannot be lower than the total already paid (%)', paid; end if;
  perform set_config('app.reason', p_reason, true);
  perform set_config('app.amount_adjust', 'on', true);
  update allowance_records set approved_amount = p_amount where id = p_id;
  perform set_config('app.amount_adjust', 'off', true);
  if not found then raise exception 'Allowance record not found'; end if;
  perform log_approval('allowance_amount', p_id, 'adjusted', p_reason);
end $$;

-- ---------------------------------------------------------------- reporting views / RPCs
create view allowance_summary with (security_invoker = true) as
select ar.*, e.name as event_name, p.name as position_name,
       coalesce(pay.total_paid, 0) as total_paid,
       coalesce(ar.approved_amount, 0) - coalesce(pay.total_paid, 0) as balance
from allowance_records ar
join examination_events e on e.id = ar.event_id
join assignment_positions p on p.id = ar.position_id
left join lateral (select sum(amount) as total_paid from allowance_payments ap where ap.allowance_id = ar.id and ap.status = 'paid') pay on true;

create function allowance_dashboard(p_event uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform require_permission('allowance.view');
  with base as (select * from allowance_summary where p_event is null or event_id = p_event)
  select jsonb_build_object(
    'eligible_personnel', (select count(*) from base where eligibility_status = 'eligible'),
    'pending_validation', (select count(*) from base where processing_status in ('for_validation', 'requirements_incomplete')),
    'awaiting_approval', (select count(*) from base where processing_status = 'for_approval'),
    'approved_amount', (select coalesce(sum(approved_amount), 0) from base where processing_status in ('approved', 'for_processing', 'ready_for_payment')),
    'processing_amount', (select coalesce(sum(approved_amount - total_paid), 0) from base where processing_status in ('for_processing', 'ready_for_payment') and payment_status in ('not_yet_paid', 'processing', 'partially_paid')),
    'total_paid', (select coalesce(sum(total_paid), 0) from base),
    'outstanding', (select coalesce(sum(balance), 0) from base where processing_status in ('approved', 'for_processing', 'ready_for_payment') and payment_status not in ('cancelled')),
    'on_hold', (select count(*) from base where payment_status = 'on_hold'),
    'returned', (select count(*) from base where payment_status = 'returned_failed'),
    'missing_requirements', (select count(*) from base where eligibility_status = 'pending_requirements'),
    'needs_review', (select count(*) from base where needs_review),
    'by_event', coalesce((select jsonb_agg(x) from (select event_name as label, count(*) as records, coalesce(sum(approved_amount), 0) as approved, coalesce(sum(total_paid), 0) as paid from base group by event_name order by event_name) x), '[]'),
    'by_category', coalesce((select jsonb_agg(x) from (select personnel_category::text as label, count(*) as records, coalesce(sum(approved_amount), 0) as approved, coalesce(sum(total_paid), 0) as paid from base group by personnel_category) x), '[]'),
    'by_position', coalesce((select jsonb_agg(x) from (select position_name as label, count(*) as records, coalesce(sum(approved_amount), 0) as approved, coalesce(sum(total_paid), 0) as paid from base group by position_name order by position_name) x), '[]'),
    'by_payment_status', coalesce((select jsonb_agg(x) from (select payment_status::text as label, count(*) as records from base group by payment_status) x), '[]')
  ) into res;
  return res;
end $$;

-- A volunteer's own allowances (limited columns; no internal remarks).
create function my_allowances() returns table (
  id uuid, record_no text, event_name text, duty_date date, position_name text, approved_amount numeric, currency text,
  eligibility_status allowance_eligibility, processing_status allowance_processing, payment_status payment_status,
  total_paid numeric, balance numeric, payment_date date, payment_reference text, requirements text)
language sql stable security definer set search_path = public as $$
  select s.id, s.record_no, s.event_name, s.duty_date, s.position_name, s.approved_amount, s.currency,
         s.eligibility_status, s.processing_status, s.payment_status, s.total_paid, s.balance, s.payment_date, s.payment_reference, s.requirements_note
    from allowance_summary s
   where s.volunteer_id = my_volunteer_id()
$$;

-- ---------------------------------------------------------------- RLS
alter table allowance_rules enable row level security;
alter table allowance_records enable row level security;
alter table allowance_payments enable row level security;

create policy arules_read on allowance_rules for select to authenticated using (has_permission('allowance.view') or has_permission('allowance.rules.manage'));
create policy arules_insert on allowance_rules for insert to authenticated with check (has_permission('allowance.rules.manage'));
create policy arules_update on allowance_rules for update to authenticated using (has_permission('allowance.rules.manage')) with check (has_permission('allowance.rules.manage'));
create policy alw_read on allowance_records for select to authenticated using (has_permission('allowance.view'));
create policy alw_update on allowance_records for update to authenticated
  using (has_permission('allowance.process') or has_permission('allowance.approve'))
  with check (has_permission('allowance.process') or has_permission('allowance.approve'));
create policy pay_read on allowance_payments for select to authenticated using (has_permission('allowance.view'));
create policy pay_insert on allowance_payments for insert to authenticated with check (has_permission('payments.record'));
create policy pay_update on allowance_payments for update to authenticated using (has_permission('payments.record')) with check (has_permission('payments.record'));

grant select on allowance_rules, allowance_records, allowance_payments, allowance_summary to authenticated;
grant insert (event_id, position_id, personnel_category, name, amount, currency, requires_tin, requires_bank_account, effective_from, effective_to, reason) on allowance_rules to authenticated;
grant update (effective_to, active) on allowance_rules to authenticated;
grant update (approved_amount, processing_status, payment_status, remarks, voucher_ref) on allowance_records to authenticated;
grant insert (allowance_id, amount, paid_on, reference_no, batch_ref, remarks, exception_reason) on allowance_payments to authenticated;
grant update (status, return_reason) on allowance_payments to authenticated;
grant execute on function generate_allowances(uuid), set_allowance_processing(uuid, allowance_processing, text),
  set_allowance_payment_status(uuid, payment_status, text), adjust_allowance_amount(uuid, numeric, text),
  allowance_dashboard(uuid), my_allowances() to authenticated;

-- Seed rule: amount 0 placeholder so the rule exists but nothing is assumed. PRC must set approved amounts.
insert into allowance_rules (version, name, amount, effective_from, reason, active)
values (1, 'PLACEHOLDER — set approved amount per PRC policy', 0, date '2026-01-01', 'Initial placeholder; replace with the approved allowance schedule', false);
