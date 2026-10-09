-- 0001_foundation.sql
-- Core identity, roles, permissions, audit log, settings and shared helpers.
-- Conventions
--   * Every table has RLS enabled (deny-by-default). Policies are explicit.
--   * Sensitive state changes go through SECURITY DEFINER functions or guard triggers.
--   * Timestamps are timestamptz (UTC); operational dates use Asia/Manila at display time.

-- Supabase grants new objects to anon/authenticated by default. Reverse that: every grant below is explicit.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------- enums
create type app_role as enum (
  'volunteer', 'admin', 'system_admin', 'coordinator', 'attendance_officer',
  'finance_officer', 'cpd_officer', 'supervisor', 'auditor'
);
create type account_status as enum ('pending', 'active', 'suspended', 'rejected');
create type verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type personnel_category as enum ('volunteer', 'prc_staff', 'pnp', 'other_external');

-- ---------------------------------------------------------------- sequences / helpers
create sequence volunteer_no_seq;
create sequence external_no_seq;
create sequence event_no_seq;
create sequence assignment_no_seq;
create sequence allowance_no_seq;
create sequence cpd_no_seq;

create function gen_code(prefix text, seq regclass) returns text
language sql volatile security definer set search_path = public as $$
  select prefix || '-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval(seq)::text, 6, '0')
$$;

create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles / roles
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  account_status account_status not null default 'pending',
  status_reason text,
  email_verified_at timestamptz,
  terms_accepted_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on profiles for each row execute function touch_updated_at();

create table user_roles (
  user_id uuid not null references profiles (id) on delete cascade,
  role app_role not null,
  granted_by uuid references profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table role_permissions (
  role app_role not null,
  permission text not null,
  primary key (role, permission)
);

-- Authoritative permission check. Suspended/rejected/pending accounts hold no staff permissions.
create function has_permission(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from user_roles ur
    join role_permissions rp on rp.role = ur.role
    join profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid() and rp.permission = p and pr.account_status = 'active'
  )
$$;

create function has_role(r app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur join profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = r and pr.account_status = 'active'
  )
$$;

create function is_active_account() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select account_status = 'active' from profiles where id = auth.uid()), false)
$$;

create function my_permissions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct rp.permission order by rp.permission), '{}')
  from user_roles ur
  join role_permissions rp on rp.role = ur.role
  join profiles pr on pr.id = ur.user_id
  where ur.user_id = auth.uid() and pr.account_status = 'active'
$$;

