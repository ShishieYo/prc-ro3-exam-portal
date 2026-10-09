-- 0004_assignments.sql
-- Assignments (one row = one person, one position, one examination day), state machine, history, conflicts.

insert into system_settings (key, value, description) values
  ('assignment.requires_approval', 'false', 'If true, releasing an assignment requires approval by an officer with assignments.approve');

create type assignment_status as enum (
  'draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed',
  'declined', 'waitlisted', 'reassigned', 'cancelled', 'completed', 'no_show'
);

create table approval_records (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  action text not null,
  decided_by uuid references profiles (id) default auth.uid(),
  decided_at timestamptz not null default now(),
  reason text
);
create index approval_subject_idx on approval_records (subject_type, subject_id);

create function log_approval(p_type text, p_id uuid, p_action text, p_reason text default null) returns void
language sql security definer set search_path = public as $$
  insert into approval_records (subject_type, subject_id, action, decided_by, reason) values (p_type, p_id, p_action, auth.uid(), p_reason)
$$;

create table assignments (
  id uuid primary key default gen_random_uuid(),
  assignment_no text not null unique default gen_code('ASG', 'assignment_no_seq'),
  event_id uuid not null references examination_events (id),
  exam_date_id uuid not null references examination_dates (id),
  requirement_id uuid references staffing_requirements (id) on delete set null,
  personnel_category personnel_category not null,
  volunteer_id uuid references volunteer_profiles (id),
  external_id uuid references external_personnel (id),
  person_name text not null,
  person_no text,
  position_id uuid not null references assignment_positions (id),
  center_id uuid not null references examination_centers (id),
  building_id uuid references buildings (id),
  floor_id uuid references floors (id),
  room_id uuid references rooms (id),
  report_time time,
  expected_end_time time,
  status assignment_status not null default 'draft',
  volunteer_response text check (volunteer_response in ('accepted', 'declined')),
  responded_at timestamptz,
  response_reason text,
  offered_at timestamptz,
  confirmed_at timestamptz,
  assigned_by uuid references profiles (id),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  conflict_override_reason text,
  replaces_assignment_id uuid references assignments (id),
  is_imported boolean not null default false,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((volunteer_id is not null) <> (external_id is not null))
);
create index assignments_event_idx on assignments (event_id, status);
create index assignments_vol_idx on assignments (volunteer_id, status);
create index assignments_ext_idx on assignments (external_id);
create index assignments_pos_idx on assignments (position_id);
create index assignments_req_idx on assignments (requirement_id);
create index assignments_date_idx on assignments (exam_date_id);
-- a person can hold only one live assignment per examination day
create unique index assignments_one_per_day_vol on assignments (exam_date_id, volunteer_id)
  where volunteer_id is not null and status in ('draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed');
create unique index assignments_one_per_day_ext on assignments (exam_date_id, external_id)
  where external_id is not null and status in ('draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed');
create trigger assignments_touch before update on assignments for each row execute function touch_updated_at();

