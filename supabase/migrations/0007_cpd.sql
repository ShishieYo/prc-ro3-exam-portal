-- 0007_cpd.sql
-- CPD rules (versioned), CPD ledger, adjustments, eligibility sync from verified attendance.
-- Proposed operational rule (NOT validated as an official PRC/PRB rule): 1 verified eligible service day = 2 CPD units
-- for a registered professional. All parameters live in cpd_rules and can change without code changes.

create type cpd_status as enum (
  'not_eligible', 'pending_attendance_verification', 'for_cpd_review', 'pending_approval', 'approved', 'rejected', 'released', 'revoked_corrected'
);

create table cpd_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  name text not null,
  units_per_day numeric(5, 2) not null check (units_per_day >= 0),
  partial_day_qualifies boolean not null default false,
  late_qualifies boolean not null default true,
  count_once_per_date boolean not null default true,
  eligible_position_ids uuid[] not null default '{}',
  profession_ids uuid[] not null default '{}',
  requires_two_step_approval boolean not null default true,
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  reason text not null check (btrim(reason) <> ''),
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create trigger cpd_rules_ver before insert or update on cpd_rules for each row execute function rules_versioning();

create table cpd_records (
  id uuid primary key default gen_random_uuid(),
  record_no text not null unique default gen_code('CPD', 'cpd_no_seq'),
  volunteer_id uuid not null references volunteer_profiles (id),
  volunteer_name text not null,
  credential_id uuid references professional_credentials (id),
  profession_id uuid references professions (id),
  license_ref text,
  event_id uuid not null references examination_events (id),
  assignment_id uuid not null references assignments (id),
  attendance_id uuid not null unique references attendance_records (id),
  position_id uuid not null references assignment_positions (id),
  service_date date not null,
  rule_id uuid references cpd_rules (id),
  rule_version integer,
  units_proposed numeric(5, 2) not null default 0,
  units_approved numeric(5, 2) not null default 0,
  status cpd_status not null,
  reviewer_id uuid references profiles (id),
  reviewed_at timestamptz,
  approver_id uuid references profiles (id),
  approved_at timestamptz,
  certificate_ref text,
  remarks text,
  needs_review boolean not null default false,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cpd_vol_idx on cpd_records (volunteer_id, service_date);
create index cpd_event_idx on cpd_records (event_id);
create index cpd_status_idx on cpd_records (status);
create trigger cpd_touch before update on cpd_records for each row execute function touch_updated_at();

create table cpd_adjustments (
  id uuid primary key default gen_random_uuid(),
  cpd_record_id uuid not null references cpd_records (id),
  action text not null,
  units_before numeric(5, 2),
  units_after numeric(5, 2),
  reason text,
  adjusted_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index cpd_adj_idx on cpd_adjustments (cpd_record_id, created_at);
create trigger cpd_adj_immutable before update or delete on cpd_adjustments for each row execute function audit_logs_immutable();

-- ---------------------------------------------------------------- sync (internal)
create function cpd_sync_attendance(p_att uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  att attendance_records; a assignments; pos assignment_positions; vp volunteer_profiles; rule cpd_rules; cred professional_credentials;
  ex cpd_records; sdate date; verified boolean; qualifies boolean; ok boolean := true; why text; target cpd_status; units numeric(5, 2) := 0;
  was_sys text; dup boolean;
begin
  select * into att from attendance_records where id = p_att;
  select * into a from assignments where id = att.assignment_id;
  if a.volunteer_id is null then return; end if;   -- external personnel never earn CPD by default
  select * into pos from assignment_positions where id = a.position_id;
  select * into vp from volunteer_profiles where id = a.volunteer_id;
  select exam_date into sdate from examination_dates where id = a.exam_date_id;
  select * into ex from cpd_records where attendance_id = att.id;
  verified := att.verification_status = 'verified';

  qualifies := att.status = 'present';
  select * into rule from cpd_rules r
   where r.active and r.effective_from <= sdate and (r.effective_to is null or r.effective_to >= sdate)
   order by r.version desc limit 1;
  if found then
    if att.status = 'late' then qualifies := rule.late_qualifies; end if;
    if att.status = 'partially_completed' then qualifies := rule.partial_day_qualifies; end if;
  end if;

  if not qualifies then
    -- attendance does not (or no longer) qualify
    if ex.id is not null then
      was_sys := current_setting('app.system_action', true);
      perform set_config('app.system_action', 'on', true);
      if ex.status in ('approved', 'released', 'pending_approval') then
        update cpd_records set needs_review = true, review_note = 'Attendance no longer qualifies (' || att.status || ')' where id = ex.id;
      elsif ex.status <> 'not_eligible' then
        update cpd_records set status = 'not_eligible', units_proposed = 0, units_approved = 0, remarks = 'Attendance does not qualify (' || att.status || ')' where id = ex.id;
      end if;
      perform set_config('app.system_action', coalesce(was_sys, 'off'), true);
    end if;
    return;
  end if;

  -- eligibility checks (each failure is recorded as the reason)
  if not coalesce(vp.is_registered_professional, false) then ok := false; why := 'Not a registered professional';
  elsif rule.id is null then ok := false; why := 'No active CPD rule';
  elsif not pos.cpd_eligible then ok := false; why := 'Position is not CPD-eligible';
  elsif coalesce(array_length(rule.eligible_position_ids, 1), 0) > 0 and not (a.position_id = any (rule.eligible_position_ids)) then ok := false; why := 'Position is not covered by the CPD rule';
  else
    select * into cred from professional_credentials c
     where c.volunteer_id = vp.id and c.verification_status = 'verified' and (c.expiry_date is null or c.expiry_date >= sdate)
       and (coalesce(array_length(rule.profession_ids, 1), 0) = 0 or c.profession_id = any (rule.profession_ids))
     order by c.verified_at desc limit 1;
    if not found then ok := false; why := 'No verified, unexpired PRC license for an eligible profession'; end if;
  end if;

  -- same-date de-duplication: one qualifying calendar date counts once per volunteer
  if ok and rule.count_once_per_date and ex.id is null then
    select exists (select 1 from cpd_records o where o.volunteer_id = vp.id and o.service_date = sdate and o.status not in ('rejected', 'revoked_corrected', 'not_eligible')) into dup;
    if dup then return; end if;
  end if;

  if not ok then target := 'not_eligible'; units := 0;
  elsif verified then target := 'for_cpd_review'; units := rule.units_per_day;
  else target := 'pending_attendance_verification'; units := rule.units_per_day; end if;

  was_sys := current_setting('app.system_action', true);
  perform set_config('app.system_action', 'on', true);
  if ex.id is null then
    insert into cpd_records (volunteer_id, volunteer_name, credential_id, profession_id, license_ref, event_id, assignment_id, attendance_id, position_id,
                             service_date, rule_id, rule_version, units_proposed, status, remarks)
    values (vp.id, a.person_name, cred.id, cred.profession_id, cred.license_no, a.event_id, a.id, att.id, a.position_id, sdate, rule.id, rule.version, units, target, why);
  elsif ex.status in ('pending_attendance_verification', 'not_eligible', 'for_cpd_review') then
    if ex.status <> target or ex.units_proposed <> units then
      update cpd_records set status = target, units_proposed = units, credential_id = cred.id, profession_id = cred.profession_id, license_ref = cred.license_no,
             rule_id = rule.id, rule_version = rule.version, remarks = why where id = ex.id;
    end if;
  elsif not ok or not verified then
    update cpd_records set needs_review = true, review_note = coalesce(why, 'Attendance verification changed') where id = ex.id;
  end if;
  perform set_config('app.system_action', coalesce(was_sys, 'off'), true);
end $$;

create function attendance_downstream() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform allowance_sync_attendance(new.id);
  perform cpd_sync_attendance(new.id);
  return null;
end $$;
create trigger attendance_downstream_trg after insert or update of status, verification_status on attendance_records for each row execute function attendance_downstream();

create function flag_downstream_for_attendance(p_att uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare was_sys text := current_setting('app.system_action', true);
begin
  perform set_config('app.system_action', 'on', true);
  update cpd_records set needs_review = true, review_note = 'Attendance corrected: ' || p_reason
   where attendance_id = p_att and status in ('for_cpd_review', 'pending_approval', 'approved', 'released');
  update allowance_records set needs_review = true, review_note = 'Attendance corrected: ' || p_reason where attendance_id = p_att;
  perform set_config('app.system_action', coalesce(was_sys, 'off'), true);
end $$;

-- ---------------------------------------------------------------- workflow guard
create function cpd_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  sys boolean := coalesce(current_setting('app.system_action', true), '') = 'on';
  adj boolean := coalesce(current_setting('app.cpd_adjust', true), '') = 'on';
  can_review boolean := has_permission('cpd.review'); can_approve boolean := has_permission('cpd.approve'); can_adjust boolean := has_permission('cpd.adjust');
  rl cpd_rules; reason text := nullif(btrim(current_setting('app.reason', true)), ''); ok boolean; att attendance_records;
begin
  if (new.volunteer_id, new.assignment_id, new.attendance_id, new.service_date, new.event_id, new.record_no, new.position_id)
     is distinct from (old.volunteer_id, old.assignment_id, old.attendance_id, old.service_date, old.event_id, old.record_no, old.position_id) then
    raise exception 'CPD identity fields are immutable';
  end if;
  if sys then return new; end if;

  if new.units_approved is distinct from old.units_approved and not adj and not (new.status = 'approved' and old.status <> 'approved') then
    raise exception 'Approved units can only change through approval or a documented adjustment' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    ok := case
      when old.status = 'for_cpd_review' and new.status in ('pending_approval', 'rejected') then can_review
      when old.status = 'for_cpd_review' and new.status = 'approved' then can_approve
      when old.status = 'pending_approval' and new.status in ('approved', 'rejected', 'for_cpd_review') then can_approve
      when old.status = 'approved' and new.status = 'released' then can_approve
      when old.status in ('approved', 'released') and new.status = 'revoked_corrected' then can_adjust
      when old.status = 'rejected' and new.status = 'for_cpd_review' then can_review
      when old.status = 'revoked_corrected' and new.status = 'for_cpd_review' then can_adjust
      else false end;
    if not ok then raise exception 'CPD transition % -> % is not permitted for this user', old.status, new.status using errcode = '42501'; end if;
    if new.status in ('rejected', 'revoked_corrected', 'for_cpd_review') and old.status <> 'pending_approval' and reason is null then
      raise exception 'A reason is required';
    end if;
    if new.status = 'pending_approval' then new.reviewer_id := auth.uid(); new.reviewed_at := now(); end if;
    if new.status = 'approved' then
      select * into att from attendance_records where id = new.attendance_id;
      if att.verification_status <> 'verified' then raise exception 'Attendance must be verified before CPD can be approved'; end if;
      if old.needs_review then raise exception 'This record is flagged for review after an attendance correction. Resolve the flag first.'; end if;
      select * into rl from cpd_rules where id = new.rule_id;
      if old.status = 'for_cpd_review' and rl.requires_two_step_approval then raise exception 'This rule requires review before approval'; end if;
      if old.reviewer_id is not null and old.reviewer_id = auth.uid() and rl.requires_two_step_approval then
        raise exception 'Segregation of duties: the approver must differ from the reviewer';
      end if;
      if old.status = 'for_cpd_review' then new.reviewer_id := auth.uid(); new.reviewed_at := now(); end if;
      new.approver_id := auth.uid(); new.approved_at := now();
      new.units_approved := coalesce(nullif(new.units_approved, 0), old.units_proposed);
      if new.units_approved > old.units_proposed then raise exception 'Approved units cannot exceed the proposed units'; end if;
    end if;
    if new.status = 'revoked_corrected' then new.units_approved := 0; end if;
  end if;
  return new;
end $$;
create trigger cpd_guard_trg before update on cpd_records for each row execute function cpd_guard();

create function cpd_after() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.status is distinct from old.status or new.units_approved is distinct from old.units_approved then
    insert into cpd_adjustments (cpd_record_id, action, units_before, units_after, reason)
    values (new.id, case when new.status is distinct from old.status then 'status:' || old.status || '->' || new.status else 'units' end,
            old.units_approved, new.units_approved, nullif(current_setting('app.reason', true), ''));
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'rejected', 'released', 'revoked_corrected') then
    select user_id into u from volunteer_profiles where id = new.volunteer_id;
    perform notify(u, 'cpd', 'CPD record ' || replace(new.status::text, '_', ' '),
      new.record_no || ' (' || to_char(new.service_date, 'Mon DD, YYYY') || '): ' || replace(new.status::text, '_', ' ') ||
      case when new.status = 'approved' then ' — ' || new.units_approved || ' units recorded by this portal.' else '' end, '/cpd');
  end if;
  return null;
end $$;
create trigger cpd_after_trg after update on cpd_records for each row execute function cpd_after();

-- ---------------------------------------------------------------- RPCs
create function set_cpd_status(p_id uuid, p_status cpd_status, p_reason text default null, p_units numeric default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_permission('cpd.review') or has_permission('cpd.approve') or has_permission('cpd.adjust')) then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update cpd_records set status = p_status, units_approved = coalesce(p_units, units_approved) where id = p_id;
  if not found then raise exception 'CPD record not found'; end if;
  if p_status in ('approved', 'rejected') then perform log_approval('cpd', p_id, p_status::text, p_reason); end if;
end $$;

create function adjust_cpd_record(p_id uuid, p_action text, p_units numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare cur cpd_records;
begin
  perform require_permission('cpd.adjust');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into cur from cpd_records where id = p_id for update;
  if not found then raise exception 'CPD record not found'; end if;
  perform set_config('app.reason', p_reason, true);
  perform set_config('app.cpd_adjust', 'on', true);
  if p_action = 'correct_units' then
    if cur.status not in ('approved', 'released') then raise exception 'Only approved records can have units corrected'; end if;
    if p_units is null or p_units < 0 then raise exception 'Invalid units'; end if;
    update cpd_records set units_approved = p_units, needs_review = false, review_note = null where id = p_id;
  elsif p_action = 'clear_flag' then
    update cpd_records set needs_review = false, review_note = null where id = p_id;
    insert into cpd_adjustments (cpd_record_id, action, units_before, units_after, reason) values (p_id, 'clear_flag', cur.units_approved, cur.units_approved, p_reason);
  else
    raise exception 'Unknown action';
  end if;
  perform set_config('app.cpd_adjust', 'off', true);
end $$;

-- Re-run eligibility for every attendance record of an event (idempotent).
create function generate_cpd_records(p_event uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not (has_permission('cpd.review') or has_permission('cpd.adjust')) then raise exception 'Not authorized' using errcode = '42501'; end if;
  for r in select id from attendance_records where event_id = p_event loop
    perform cpd_sync_attendance(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- views
create view cpd_record_view with (security_invoker = true) as
select c.*, e.name as event_name, p.name as position_name, pr.name as profession_name
from cpd_records c
join examination_events e on e.id = c.event_id
join assignment_positions p on p.id = c.position_id
left join professions pr on pr.id = c.profession_id;

-- Total of units recorded by THIS portal (not the professional's complete PRC CPD balance).
create view cpd_volunteer_totals with (security_invoker = true) as
select volunteer_id,
       coalesce(sum(units_approved) filter (where status in ('approved', 'released')), 0) as approved_units,
       coalesce(sum(units_proposed) filter (where status in ('pending_attendance_verification', 'for_cpd_review', 'pending_approval')), 0) as pending_units,
       count(distinct service_date) filter (where status in ('approved', 'released')) as qualifying_days
from cpd_records group by volunteer_id;

create function cpd_dashboard() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform require_permission('cpd.view');
  return jsonb_build_object(
    'eligible_professionals', (select count(distinct volunteer_id) from cpd_records where status <> 'not_eligible'),
    'qualifying_days', (select count(*) from cpd_records where status in ('approved', 'released')),
    'units_pending', (select coalesce(sum(units_proposed), 0) from cpd_records where status in ('pending_attendance_verification', 'for_cpd_review', 'pending_approval')),
    'units_approved', (select coalesce(sum(units_approved), 0) from cpd_records where status in ('approved', 'released')),
    'for_review', (select count(*) from cpd_records where status = 'for_cpd_review'),
    'pending_approval', (select count(*) from cpd_records where status = 'pending_approval'),
    'rejected', (select count(*) from cpd_records where status = 'rejected'),
    'corrected', (select count(*) from cpd_records where status = 'revoked_corrected'),
    'flagged', (select count(*) from cpd_records where needs_review),
    'by_event', coalesce((select jsonb_agg(x) from (select e.name as label, coalesce(sum(c.units_approved) filter (where c.status in ('approved', 'released')), 0) as approved,
        coalesce(sum(c.units_proposed) filter (where c.status in ('pending_attendance_verification', 'for_cpd_review', 'pending_approval')), 0) as pending
        from cpd_records c join examination_events e on e.id = c.event_id group by e.name order by e.name) x), '[]'),
    'by_profession', coalesce((select jsonb_agg(x) from (select coalesce(pr.name, 'Unspecified') as label, coalesce(sum(c.units_approved) filter (where c.status in ('approved', 'released')), 0) as approved,
        count(distinct c.volunteer_id) as professionals
        from cpd_records c left join professions pr on pr.id = c.profession_id where c.status <> 'not_eligible' group by pr.name order by 1) x), '[]')
  );
end $$;

-- ---------------------------------------------------------------- RLS
alter table cpd_rules enable row level security;
alter table cpd_records enable row level security;
alter table cpd_adjustments enable row level security;

create policy cpdrules_read on cpd_rules for select to authenticated using (has_permission('cpd.view') or has_permission('cpd.rules.manage'));
create policy cpdrules_insert on cpd_rules for insert to authenticated with check (has_permission('cpd.rules.manage'));
create policy cpdrules_update on cpd_rules for update to authenticated using (has_permission('cpd.rules.manage')) with check (has_permission('cpd.rules.manage'));
create policy cpd_self on cpd_records for select to authenticated using (volunteer_id = my_volunteer_id());
create policy cpd_staff on cpd_records for select to authenticated using (has_permission('cpd.view'));
create policy cpd_update on cpd_records for update to authenticated
  using (has_permission('cpd.review') or has_permission('cpd.approve') or has_permission('cpd.adjust'))
  with check (has_permission('cpd.review') or has_permission('cpd.approve') or has_permission('cpd.adjust'));
create policy cpdadj_self on cpd_adjustments for select to authenticated using (exists (select 1 from cpd_records c where c.id = cpd_record_id));

grant select on cpd_rules, cpd_records, cpd_adjustments, cpd_record_view, cpd_volunteer_totals to authenticated;
grant insert (name, units_per_day, partial_day_qualifies, late_qualifies, count_once_per_date, eligible_position_ids, profession_ids,
  requires_two_step_approval, effective_from, effective_to, reason) on cpd_rules to authenticated;
grant update (effective_to, active) on cpd_rules to authenticated;
grant update (status, units_approved, certificate_ref, remarks) on cpd_records to authenticated;
grant execute on function set_cpd_status(uuid, cpd_status, text, numeric), adjust_cpd_record(uuid, text, numeric, text),
  generate_cpd_records(uuid), cpd_dashboard() to authenticated;

insert into cpd_rules (version, name, units_per_day, effective_from, reason)
values (1, 'Proposed rule v1: 2 units per verified eligible service day', 2, date '2026-01-01',
        'Proposed operational rule supplied for the portal workflow; requires validation by PRC / Professional Regulatory Boards');