create function require_permission(p text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_permission(p) then
    raise exception 'Not authorized (%)', p using errcode = '42501';
  end if;
end $$;

-- Seed permission matrix (documented in docs/SECURITY.md)
insert into role_permissions (role, permission) values
  -- system administrator: access + technical settings only
  ('system_admin', 'users.manage'), ('system_admin', 'settings.manage'), ('system_admin', 'audit.view'), ('system_admin', 'reports.view'),
  -- administrator: full operations (no user/role management, no unmasked financial data)
  ('admin', 'volunteers.view'), ('admin', 'volunteers.verify'), ('admin', 'documents.review'), ('admin', 'credentials.verify'),
  ('admin', 'credentials.view'), ('admin', 'events.manage'), ('admin', 'events.view_all'), ('admin', 'positions.manage'),
  ('admin', 'venues.manage'), ('admin', 'preferences.view'), ('admin', 'assignments.view'), ('admin', 'assignments.manage'),
  ('admin', 'assignments.approve'), ('admin', 'external.view'), ('admin', 'external.manage'), ('admin', 'attendance.view'),
  ('admin', 'attendance.record'), ('admin', 'attendance.submit'), ('admin', 'attendance.verify'), ('admin', 'attendance.correct'),
  ('admin', 'allowance.view'), ('admin', 'allowance.approve'), ('admin', 'financial.view_masked'),
  ('admin', 'cpd.view'), ('admin', 'cpd.review'), ('admin', 'cpd.approve'), ('admin', 'cpd.adjust'),
  ('admin', 'reports.view'), ('admin', 'reports.export'), ('admin', 'audit.view'), ('admin', 'announcements.send'),
  ('admin', 'imports.manage'), ('admin', 'settings.manage'), ('admin', 'allowance.rules.manage'), ('admin', 'cpd.rules.manage'),
  -- examination personnel coordinator
  ('coordinator', 'volunteers.view'), ('coordinator', 'credentials.view'), ('coordinator', 'events.manage'),
  ('coordinator', 'events.view_all'), ('coordinator', 'preferences.view'), ('coordinator', 'assignments.view'),
  ('coordinator', 'assignments.manage'), ('coordinator', 'external.view'), ('coordinator', 'external.manage'),
  ('coordinator', 'attendance.view'), ('coordinator', 'reports.view'), ('coordinator', 'imports.manage'),
  -- attendance / operations officer
  ('attendance_officer', 'events.view_all'), ('attendance_officer', 'assignments.view'), ('attendance_officer', 'external.view'),
  ('attendance_officer', 'attendance.view'), ('attendance_officer', 'attendance.record'), ('attendance_officer', 'attendance.submit'),
  -- finance / allowance officer
  ('finance_officer', 'events.view_all'), ('finance_officer', 'allowance.view'), ('finance_officer', 'allowance.process'),
  ('finance_officer', 'payments.record'), ('finance_officer', 'financial.view_masked'), ('finance_officer', 'financial.view_sensitive'),
  ('finance_officer', 'attendance.view'), ('finance_officer', 'allowance.rules.manage'), ('finance_officer', 'reports.view'),
  ('finance_officer', 'reports.export'),
  -- CPD / participation records officer
  ('cpd_officer', 'events.view_all'), ('cpd_officer', 'credentials.view'), ('cpd_officer', 'attendance.view'),
  ('cpd_officer', 'cpd.view'), ('cpd_officer', 'cpd.review'), ('cpd_officer', 'cpd.approve'), ('cpd_officer', 'cpd.adjust'),
  ('cpd_officer', 'cpd.rules.manage'), ('cpd_officer', 'reports.view'), ('cpd_officer', 'reports.export'),
  -- examination supervisor (scoped to events they supervise)
  ('supervisor', 'assignments.view_scoped'), ('supervisor', 'attendance.view_scoped'),
  ('supervisor', 'attendance.record_scoped'), ('supervisor', 'attendance.submit_scoped'),
  -- read-only management / auditor
  ('auditor', 'events.view_all'), ('auditor', 'assignments.view'), ('auditor', 'external.view'), ('auditor', 'attendance.view'),
  ('auditor', 'allowance.view'), ('auditor', 'financial.view_masked'), ('auditor', 'cpd.view'), ('auditor', 'reports.view'),
  ('auditor', 'audit.view');

-- ---------------------------------------------------------------- audit log
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  record_type text not null,
  record_id text,
  before_values jsonb,
  after_values jsonb,
  reason text,
  correlation_id text
);
create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_record_idx on audit_logs (record_type, record_id);
create index audit_logs_actor_idx on audit_logs (actor_id);

create function audit_logs_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs are append-only';
end $$;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

-- Removes secrets from audit payloads. Complete TIN / bank numbers never reach the log.
create function audit_redact(j jsonb) returns jsonb language sql immutable as $$
  select j - 'tin' - 'bank_account_no' - 'password' - 'token' - 'secret'
$$;

create function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; k text; bo jsonb := '{}'; bn jsonb := '{}'; rid text; full_row jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then o := audit_redact(to_jsonb(old)); end if;
  if tg_op in ('INSERT', 'UPDATE') then n := audit_redact(to_jsonb(new)); end if;
  full_row := coalesce(n, o);
  rid := coalesce(full_row ->> 'id', full_row ->> 'volunteer_id', full_row ->> 'key',
                  (full_row ->> 'user_id') || ':' || coalesce(full_row ->> 'role', ''));
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (o -> k) is distinct from (n -> k) then
        bo := bo || jsonb_build_object(k, o -> k);
        bn := bn || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if bn = '{}'::jsonb then return new; end if;
    o := bo; n := bn;
  end if;
  insert into audit_logs (actor_id, action, record_type, record_id, before_values, after_values, reason, correlation_id)
  values (auth.uid(), lower(tg_op), tg_table_name, rid, o, n,
          nullif(current_setting('app.reason', true), ''), txid_current()::text);
  return coalesce(new, old);
