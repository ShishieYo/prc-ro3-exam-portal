-- 0005_attendance.sql
-- Attendance records (status and verification kept separate), adjustments, verification workflow.

create type attendance_status as enum (
  'not_yet_recorded', 'present', 'late', 'absent', 'excused', 'partially_completed', 'for_review', 'voided'
);
create type attendance_verification as enum ('unverified', 'submitted', 'verified');

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references assignments (id),
  event_id uuid not null references examination_events (id),
  exam_date_id uuid not null references examination_dates (id),
  check_in_at timestamptz,
  check_out_at timestamptz,
  status attendance_status not null default 'not_yet_recorded',
  verification_status attendance_verification not null default 'unverified',
  recorded_by uuid references profiles (id),
  recorded_at timestamptz,
  verified_by uuid references profiles (id),
  verified_at timestamptz,
  remarks text,
  discrepancy_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at)
);
create index attendance_event_idx on attendance_records (event_id, status);
create index attendance_ver_idx on attendance_records (verification_status);
create index attendance_date_idx on attendance_records (exam_date_id);
create trigger attendance_touch before update on attendance_records for each row execute function touch_updated_at();

create table attendance_adjustments (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references attendance_records (id),
  adjusted_by uuid references profiles (id) default auth.uid(),
  reason text not null check (btrim(reason) <> ''),
  before_values jsonb not null,
  after_values jsonb not null,
  created_at timestamptz not null default now()
);
create trigger attendance_adj_immutable before update or delete on attendance_adjustments for each row execute function audit_logs_immutable();

create function can_record_attendance(p_event uuid) returns boolean language sql stable security definer set search_path = public as $$
  select has_permission('attendance.record') or (has_permission('attendance.record_scoped') and is_event_supervisor(p_event))
$$;

-- Guard: verification columns and verified records can only change through the RPCs below.
create function attendance_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare ok boolean := coalesce(current_setting('app.attendance_ok', true), '') = 'on'; late_min integer; rt time; exam_d date;
begin
  if tg_op = 'INSERT' then
    new.verification_status := 'unverified'; new.verified_by := null; new.verified_at := null;
    return new;
  end if;
  if not ok then
    if old.verification_status = 'verified' then
      raise exception 'Verified attendance can only be changed through a documented correction';
    end if;
    if (new.verification_status, new.verified_by, new.verified_at, new.assignment_id, new.event_id, new.exam_date_id)
       is distinct from (old.verification_status, old.verified_by, old.verified_at, old.assignment_id, old.event_id, old.exam_date_id) then
      raise exception 'Verification fields cannot be edited directly' using errcode = '42501';
    end if;
    if new.status is distinct from old.status or new.check_in_at is distinct from old.check_in_at or new.check_out_at is distinct from old.check_out_at then
      new.recorded_by := auth.uid(); new.recorded_at := now();
    end if;
    if new.status = 'voided' and not has_permission('attendance.correct') then
      raise exception 'Only an authorised officer can void attendance' using errcode = '42501';
    end if;
    -- "Late" is suggested automatically when check-in is after the reporting time plus the grace period
    if new.check_in_at is not null and new.status = 'present' and old.check_in_at is distinct from new.check_in_at then
      select coalesce(a.report_time, ed.report_time, ed.start_time), ed.exam_date into rt, exam_d
        from assignments a join examination_dates ed on ed.id = a.exam_date_id where a.id = new.assignment_id;
      late_min := coalesce((setting_json('attendance.late_after_minutes'))::text::integer, 15);
      if rt is not null and (new.check_in_at at time zone 'Asia/Manila') > ((exam_d + rt) + make_interval(mins => late_min)) then
        new.status := 'late';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger attendance_guard_trg before insert or update on attendance_records for each row execute function attendance_guard();

-- Internal: set system flags while running a block of attendance logic.
create function submit_attendance(p_ids uuid[]) returns integer language plpgsql security definer set search_path = public as $$
declare n integer; r record;
begin
  for r in select ar.id, ar.event_id from attendance_records ar where ar.id = any (p_ids) loop
    if not (has_permission('attendance.submit') or (has_permission('attendance.submit_scoped') and is_event_supervisor(r.event_id))) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
  end loop;
  perform set_config('app.attendance_ok', 'on', true);
  update attendance_records set verification_status = 'submitted'
   where id = any (p_ids) and verification_status = 'unverified' and status not in ('not_yet_recorded');
  get diagnostics n = row_count;
  perform set_config('app.attendance_ok', 'off', true);
  return n;
end $$;

