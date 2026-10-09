-- 0003_events.sql
-- Venues, examination events, positions, staffing requirements, availability, preferences, external personnel.

-- ---------------------------------------------------------------- venues
create table examination_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text not null default 'Region III',
  province text,
  city_municipality text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, city_municipality)
);
create table buildings (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references examination_centers (id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique (center_id, name)
);
create table floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings (id) on delete cascade,
  label text not null,
  level_no integer not null default 1,
  unique (building_id, label)
);
create table rooms (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references floors (id) on delete cascade,
  name text not null,
  capacity integer check (capacity is null or capacity > 0),
  active boolean not null default true,
  unique (floor_id, name)
);
create trigger centers_touch before update on examination_centers for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- positions
create table assignment_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  personnel_type personnel_category not null default 'volunteer',
  requires_registered_professional boolean not null default false,
  requires_verified_license boolean not null default false,
  required_training text,
  default_headcount integer not null default 1 check (default_headcount >= 0),
  min_staffing integer check (min_staffing is null or min_staffing >= 0),
  max_staffing integer check (max_staffing is null or max_staffing >= 0),
  allowance_eligible boolean not null default false,
  cpd_eligible boolean not null default false,
  attendance_verification_required boolean not null default true,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_staffing is null or max_staffing is null or min_staffing <= max_staffing)
);
create trigger positions_touch before update on assignment_positions for each row execute function touch_updated_at();

create table position_eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references assignment_positions (id) on delete cascade,
  rule_type text not null check (rule_type in ('profession', 'min_prior_assignments', 'training', 'other')),
  rule_value text not null,
  description text
);

-- Initial catalogue. Allowance / CPD eligibility are conservative defaults pending PRC policy confirmation.
insert into assignment_positions (name, description, personnel_type, requires_registered_professional, requires_verified_license, default_headcount, allowance_eligible, cpd_eligible, sort_order) values
  ('Building Supervisor', 'Oversees all examination operations within a building', 'volunteer', true, true, 1, true, true, 1),
  ('Floor Supervisor', 'Supervises examination rooms on a floor', 'volunteer', true, true, 1, true, true, 2),
  ('Room Watcher', 'Monitors examinees inside an examination room', 'volunteer', false, false, 2, true, true, 3),
  ('Supply Officer', 'Manages examination materials and supplies', 'volunteer', false, false, 1, true, true, 4),
  ('Supply Aide', 'Assists the Supply Officer', 'volunteer', false, false, 1, true, true, 5);
insert into assignment_positions (name, description, personnel_type, default_headcount, allowance_eligible, cpd_eligible, sort_order) values
  ('PNP Personnel', 'Police security detail assigned to the examination venue', 'pnp', 1, false, false, 6);

-- ---------------------------------------------------------------- events
create type event_status as enum (
  'draft', 'open_for_registration', 'under_staffing', 'assignments_released', 'ready_for_deployment',
  'ongoing', 'completed', 'cancelled', 'archived'
);

create table examination_events (
  id uuid primary key default gen_random_uuid(),
  event_no text not null unique default gen_code('EXM', 'event_no_seq'),
  name text not null,
  profession_id uuid references professions (id),
  exam_type text,
  start_date date,
  end_date date,
  recruitment_open date,
  recruitment_close date,
  confirmation_deadline date,
  status event_status not null default 'draft',
  staffing_target integer check (staffing_target is null or staffing_target >= 0),
  supervisor_id uuid references profiles (id),
  instructions text,
  internal_remarks text,
  created_by uuid references profiles (id) default auth.uid(),
  updated_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recruitment_open is null or recruitment_close is null or recruitment_open <= recruitment_close)
);
create index events_status_idx on examination_events (status);
create index events_dates_idx on examination_events (start_date, end_date);
create index events_profession_idx on examination_events (profession_id);

create table examination_dates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references examination_events (id) on delete cascade,
  exam_date date not null,
  report_time time,
  start_time time,
  end_time time,
  notes text,
  unique (event_id, exam_date),
  check (start_time is null or end_time is null or start_time < end_time)
);
create index exam_dates_date_idx on examination_dates (exam_date);

create table event_sites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references examination_events (id) on delete cascade,
  center_id uuid not null references examination_centers (id),
  building_id uuid references buildings (id),
  unique nulls not distinct (event_id, center_id, building_id)
);