end $$;

-- Explicit business event (e.g. sensitive read, export).
create function log_event(p_action text, p_type text, p_id text, p_details jsonb default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (actor_id, action, record_type, record_id, after_values, reason, correlation_id)
  values (auth.uid(), p_action, p_type, p_id, p_details, p_reason, txid_current()::text);
end $$;

create function log_export(p_report text, p_filters jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('reports.export');
  perform log_event('export', 'report', p_report, p_filters);
end $$;

-- ---------------------------------------------------------------- settings
create table system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

insert into system_settings (key, value, description) values
  ('branding.office_name', '"Professional Regulation Commission — Regional Office III"', 'Regional office display name'),
  ('branding.portal_name', '"Licensure Examination Personnel Portal"', 'Portal title'),
  ('branding.tagline', '"One Portal. Organized Examination Operations."', 'Portal tagline'),
  ('branding.office_address', '"Regional Office III, San Fernando, Pampanga"', 'Office address (edit as needed)'),
  ('preferences.max_active', '5', 'Maximum simultaneous active examination preferences per volunteer'),
  ('assignment.confirmation_requires_approval', 'false', 'If true, a volunteer acceptance must be approved by PRC before the assignment is Confirmed'),
  ('attendance.late_after_minutes', '15', 'Minutes after reporting time before check-in is flagged Late'),
  ('retention.financial_data_years', '10', 'Retention period for financial data (subject to PRC records policy)'),
  ('retention.personal_data_years', '5', 'Retention period for inactive volunteer personal data (subject to PRC records policy)'),
  ('recommendation.weights', '{"availability":30,"preference":20,"position":15,"qualification":10,"experience":10,"reliability":10,"fairness":10,"shortage":5}', 'Weights used by assisted assignment ranking');

create function setting_json(p_key text) returns jsonb language sql stable security definer set search_path = public as $$
  select value from system_settings where key = p_key
$$;

create function update_setting(p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('settings.manage');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', p_reason, true);
  update system_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown setting %', p_key; end if;
end $$;

-- ---------------------------------------------------------------- account lifecycle
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare accepted boolean := coalesce((new.raw_user_meta_data ->> 'terms_accepted')::boolean, false);
begin
  insert into profiles (id, email, terms_accepted_at, email_verified_at)
  values (new.id, new.email, case when accepted then now() end, new.email_confirmed_at);
  -- Role is NEVER taken from client-supplied metadata.
  insert into user_roles (user_id, role) values (new.id, 'volunteer');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function sync_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles
     set email = new.email,
         email_verified_at = new.email_confirmed_at,
         last_login_at = coalesce(new.last_sign_in_at, last_login_at)
   where id = new.id;
  return new;
end $$;
create trigger on_auth_user_updated after update on auth.users for each row execute function sync_auth_user();

create function set_account_status(p_user uuid, p_status account_status, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_permission('volunteers.verify') or has_permission('users.manage')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own account status'; end if;
  if p_status in ('rejected', 'suspended') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update profiles set account_status = p_status, status_reason = p_reason where id = p_user;
end $$;

-- ---------------------------------------------------------------- user & role management
create function grant_role(p_user uuid, p_role app_role, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('users.manage');
  if p_user = auth.uid() then raise exception 'You cannot change your own roles'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into user_roles (user_id, role, granted_by) values (p_user, p_role, auth.uid()) on conflict do nothing;
end $$;

create function revoke_role(p_user uuid, p_role app_role, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('users.manage');
  if p_user = auth.uid() then raise exception 'You cannot change your own roles'; end if;
  if p_role = 'volunteer' then raise exception 'The volunteer role cannot be revoked'; end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  delete from user_roles where user_id = p_user and role = p_role;
end $$;

-- Staff directory for user management (no volunteer personal data).
create view user_directory with (security_invoker = true) as
select p.id, p.email, p.account_status, p.created_at, p.last_login_at,
       coalesce((select array_agg(ur.role order by ur.role) from user_roles ur where ur.user_id = p.id), '{}') as roles
from profiles p;

-- ---------------------------------------------------------------- notifications
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  category text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

create table notification_preferences (
  user_id uuid not null references profiles (id) on delete cascade,
  category text not null,
  in_app boolean not null default true,
  email boolean not null default false,
  primary key (user_id, category)
);

-- Internal: respects the recipient's in-app preference. Email is NOT sent by the database (see docs/EMAIL.md).
create function notify(p_user uuid, p_category text, p_title text, p_body text default null, p_link text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  if exists (select 1 from notification_preferences where user_id = p_user and category = p_category and not in_app) then return; end if;
  insert into notifications (user_id, category, title, body, link) values (p_user, p_category, p_title, p_body, p_link);
end $$;

create function send_announcement(p_title text, p_body text, p_audience text, p_event uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform require_permission('announcements.send');
  if coalesce(btrim(p_title), '') = '' then raise exception 'Title is required'; end if;
  if p_audience = 'all_volunteers' then
    insert into notifications (user_id, category, title, body, link)
    select ur.user_id, 'announcements', p_title, p_body, '/notifications'
      from user_roles ur join profiles pr on pr.id = ur.user_id
     where ur.role = 'volunteer' and pr.account_status = 'active'
       and not exists (select 1 from notification_preferences np where np.user_id = ur.user_id and np.category = 'announcements' and not np.in_app);
  elsif p_audience = 'event_volunteers' and p_event is not null then
    insert into notifications (user_id, category, title, body, link)
    select distinct vp.user_id, 'announcements', p_title, p_body, '/notifications'
      from volunteer_profiles vp
     where (exists (select 1 from examination_preferences ep where ep.volunteer_id = vp.id and ep.event_id = p_event)
         or exists (select 1 from assignments a where a.volunteer_id = vp.id and a.event_id = p_event))
       and not exists (select 1 from notification_preferences np where np.user_id = vp.user_id and np.category = 'announcements' and not np.in_app);
  else
    raise exception 'Invalid audience';
  end if;
  get diagnostics n = row_count;
  perform log_event('announcement', 'notifications', null, jsonb_build_object('title', p_title, 'audience', p_audience, 'event_id', p_event, 'recipients', n));
  return n;
end $$;

-- ---------------------------------------------------------------- RLS
alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table role_permissions enable row level security;
alter table audit_logs enable row level security;
alter table system_settings enable row level security;
alter table notifications enable row level security;
alter table notification_preferences enable row level security;

create policy notif_own on notifications for select to authenticated using (user_id = auth.uid());
create policy notif_own_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_pref_own on notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy profiles_self_read on profiles for select to authenticated using (id = auth.uid());
create policy profiles_staff_read on profiles for select to authenticated
  using (has_permission('volunteers.view') or has_permission('users.manage') or has_permission('volunteers.verify'));
create policy profiles_audit_read on profiles for select to authenticated using (has_permission('audit.view'));

create policy roles_self_read on user_roles for select to authenticated using (user_id = auth.uid());
create policy roles_admin_read on user_roles for select to authenticated using (has_permission('users.manage'));
create policy perms_read on role_permissions for select to authenticated using (true);

create policy audit_read on audit_logs for select to authenticated using (has_permission('audit.view'));

create policy settings_read on system_settings for select to authenticated using (true);
create policy settings_branding_public on system_settings for select to anon using (key like 'branding.%');

-- ---------------------------------------------------------------- grants (least privilege)
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public;

grant select on profiles, user_roles, role_permissions, audit_logs, system_settings, user_directory to authenticated;
grant select on system_settings to anon;
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
grant select, insert, update, delete on notification_preferences to authenticated;
grant execute on function send_announcement(text, text, text, uuid) to authenticated;

grant execute on function gen_code(text, regclass), has_permission(text), has_role(app_role), is_active_account(), my_permissions(),
  log_export(text, jsonb), update_setting(text, jsonb, text), set_account_status(uuid, account_status, text),
  grant_role(uuid, app_role, text), revoke_role(uuid, app_role, text), setting_json(text) to authenticated;
-- anon only needs branding settings (policy-limited), no function access.