create function verify_attendance(p_ids uuid[]) returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; a assignments;
begin
  perform require_permission('attendance.verify');
  for r in select * from attendance_records where id = any (p_ids) and verification_status in ('unverified', 'submitted') for update loop
    if r.status in ('not_yet_recorded', 'for_review') then
      raise exception 'Attendance % is not ready for verification (status: %)', r.id, r.status;
    end if;
    perform set_config('app.attendance_ok', 'on', true);
    update attendance_records set verification_status = 'verified', verified_by = auth.uid(), verified_at = now() where id = r.id;
    perform set_config('app.attendance_ok', 'off', true);
    -- reflect the verified outcome on the assignment
    perform set_config('app.system_action', 'on', true);
    select * into a from assignments where id = r.assignment_id;
    if r.status in ('present', 'late', 'partially_completed') and a.status = 'confirmed' then
      update assignments set status = 'completed' where id = a.id;
    elsif r.status = 'absent' and a.status = 'confirmed' then
      update assignments set status = 'no_show' where id = a.id;
    end if;
    perform set_config('app.system_action', 'off', true);
    perform allowance_sync_attendance(r.id);
    perform cpd_sync_attendance(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Documented correction of any attendance record (required for verified ones).
create function correct_attendance(p_id uuid, p_status attendance_status, p_check_in timestamptz, p_check_out timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare cur attendance_records; a assignments;
begin
  perform require_permission('attendance.correct');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into cur from attendance_records where id = p_id for update;
  if not found then raise exception 'Attendance record not found'; end if;
  insert into attendance_adjustments (attendance_id, reason, before_values, after_values)
  values (p_id, p_reason,
          jsonb_build_object('status', cur.status, 'check_in_at', cur.check_in_at, 'check_out_at', cur.check_out_at, 'verification_status', cur.verification_status),
          jsonb_build_object('status', p_status, 'check_in_at', p_check_in, 'check_out_at', p_check_out, 'verification_status', 'verified'));
  perform set_config('app.reason', p_reason, true);
  perform set_config('app.attendance_ok', 'on', true);
  update attendance_records set status = p_status, check_in_at = p_check_in, check_out_at = p_check_out,
    recorded_by = auth.uid(), recorded_at = now(),
    verification_status = case when cur.verification_status = 'verified' then 'verified' else verification_status end,
    verified_by = case when cur.verification_status = 'verified' then auth.uid() else verified_by end,
    verified_at = case when cur.verification_status = 'verified' then now() else verified_at end,
    discrepancy_reason = p_reason
   where id = p_id;
  perform set_config('app.attendance_ok', 'off', true);
  if cur.verification_status = 'verified' then
    select * into a from assignments where id = cur.assignment_id;
    perform set_config('app.system_action', 'on', true);
    if p_status in ('present', 'late', 'partially_completed') and a.status in ('no_show', 'confirmed') then update assignments set status = 'completed' where id = a.id;
    elsif p_status = 'absent' and a.status in ('completed', 'confirmed') then update assignments set status = 'no_show' where id = a.id;
    elsif p_status in ('excused', 'voided') and a.status = 'completed' then update assignments set status = 'confirmed' where id = a.id; end if;
    perform set_config('app.system_action', 'off', true);
    -- downstream records are flagged for review, never silently changed
    perform flag_downstream_for_attendance(p_id, p_reason);
    perform allowance_sync_attendance(p_id);
    perform cpd_sync_attendance(p_id);
  end if;
end $$;

-- ---------------------------------------------------------------- RLS
alter table attendance_records enable row level security;
alter table attendance_adjustments enable row level security;

create policy att_self on attendance_records for select to authenticated
  using (exists (select 1 from assignments a where a.id = assignment_id and a.volunteer_id = my_volunteer_id()));
create policy att_staff on attendance_records for select to authenticated using (has_permission('attendance.view'));
create policy att_scoped on attendance_records for select to authenticated
  using (has_permission('attendance.view_scoped') and is_event_supervisor(event_id));
create policy att_update on attendance_records for update to authenticated
  using (can_record_attendance(event_id)) with check (can_record_attendance(event_id));
create policy attadj_read on attendance_adjustments for select to authenticated
  using (has_permission('attendance.view') or has_permission('audit.view'));

grant select on attendance_records, attendance_adjustments to authenticated;
grant update (status, check_in_at, check_out_at, remarks, discrepancy_reason) on attendance_records to authenticated;
grant execute on function can_record_attendance(uuid), submit_attendance(uuid[]), verify_attendance(uuid[]),
  correct_attendance(uuid, attendance_status, timestamptz, timestamptz, text) to authenticated;