create table assignment_history (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  assignment_id uuid not null references assignments (id),
  from_status assignment_status,
  to_status assignment_status,
  changed_by uuid references profiles (id),
  reason text,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index assignment_history_idx on assignment_history (assignment_id, created_at);
create trigger assignment_history_immutable before update or delete on assignment_history
  for each row execute function audit_logs_immutable();

-- ---------------------------------------------------------------- transition matrix
-- actor: manage = assignments.manage, approve = assignments.approve, volunteer = the assigned volunteer, system = internal
create table assignment_transitions (
  from_status assignment_status not null,
  to_status assignment_status not null,
  actor text not null check (actor in ('manage', 'approve', 'volunteer', 'system')),
  primary key (from_status, to_status, actor)
);
insert into assignment_transitions values
  ('draft', 'pending_approval', 'manage'), ('draft', 'offered', 'manage'), ('draft', 'waitlisted', 'manage'), ('draft', 'cancelled', 'manage'),
  ('waitlisted', 'draft', 'manage'), ('waitlisted', 'offered', 'manage'), ('waitlisted', 'cancelled', 'manage'),
  ('pending_approval', 'offered', 'approve'), ('pending_approval', 'draft', 'approve'), ('pending_approval', 'cancelled', 'manage'),
  ('draft', 'offered', 'approve'), ('offered', 'awaiting_volunteer_confirmation', 'approve'),
  ('offered', 'awaiting_volunteer_confirmation', 'manage'), ('offered', 'cancelled', 'manage'), ('offered', 'reassigned', 'manage'),
  ('offered', 'declined', 'volunteer'),
  ('awaiting_volunteer_confirmation', 'confirmed', 'volunteer'), ('awaiting_volunteer_confirmation', 'confirmed', 'approve'),
  ('awaiting_volunteer_confirmation', 'declined', 'volunteer'), ('awaiting_volunteer_confirmation', 'declined', 'manage'),
  ('awaiting_volunteer_confirmation', 'cancelled', 'manage'), ('awaiting_volunteer_confirmation', 'reassigned', 'manage'),
  ('confirmed', 'declined', 'volunteer'), ('confirmed', 'cancelled', 'manage'), ('confirmed', 'reassigned', 'manage'),
  ('confirmed', 'completed', 'system'), ('confirmed', 'no_show', 'system'),
  -- any live assignment is cancelled by the system when its event is cancelled
  ('draft', 'cancelled', 'system'), ('pending_approval', 'cancelled', 'system'), ('offered', 'cancelled', 'system'),
  ('awaiting_volunteer_confirmation', 'cancelled', 'system'), ('confirmed', 'cancelled', 'system'),
  -- attendance correction can move an outcome (voiding a no-show etc.)
  ('no_show', 'completed', 'system'), ('completed', 'no_show', 'system'), ('no_show', 'confirmed', 'system'), ('completed', 'confirmed', 'system');

-- ---------------------------------------------------------------- helpers
create function volunteer_display_name(vp volunteer_profiles) returns text language sql immutable as $$
  select btrim(coalesce(vp.last_name, '') || ', ' || coalesce(vp.first_name, '') || ' ' || coalesce(vp.middle_name, '') || ' ' || coalesce(vp.name_extension, ''), ', ')
$$;

-- Assignments (other than p_exclude) that overlap the given examination day for this volunteer.
create function volunteer_conflicts(p_volunteer uuid, p_date_id uuid, p_exclude uuid default null) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not (p_volunteer = my_volunteer_id() or has_permission('assignments.manage') or has_permission('assignments.view')
          or has_permission('assignments.approve') or coalesce(current_setting('app.system_action', true), '') = 'on') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select a.id
    from assignments a
    join examination_dates od on od.id = a.exam_date_id
    join examination_dates td on td.id = p_date_id
   where a.volunteer_id = p_volunteer
     and a.id is distinct from p_exclude
     and a.status in ('pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed')
     and od.exam_date = td.exam_date
     and coalesce(a.report_time, od.report_time, od.start_time, time '00:00') < coalesce(td.end_time, time '23:59:59')
     and coalesce(td.report_time, td.start_time, time '00:00') < coalesce(a.expected_end_time, od.end_time, time '23:59:59');
end $$;

-- ---------------------------------------------------------------- guard trigger
create function assignments_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  pos assignment_positions; vp volunteer_profiles; ex external_personnel; ed examination_dates; ev examination_events;
  is_manage boolean; is_approve boolean; is_volunteer boolean; is_system boolean; ok boolean; blockers text[];
  req_approval boolean; vol_user uuid; has_license boolean;
begin
  is_system := coalesce(current_setting('app.system_action', true), '') = 'on';
  is_manage := has_permission('assignments.manage');
  is_approve := has_permission('assignments.approve');

  select * into ed from examination_dates where id = new.exam_date_id;
  if not found or ed.event_id <> new.event_id then raise exception 'Examination date does not belong to the event'; end if;
  select * into pos from assignment_positions where id = new.position_id;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.assigned_by := auth.uid();
    new.volunteer_response := null; new.offered_at := null; new.confirmed_at := null; new.approved_by := null; new.approved_at := null;
    select * into ev from examination_events where id = new.event_id;
    if ev.status in ('cancelled', 'completed', 'archived', 'draft') and not is_system then
      raise exception 'Assignments cannot be created while the event is %', ev.status;
    end if;
    if new.volunteer_id is not null then
      select * into vp from volunteer_profiles where id = new.volunteer_id;
      if pos.personnel_type <> 'volunteer' then raise exception 'Position % is not for volunteers', pos.name; end if;
      new.personnel_category := 'volunteer';
      new.person_name := volunteer_display_name(vp);
      new.person_no := vp.volunteer_no;
    else
      select * into ex from external_personnel where id = new.external_id;
      if pos.personnel_type = 'volunteer' then raise exception 'Position % is for volunteers only', pos.name; end if;
      if pos.personnel_type <> ex.category and pos.personnel_type <> 'prc_staff' then raise exception 'Position % does not accept this personnel category', pos.name; end if;
      new.personnel_category := ex.category;
      new.person_name := ex.full_name;
      new.person_no := ex.ext_no;
    end if;
    if new.conflict_override_reason is not null and not is_approve then
      raise exception 'Only an approving officer can override a schedule conflict' using errcode = '42501';
    end if;
    return new;
  end if;

  -- ---- UPDATE
  if (new.volunteer_id, new.external_id, new.event_id, new.exam_date_id, new.assignment_no, new.personnel_category)
     is distinct from (old.volunteer_id, old.external_id, old.event_id, old.exam_date_id, old.assignment_no, old.personnel_category) then
    raise exception 'Use reassignment to change the assigned person or examination day';
  end if;
  if old.status in ('declined', 'reassigned', 'cancelled', 'completed', 'no_show') and new.status = old.status
     and (new.position_id, new.center_id, new.building_id, new.floor_id, new.room_id, new.report_time, new.expected_end_time)
         is distinct from (old.position_id, old.center_id, old.building_id, old.floor_id, old.room_id, old.report_time, old.expected_end_time)
     and not is_system then
    raise exception 'Closed assignments cannot be edited';
  end if;
  if new.conflict_override_reason is distinct from old.conflict_override_reason and not is_approve and not is_system then
    raise exception 'Only an approving officer can override a schedule conflict' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    is_volunteer := old.volunteer_id is not null and old.volunteer_id = my_volunteer_id();
    req_approval := coalesce((setting_json('assignment.requires_approval'))::text::boolean, false);
    ok := false;
    if is_system and exists (select 1 from assignment_transitions where from_status = old.status and to_status = new.status and actor = 'system') then ok := true; end if;
    if not ok and is_manage and exists (select 1 from assignment_transitions where from_status = old.status and to_status = new.status and actor = 'manage') then ok := true; end if;
    if not ok and is_approve and exists (select 1 from assignment_transitions where from_status = old.status and to_status = new.status and actor = 'approve') then ok := true; end if;
    if not ok and is_volunteer and exists (select 1 from assignment_transitions where from_status = old.status and to_status = new.status and actor = 'volunteer') then ok := true; end if;
    -- external personnel have no portal account: staff confirm them directly
    if not ok and is_manage and old.external_id is not null and old.status in ('draft', 'offered', 'awaiting_volunteer_confirmation') and new.status = 'confirmed' then ok := true; end if;
    if not ok then raise exception 'Transition % -> % is not permitted for this user', old.status, new.status using errcode = '42501'; end if;

    if old.status = 'draft' and new.status = 'offered' and req_approval and not is_approve and not is_system then
      raise exception 'Approval is required before an assignment can be offered';
    end if;
    if is_volunteer and not is_manage and not is_approve and new.status = 'confirmed' and
       coalesce((setting_json('assignment.confirmation_requires_approval'))::text::boolean, false) then
      raise exception 'Your acceptance must be approved by PRC before the assignment is confirmed';
    end if;

    -- eligibility gate when an assignment becomes (or stays) a commitment
    if new.status in ('offered', 'awaiting_volunteer_confirmation', 'confirmed') and old.status in ('draft', 'pending_approval', 'waitlisted') and new.volunteer_id is not null then
      select * into vp from volunteer_profiles where id = new.volunteer_id;
      blockers := _volunteer_blockers(new.volunteer_id, 'assignment');
      if pos.requires_registered_professional and not coalesce(vp.is_registered_professional, false) then
        blockers := array_append(blockers, ('Position ' || pos.name || ' requires a registered professional'));
      end if;
      if pos.requires_verified_license then
        select exists (select 1 from professional_credentials c where c.volunteer_id = new.volunteer_id and c.verification_status = 'verified'
                          and (c.expiry_date is null or c.expiry_date >= current_date)) into has_license;
        if not has_license then blockers := array_append(blockers, ('Position ' || pos.name || ' requires a verified, unexpired PRC license')); end if;
      end if;
      if array_length(blockers, 1) > 0 then
        raise exception 'Volunteer is not eligible: %', array_to_string(blockers, '; ');
      end if;
      if new.conflict_override_reason is null and exists (select 1 from volunteer_conflicts(new.volunteer_id, new.exam_date_id, new.id)) then
        raise exception 'Schedule conflict: the volunteer already has an assignment that overlaps this day';
      end if;
    end if;

    if new.status = 'offered' then new.offered_at := now(); end if;
    if new.status = 'confirmed' then
      new.confirmed_at := now();
      if is_approve and not is_volunteer then new.approved_by := auth.uid(); new.approved_at := now(); end if;
    end if;
    if is_volunteer then new.responded_at := now(); end if;
    if old.status = 'pending_approval' and new.status in ('offered', 'draft') then new.approved_by := auth.uid(); new.approved_at := now(); end if;
  end if;
  return new;
end $$;
create trigger assignments_guard_trg before insert or update on assignments for each row execute function assignments_guard();

-- history, notifications and downstream effects
create function assignments_after() returns trigger language plpgsql security definer set search_path = public as $$
declare vol_user uuid; ename text; changes jsonb := '{}'::jsonb; reason text := nullif(current_setting('app.reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into assignment_history (assignment_id, from_status, to_status, changed_by, reason) values (new.id, null, new.status, auth.uid(), reason);
    return null;
  end if;

  if (new.position_id, new.center_id, new.building_id, new.floor_id, new.room_id, new.report_time, new.expected_end_time, new.remarks)
     is distinct from (old.position_id, old.center_id, old.building_id, old.floor_id, old.room_id, old.report_time, old.expected_end_time, old.remarks) then
    changes := jsonb_build_object('position_id', jsonb_build_array(old.position_id, new.position_id),
      'room_id', jsonb_build_array(old.room_id, new.room_id), 'floor_id', jsonb_build_array(old.floor_id, new.floor_id),
      'building_id', jsonb_build_array(old.building_id, new.building_id), 'center_id', jsonb_build_array(old.center_id, new.center_id),
      'report_time', jsonb_build_array(old.report_time, new.report_time), 'expected_end_time', jsonb_build_array(old.expected_end_time, new.expected_end_time));
  end if;
  if new.status is distinct from old.status or changes <> '{}'::jsonb or new.volunteer_response is distinct from old.volunteer_response then
    insert into assignment_history (assignment_id, from_status, to_status, changed_by, reason, changes)
    values (new.id, old.status, new.status, auth.uid(), coalesce(reason, new.response_reason), nullif(changes, '{}'::jsonb));
  end if;

  if new.volunteer_id is not null then
    select user_id into vol_user from volunteer_profiles where id = new.volunteer_id;
    select name into ename from examination_events where id = new.event_id;
    if new.status is distinct from old.status then
      if new.status = 'awaiting_volunteer_confirmation' then
        perform notify(vol_user, 'assignments', 'New assignment offer', ename || ': please confirm your assignment.', '/assignments/' || new.id);
        update examination_preferences set status = 'assigned' where volunteer_id = new.volunteer_id and event_id = new.event_id and status in ('pending', 'shortlisted', 'waitlisted');
      elsif new.status = 'confirmed' and old.status = 'awaiting_volunteer_confirmation' and not (old.volunteer_id = my_volunteer_id()) then
        perform notify(vol_user, 'assignments', 'Assignment confirmed', ename || ': your assignment has been confirmed.', '/assignments/' || new.id);
      elsif new.status in ('cancelled', 'reassigned') and old.status in ('offered', 'awaiting_volunteer_confirmation', 'confirmed') then
        perform notify(vol_user, 'assignments', 'Assignment ' || new.status::text, ename || ': your assignment was ' || new.status::text || coalesce('. Reason: ' || reason, '.'), '/assignments/' || new.id);
      end if;
    elsif changes <> '{}'::jsonb and new.status in ('awaiting_volunteer_confirmation', 'confirmed') then
      perform notify(vol_user, 'assignments', 'Assignment details changed', ename || ': your reporting details were updated.', '/assignments/' || new.id);
    end if;
  end if;

  -- a confirmed assignment gets an attendance row so the roster is ready on exam day
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    insert into attendance_records (assignment_id, event_id, exam_date_id) values (new.id, new.event_id, new.exam_date_id) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger assignments_after_trg after insert or update on assignments for each row execute function assignments_after();

-- ---------------------------------------------------------------- RPCs
create function set_assignment_status(p_id uuid, p_status assignment_status, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cur assignments;
begin
  if not (has_permission('assignments.manage') or has_permission('assignments.approve')) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into cur from assignments where id = p_id;
  if not found then raise exception 'Assignment not found'; end if;
  if p_status in ('cancelled', 'declined', 'reassigned') and coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update assignments set status = p_status where id = p_id;
  if cur.status = 'pending_approval' and p_status in ('offered', 'draft') then
    perform log_approval('assignment', p_id, case when p_status = 'offered' then 'approved' else 'returned' end, p_reason);
  end if;
end $$;

-- Release drafts to volunteers: draft -> (pending_approval | offered -> awaiting confirmation). External personnel are confirmed directly.
create function release_assignments(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a assignments; req boolean; released integer := 0; pending integer := 0; errs jsonb := '[]'::jsonb;
begin
  if not (has_permission('assignments.manage') or has_permission('assignments.approve')) then raise exception 'Not authorized' using errcode = '42501'; end if;
  req := coalesce((setting_json('assignment.requires_approval'))::text::boolean, false);
  for a in select * from assignments where id = any (p_ids) and status = 'draft' order by assignment_no loop
    begin
      if a.external_id is not null then
        update assignments set status = 'confirmed' where id = a.id; released := released + 1;
      elsif req and not has_permission('assignments.approve') then
        update assignments set status = 'pending_approval' where id = a.id; pending := pending + 1;
      else
        update assignments set status = 'offered' where id = a.id;
        update assignments set status = 'awaiting_volunteer_confirmation' where id = a.id; released := released + 1;
      end if;
    exception when others then
      errs := errs || jsonb_build_array(jsonb_build_object('assignment_no', a.assignment_no, 'name', a.person_name, 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('released', released, 'pending_approval', pending, 'errors', errs);
end $$;

-- Approve a pending-approval offer (and release it) or approve a volunteer's recorded acceptance.
create function decide_assignment(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cur assignments;
begin
  perform require_permission('assignments.approve');
  select * into cur from assignments where id = p_id;
  if not found then raise exception 'Assignment not found'; end if;
  if not p_approve and coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  if cur.status = 'pending_approval' then
    if p_approve then
      update assignments set status = 'offered' where id = p_id;
      update assignments set status = 'awaiting_volunteer_confirmation' where id = p_id;
    else
      update assignments set status = 'draft' where id = p_id;
    end if;
  elsif cur.status = 'awaiting_volunteer_confirmation' and cur.volunteer_response = 'accepted' then
    if p_approve then update assignments set status = 'confirmed' where id = p_id;
    else update assignments set status = 'cancelled' where id = p_id; end if;
  else
    raise exception 'Nothing to approve for status %', cur.status;
  end if;
  perform log_approval('assignment', p_id, case when p_approve then 'approved' else 'rejected' end, p_reason);
end $$;

create function respond_assignment(p_id uuid, p_action text, p_reason text default null) returns assignment_status
language plpgsql security definer set search_path = public as $$
declare cur assignments; needs_approval boolean; deadline date; today date := (now() at time zone 'Asia/Manila')::date;
begin
  select * into cur from assignments where id = p_id and volunteer_id = my_volunteer_id() and status not in ('draft', 'pending_approval', 'waitlisted');
  if not found then raise exception 'Assignment not found'; end if;
  select confirmation_deadline into deadline from examination_events where id = cur.event_id;
  needs_approval := coalesce((setting_json('assignment.confirmation_requires_approval'))::text::boolean, false);
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  if p_action = 'accept' then
    if cur.status <> 'awaiting_volunteer_confirmation' then raise exception 'This assignment is not awaiting your confirmation'; end if;
    if deadline is not null and today > deadline then raise exception 'The confirmation deadline has passed'; end if;
    if needs_approval then
      update assignments set volunteer_response = 'accepted', responded_at = now() where id = p_id;
      return cur.status;
    end if;
    update assignments set status = 'confirmed', volunteer_response = 'accepted' where id = p_id;
    return 'confirmed';
  elsif p_action in ('decline', 'withdraw') then
    if coalesce(btrim(p_reason), '') = '' then raise exception 'Please provide a reason'; end if;
    if cur.status not in ('offered', 'awaiting_volunteer_confirmation', 'confirmed') then raise exception 'This assignment cannot be declined'; end if;
    if cur.status = 'confirmed' and deadline is not null and today > deadline then
      raise exception 'The confirmation deadline has passed; please contact PRC to withdraw';
    end if;
    update assignments set status = 'declined', volunteer_response = 'declined', response_reason = p_reason where id = p_id;
    return 'declined';
  end if;
  raise exception 'Invalid action';
end $$;

-- Replace the person on an assignment; the original record is preserved with its history.
create function reassign_assignment(p_id uuid, p_new_volunteer uuid, p_new_external uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a assignments; new_id uuid;
begin
  perform require_permission('assignments.manage');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into a from assignments where id = p_id;
  if not found then raise exception 'Assignment not found'; end if;
  if a.status not in ('draft', 'offered', 'awaiting_volunteer_confirmation', 'confirmed', 'declined', 'no_show', 'cancelled') then
    raise exception 'Assignments in status % cannot be reassigned', a.status;
  end if;
  perform set_config('app.reason', p_reason, true);
  if a.status in ('offered', 'awaiting_volunteer_confirmation', 'confirmed') then
    update assignments set status = 'reassigned' where id = p_id;
  elsif a.status = 'draft' then
    update assignments set status = 'cancelled' where id = p_id;
  end if;
  insert into assignments (event_id, exam_date_id, requirement_id, volunteer_id, external_id, position_id, center_id, building_id, floor_id, room_id,
                           report_time, expected_end_time, remarks, replaces_assignment_id)
  values (a.event_id, a.exam_date_id, a.requirement_id, p_new_volunteer, p_new_external, a.position_id, a.center_id, a.building_id, a.floor_id, a.room_id,
          a.report_time, a.expected_end_time, 'Replaces ' || a.assignment_no || ': ' || p_reason, a.id)
  returning id into new_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------- candidate pool for planning / assisted assignment
create function candidate_pool(p_event uuid, p_exam_date uuid) returns table (
  volunteer_id uuid, volunteer_no text, full_name text, is_registered boolean, profile_verified boolean, license_verified boolean,
  availability_declared boolean, available boolean, preferred_event boolean, preferred_position_ids uuid[], preferred_center_ids uuid[],
  prior_completed integer, prior_no_show integer, prior_total integer, recent_assignments integer, has_experience boolean,
  has_training boolean, has_conflict boolean, assigned_this_day boolean, blockers text[])
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_permission('assignments.manage');
  return query
  select vp.id, vp.volunteer_no, volunteer_display_name(vp), coalesce(vp.is_registered_professional, false),
         vp.verification_status = 'verified',
         exists (select 1 from professional_credentials c where c.volunteer_id = vp.id and c.verification_status = 'verified' and (c.expiry_date is null or c.expiry_date >= current_date)),
         exists (select 1 from volunteer_availability va where va.volunteer_id = vp.id and va.exam_date_id = p_exam_date),
         coalesce((select va.available from volunteer_availability va where va.volunteer_id = vp.id and va.exam_date_id = p_exam_date), false),
         exists (select 1 from examination_preferences ep where ep.volunteer_id = vp.id and ep.event_id = p_event and ep.status in ('pending', 'shortlisted', 'waitlisted', 'assigned')),
         coalesce((select ep.preferred_position_ids from examination_preferences ep where ep.volunteer_id = vp.id and ep.event_id = p_event), '{}'),
         coalesce((select ep.preferred_center_ids from examination_preferences ep where ep.volunteer_id = vp.id and ep.event_id = p_event), '{}'),
         (select count(*)::integer from assignments a where a.volunteer_id = vp.id and a.status = 'completed'),
         (select count(*)::integer from assignments a where a.volunteer_id = vp.id and a.status = 'no_show'),
         (select count(*)::integer from assignments a where a.volunteer_id = vp.id and a.status in ('confirmed', 'completed', 'no_show')),
         (select count(*)::integer from assignments a where a.volunteer_id = vp.id and a.status in ('awaiting_volunteer_confirmation', 'confirmed', 'completed') and a.created_at > now() - interval '12 months'),
         (coalesce(btrim(vp.experience_notes), '') <> '' or coalesce(btrim(vp.prior_assignments_notes), '') <> ''),
         (coalesce(btrim(vp.training_certifications), '') <> ''),
         exists (select 1 from volunteer_conflicts(vp.id, p_exam_date)),
         exists (select 1 from assignments a where a.volunteer_id = vp.id and a.exam_date_id = p_exam_date
                  and a.status in ('draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed')),
         _volunteer_blockers(vp.id, 'assignment')
    from volunteer_profiles vp
    join profiles pr on pr.id = vp.user_id
   where pr.account_status = 'active';
end $$;

-- ---------------------------------------------------------------- views
create view assignment_roster with (security_invoker = true) as
select a.id, a.assignment_no, a.event_id, e.name as event_name, a.exam_date_id, ed.exam_date, a.personnel_category,
       a.volunteer_id, a.external_id, a.person_name, a.person_no, a.position_id, p.name as position_name,
       a.center_id, c.name as center_name, a.building_id, b.name as building_name, a.floor_id, f.label as floor_label,
       a.room_id, r.name as room_name, coalesce(a.report_time, ed.report_time) as report_time, a.expected_end_time,
       a.status, a.volunteer_response, a.confirmed_at, a.remarks, a.requirement_id, a.is_imported, a.created_at
from assignments a
join examination_events e on e.id = a.event_id
join examination_dates ed on ed.id = a.exam_date_id
join assignment_positions p on p.id = a.position_id
join examination_centers c on c.id = a.center_id
left join buildings b on b.id = a.building_id
left join floors f on f.id = a.floor_id
left join rooms r on r.id = a.room_id;

create view staffing_summary with (security_invoker = true) as
select sr.id as requirement_id, sr.event_id, sr.exam_date_id, sr.center_id, sr.building_id, sr.floor_id, sr.room_id, sr.position_id, sr.required_count,
       count(a.id) filter (where a.status in ('draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed', 'completed'))::integer as assigned_count,
       count(a.id) filter (where a.status in ('confirmed', 'completed'))::integer as confirmed_count,
       count(a.id) filter (where a.status in ('pending_approval', 'offered', 'awaiting_volunteer_confirmation'))::integer as awaiting_count,
       greatest(sr.required_count - count(a.id) filter (where a.status in ('draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed', 'completed')), 0)::integer as vacant_count
from staffing_requirements sr
left join assignments a on a.requirement_id = sr.id
group by sr.id;

-- ---------------------------------------------------------------- RLS
alter table approval_records enable row level security;
alter table assignments enable row level security;
alter table assignment_history enable row level security;
alter table assignment_transitions enable row level security;

create policy asg_self on assignments for select to authenticated
  using (volunteer_id = my_volunteer_id() and status not in ('draft', 'pending_approval', 'waitlisted'));
create policy asg_staff on assignments for select to authenticated using (has_permission('assignments.view'));
create policy asg_scoped on assignments for select to authenticated
  using (has_permission('assignments.view_scoped') and is_event_supervisor(event_id));
create policy asg_insert on assignments for insert to authenticated with check (has_permission('assignments.manage'));
create policy asg_update on assignments for update to authenticated
  using (has_permission('assignments.manage') or has_permission('assignments.approve'))
  with check (has_permission('assignments.manage') or has_permission('assignments.approve'));

create policy ahist_read on assignment_history for select to authenticated using (exists (select 1 from assignments a where a.id = assignment_id));
create policy atrans_read on assignment_transitions for select to authenticated using (true);
create policy approvals_read on approval_records for select to authenticated using (has_permission('audit.view') or has_permission('assignments.approve') or has_permission('cpd.approve') or has_permission('allowance.approve'));

grant select on assignments, assignment_history, assignment_transitions, approval_records, assignment_roster, staffing_summary to authenticated;
grant insert (event_id, exam_date_id, requirement_id, volunteer_id, external_id, position_id, center_id, building_id, floor_id, room_id,
  report_time, expected_end_time, remarks, conflict_override_reason) on assignments to authenticated;
grant update (position_id, center_id, building_id, floor_id, room_id, report_time, expected_end_time, remarks, conflict_override_reason, status, requirement_id) on assignments to authenticated;

grant execute on function volunteer_display_name(volunteer_profiles), volunteer_conflicts(uuid, uuid, uuid), set_assignment_status(uuid, assignment_status, text),
  release_assignments(uuid[]), decide_assignment(uuid, boolean, text), respond_assignment(uuid, text, text),
  reassign_assignment(uuid, uuid, uuid, text), candidate_pool(uuid, uuid) to authenticated;