create table staffing_requirements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references examination_events (id) on delete cascade,
  exam_date_id uuid references examination_dates (id) on delete cascade,
  center_id uuid not null references examination_centers (id),
  building_id uuid references buildings (id),
  floor_id uuid references floors (id),
  room_id uuid references rooms (id),
  position_id uuid not null references assignment_positions (id),
  required_count integer not null check (required_count > 0),
  notes text,
  unique nulls not distinct (event_id, exam_date_id, center_id, building_id, floor_id, room_id, position_id)
);
create index staffing_req_event_idx on staffing_requirements (event_id);

create function is_event_supervisor(p_event uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from examination_events where id = p_event and supervisor_id = auth.uid())
$$;

-- keep start/end in sync with the scheduled dates
create function sync_event_dates() returns trigger language plpgsql security definer set search_path = public as $$
declare eid uuid := coalesce(new.event_id, old.event_id);
begin
  update examination_events e set
    start_date = (select min(exam_date) from examination_dates where event_id = eid),
    end_date = (select max(exam_date) from examination_dates where event_id = eid)
  where e.id = eid;
  return null;
end $$;
create trigger exam_dates_sync after insert or update or delete on examination_dates for each row execute function sync_event_dates();

create function event_status_rank(s event_status) returns integer language sql immutable as $$
  select case s when 'draft' then 0 when 'open_for_registration' then 1 when 'under_staffing' then 2
    when 'assignments_released' then 3 when 'ready_for_deployment' then 4 when 'ongoing' then 5
    when 'completed' then 6 when 'cancelled' then 7 when 'archived' then 8 end
$$;

create function events_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare problems text[] := '{}';
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.created_by := auth.uid();
    return new;
  end if;
  new.updated_by := auth.uid();
  if new.status is distinct from old.status then
    if old.status = 'archived' then raise exception 'Archived events cannot change status'; end if;
    if new.status = 'cancelled' then
      if old.status in ('completed', 'archived') then raise exception 'A completed event cannot be cancelled'; end if;
    elsif new.status = 'archived' then
      if old.status not in ('completed', 'cancelled') then raise exception 'Only completed or cancelled events can be archived'; end if;
    elsif new.status = 'draft' then
      raise exception 'An event cannot return to Draft';
    elsif old.status = 'cancelled' or event_status_rank(new.status) <= event_status_rank(old.status) then
      raise exception 'Invalid status change % -> %', old.status, new.status;
    end if;
    if old.status = 'draft' and new.status <> 'cancelled' then
      -- publication checklist
      if new.profession_id is null then problems := array_append(problems, 'profession'); end if;
      if not exists (select 1 from examination_dates where event_id = new.id) then problems := array_append(problems, 'examination dates'); end if;
      if not exists (select 1 from event_sites where event_id = new.id) then problems := array_append(problems, 'venue'); end if;
      if not exists (select 1 from staffing_requirements where event_id = new.id) then problems := array_append(problems, 'staffing requirements'); end if;
      if new.recruitment_open is null or new.recruitment_close is null then problems := array_append(problems, 'recruitment period'); end if;
      if new.confirmation_deadline is null then problems := array_append(problems, 'confirmation deadline'); end if;
      if array_length(problems, 1) > 0 then
        raise exception 'Event is incomplete and cannot be published. Missing: %', array_to_string(problems, ', ');
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger events_guard_trg before insert or update on examination_events for each row execute function events_guard();
create trigger events_touch before update on examination_events for each row execute function touch_updated_at();

create function set_event_status(p_event uuid, p_status event_status, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('events.manage');
  if p_status in ('cancelled', 'archived') and coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update examination_events set status = p_status where id = p_event;
  if not found then raise exception 'Event not found'; end if;
  if p_status = 'cancelled' then
    perform set_config('app.system_action', 'on', true);
    update assignments set status = 'cancelled' where event_id = p_event and status in ('draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed');
    perform set_config('app.system_action', 'off', true);
    insert into notifications (user_id, category, title, body, link)
    select distinct vp.user_id, 'assignments', 'Examination cancelled',
           (select name from examination_events where id = p_event) || ' has been cancelled.' || coalesce(' Reason: ' || p_reason, ''), '/assignments'
      from assignments a join volunteer_profiles vp on vp.id = a.volunteer_id where a.event_id = p_event;
  end if;
end $$;

-- ---------------------------------------------------------------- availability & preferences
create table volunteer_availability (
  volunteer_id uuid not null references volunteer_profiles (id) on delete cascade,
  exam_date_id uuid not null references examination_dates (id) on delete cascade,
  available boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (volunteer_id, exam_date_id)
);

create type preference_status as enum ('pending', 'shortlisted', 'assigned', 'waitlisted', 'declined', 'withdrawn');

create table examination_preferences (
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer_profiles (id) on delete cascade,
  event_id uuid not null references examination_events (id) on delete cascade,
  rank integer not null default 1 check (rank > 0),
  preferred_position_ids uuid[] not null default '{}',
  preferred_center_ids uuid[] not null default '{}',
  status preference_status not null default 'pending',
  remarks text,
  staff_remarks text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (volunteer_id, event_id)
);
create index preferences_event_idx on examination_preferences (event_id, status);
create trigger preferences_touch before update on examination_preferences for each row execute function touch_updated_at();

create function submit_preference(p_event uuid, p_rank integer, p_positions uuid[], p_centers uuid[], p_dates uuid[], p_remarks text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := my_volunteer_id(); e examination_events; existing examination_preferences; maxp integer; active_n integer; d record; pid uuid; today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not is_active_account() then raise exception 'Your account must be approved before you can submit preferences'; end if;
  select * into e from examination_events where id = p_event;
  if not found or e.status <> 'open_for_registration' then raise exception 'This examination is not open for preferences'; end if;
  if today < e.recruitment_open or today > e.recruitment_close then raise exception 'The recruitment period is closed'; end if;
  select * into existing from examination_preferences where volunteer_id = v and event_id = p_event;
  if found and existing.status not in ('pending', 'withdrawn') then raise exception 'This preference can no longer be changed (status: %)', existing.status; end if;
  maxp := coalesce((setting_json('preferences.max_active'))::text::integer, 5);
  select count(*) into active_n from examination_preferences where volunteer_id = v and status in ('pending', 'shortlisted') and event_id <> p_event;
  if active_n >= maxp then raise exception 'You can have at most % active preferences', maxp; end if;
  if p_dates is null or coalesce(array_length(p_dates, 1), 0) = 0 then raise exception 'Select at least one available date'; end if;
  for d in select ed.id, ed.exam_date from examination_dates ed where ed.event_id = p_event and ed.id = any (p_dates) loop
    if exists (select 1 from volunteer_conflicts(v, d.id)) then
      raise exception 'Schedule conflict: you already have an assignment on %', to_char(d.exam_date, 'Mon DD, YYYY');
    end if;
  end loop;
  insert into examination_preferences (volunteer_id, event_id, rank, preferred_position_ids, preferred_center_ids, status, remarks)
  values (v, p_event, greatest(coalesce(p_rank, 1), 1), coalesce(p_positions, '{}'), coalesce(p_centers, '{}'), 'pending', p_remarks)
  on conflict (volunteer_id, event_id) do update
    set rank = excluded.rank, preferred_position_ids = excluded.preferred_position_ids,
        preferred_center_ids = excluded.preferred_center_ids, remarks = excluded.remarks, status = 'pending', submitted_at = now()
  returning id into pid;
  insert into volunteer_availability (volunteer_id, exam_date_id, available)
  select v, ed.id, (ed.id = any (p_dates)) from examination_dates ed where ed.event_id = p_event
  on conflict (volunteer_id, exam_date_id) do update set available = excluded.available, updated_at = now();
  perform notify(auth.uid(), 'preferences', 'Preference submitted', e.name || ': your preference is pending review. A preference is not an assignment.', '/preferences');
  return pid;
end $$;

create function withdraw_preference(p_preference uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p examination_preferences; e examination_events;
begin
  select * into p from examination_preferences where id = p_preference and volunteer_id = my_volunteer_id();
  if not found then raise exception 'Preference not found'; end if;
  select * into e from examination_events where id = p.event_id;
  if p.status not in ('pending', 'shortlisted', 'waitlisted') then raise exception 'This preference can no longer be withdrawn'; end if;
  if e.status <> 'open_for_registration' and e.status <> 'under_staffing' then raise exception 'This preference can no longer be withdrawn'; end if;
  update examination_preferences set status = 'withdrawn' where id = p_preference;
end $$;

create function set_preference_status(p_preference uuid, p_status preference_status, p_remarks text default null) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid; ename text;
begin
  perform require_permission('assignments.manage');
  if p_status in ('withdrawn', 'pending') then raise exception 'Invalid status'; end if;
  update examination_preferences set status = p_status, staff_remarks = p_remarks where id = p_preference;
  if not found then raise exception 'Preference not found'; end if;
  select vp.user_id, e.name into owner, ename from examination_preferences ep
    join volunteer_profiles vp on vp.id = ep.volunteer_id join examination_events e on e.id = ep.event_id where ep.id = p_preference;
  perform notify(owner, 'preferences', 'Preference update', ename || ': your preference is now ' || p_status::text || '.', '/preferences');
end $$;

-- ---------------------------------------------------------------- external personnel (no portal accounts)
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  file_name text,
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  rejected_rows integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table external_personnel (
  id uuid primary key default gen_random_uuid(),
  ext_no text not null unique default gen_code('EXT', 'external_no_seq'),
  full_name text not null,
  category personnel_category not null default 'pnp' check (category in ('pnp', 'other_external')),
  rank_position text,
  agency_unit text,
  contact_info text,
  allowance_eligible boolean not null default false,
  remarks text,
  active boolean not null default true,
  import_batch_id uuid references import_batches (id),
  created_by uuid references profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Exact duplicates are rejected; merely similar names are flagged in the UI, never auto-merged.
create unique index external_personnel_dedupe on external_personnel
  (lower(btrim(full_name)), lower(btrim(coalesce(agency_unit, ''))), lower(btrim(coalesce(rank_position, ''))));
create trigger external_touch before update on external_personnel for each row execute function touch_updated_at();

-- Transactional import: valid rows are saved, invalid rows are reported (never silently skipped).
create function import_external_personnel(p_file text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i integer := 0; ok integer := 0; errs jsonb := '[]'; batch uuid; nm text; cat text;
begin
  perform require_permission('imports.manage');
  insert into import_batches (kind, file_name, total_rows) values ('external_personnel', p_file, jsonb_array_length(p_rows)) returning id into batch;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    nm := nullif(btrim(r ->> 'full_name'), '');
    cat := coalesce(nullif(lower(btrim(r ->> 'category')), ''), 'pnp');
    begin
      if nm is null then raise exception 'full_name is required'; end if;
      if cat not in ('pnp', 'other_external') then raise exception 'category must be pnp or other_external'; end if;
      insert into external_personnel (full_name, category, rank_position, agency_unit, contact_info, allowance_eligible, remarks, import_batch_id)
      values (nm, cat::personnel_category, nullif(btrim(r ->> 'rank_position'), ''), nullif(btrim(r ->> 'agency_unit'), ''),
              nullif(btrim(r ->> 'contact_info'), ''), coalesce((r ->> 'allowance_eligible')::boolean, false), nullif(btrim(r ->> 'remarks'), ''), batch);
      ok := ok + 1;
    exception when others then
      errs := errs || jsonb_build_array(jsonb_build_object('row', i + 1, 'name', nm,
        'error', case when sqlstate = '23505' then 'Duplicate of an existing record' else sqlerrm end));
    end;
  end loop;
  update import_batches set imported_rows = ok, rejected_rows = i - ok, errors = errs where id = batch;
  perform log_event('import', 'import_batches', batch::text, jsonb_build_object('imported', ok, 'rejected', i - ok));
  return jsonb_build_object('batch_id', batch, 'total', i, 'imported', ok, 'rejected', i - ok, 'errors', errs);
end $$;

-- ---------------------------------------------------------------- RLS
alter table examination_centers enable row level security;
alter table buildings enable row level security;
alter table floors enable row level security;
alter table rooms enable row level security;
alter table assignment_positions enable row level security;
alter table position_eligibility_rules enable row level security;
alter table examination_events enable row level security;
alter table examination_dates enable row level security;
alter table event_sites enable row level security;
alter table staffing_requirements enable row level security;
alter table volunteer_availability enable row level security;
alter table examination_preferences enable row level security;
alter table external_personnel enable row level security;
alter table import_batches enable row level security;

-- reference data readable by any signed-in user, writable by venue/position managers
create policy centers_read on examination_centers for select to authenticated using (true);
create policy centers_write on examination_centers for all to authenticated using (has_permission('venues.manage')) with check (has_permission('venues.manage'));
create policy buildings_read on buildings for select to authenticated using (true);
create policy buildings_write on buildings for all to authenticated using (has_permission('venues.manage')) with check (has_permission('venues.manage'));
create policy floors_read on floors for select to authenticated using (true);
create policy floors_write on floors for all to authenticated using (has_permission('venues.manage')) with check (has_permission('venues.manage'));
create policy rooms_read on rooms for select to authenticated using (true);
create policy rooms_write on rooms for all to authenticated using (has_permission('venues.manage')) with check (has_permission('venues.manage'));
create policy positions_read on assignment_positions for select to authenticated using (true);
create policy positions_write on assignment_positions for all to authenticated using (has_permission('positions.manage')) with check (has_permission('positions.manage'));
create policy poselig_read on position_eligibility_rules for select to authenticated using (true);
create policy poselig_write on position_eligibility_rules for all to authenticated using (has_permission('positions.manage')) with check (has_permission('positions.manage'));

-- events: drafts/archived are staff-only; supervisors see events they supervise
create policy events_read on examination_events for select to authenticated using (
  status not in ('draft', 'archived') or has_permission('events.view_all') or supervisor_id = auth.uid());
create policy events_insert on examination_events for insert to authenticated with check (has_permission('events.manage'));
create policy events_update on examination_events for update to authenticated using (has_permission('events.manage')) with check (has_permission('events.manage'));

create policy edates_read on examination_dates for select to authenticated using (exists (select 1 from examination_events e where e.id = event_id));
create policy edates_write on examination_dates for all to authenticated using (has_permission('events.manage')) with check (has_permission('events.manage'));
create policy esites_read on event_sites for select to authenticated using (exists (select 1 from examination_events e where e.id = event_id));
create policy esites_write on event_sites for all to authenticated using (has_permission('events.manage')) with check (has_permission('events.manage'));
create policy sreq_read on staffing_requirements for select to authenticated using (exists (select 1 from examination_events e where e.id = event_id));
create policy sreq_write on staffing_requirements for all to authenticated using (has_permission('events.manage')) with check (has_permission('events.manage'));

create policy avail_self on volunteer_availability for select to authenticated using (volunteer_id = my_volunteer_id());
create policy avail_staff on volunteer_availability for select to authenticated using (has_permission('preferences.view'));
create policy pref_self on examination_preferences for select to authenticated using (volunteer_id = my_volunteer_id());
create policy pref_staff on examination_preferences for select to authenticated using (has_permission('preferences.view'));

create policy ext_read on external_personnel for select to authenticated using (has_permission('external.view'));
create policy ext_insert on external_personnel for insert to authenticated with check (has_permission('external.manage'));
create policy ext_update on external_personnel for update to authenticated using (has_permission('external.manage')) with check (has_permission('external.manage'));
create policy imports_read on import_batches for select to authenticated using (has_permission('imports.manage') or has_permission('audit.view'));

-- ---------------------------------------------------------------- grants
grant select on examination_centers, buildings, floors, rooms, assignment_positions, position_eligibility_rules,
  examination_events, examination_dates, event_sites, staffing_requirements, volunteer_availability,
  examination_preferences, external_personnel, import_batches to authenticated;
grant insert, update, delete on examination_centers, buildings, floors, rooms, assignment_positions, position_eligibility_rules,
  examination_dates, event_sites, staffing_requirements to authenticated;
grant insert (name, profession_id, exam_type, recruitment_open, recruitment_close, confirmation_deadline, staffing_target, supervisor_id, instructions, internal_remarks) on examination_events to authenticated;
grant update (name, profession_id, exam_type, recruitment_open, recruitment_close, confirmation_deadline, staffing_target, supervisor_id, instructions, internal_remarks, status) on examination_events to authenticated;
grant insert (full_name, category, rank_position, agency_unit, contact_info, allowance_eligible, remarks) on external_personnel to authenticated;
grant update (full_name, category, rank_position, agency_unit, contact_info, allowance_eligible, remarks, active) on external_personnel to authenticated;

grant execute on function is_event_supervisor(uuid), set_event_status(uuid, event_status, text),
  submit_preference(uuid, integer, uuid[], uuid[], uuid[], text), withdraw_preference(uuid),
  set_preference_status(uuid, preference_status, text), import_external_personnel(text, jsonb) to authenticated;
