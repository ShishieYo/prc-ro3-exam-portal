-- 0002_volunteers.sql
-- Volunteer profile, professional credentials, employment, restricted financial data, documents.

create type doc_status as enum ('submitted', 'under_review', 'verified', 'rejected', 'requires_resubmission');

create table professions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table volunteer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles (id) on delete cascade,
  volunteer_no text not null unique default gen_code('VOL', 'volunteer_no_seq'),
  last_name text,
  first_name text,
  middle_name text,
  name_extension text,
  preferred_name text,
  date_of_birth date,
  sex text check (sex in ('Female', 'Male')),
  mobile_no text,
  alt_contact_no text,
  address text,
  city_municipality text,
  province text,
  emergency_name text,
  emergency_relationship text,
  emergency_contact_no text,
  is_registered_professional boolean,
  experience_notes text,
  prior_assignments_notes text,
  skills text,
  training_certifications text,
  -- verification (staff-controlled; not writable by the volunteer)
  verification_status verification_status not null default 'unverified',
  verified_by uuid references profiles (id),
  verified_at timestamptz,
  verification_remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index volunteer_profiles_name_idx on volunteer_profiles (lower(last_name), lower(first_name));
create index volunteer_profiles_verif_idx on volunteer_profiles (verification_status);
create trigger volunteer_profiles_touch before update on volunteer_profiles for each row execute function touch_updated_at();

create function create_volunteer_profile() returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb;
begin
  select raw_user_meta_data into m from auth.users where id = new.id;
  insert into volunteer_profiles (user_id, first_name, last_name)
  values (new.id, nullif(btrim(m ->> 'first_name'), ''), nullif(btrim(m ->> 'last_name'), ''));
  return new;
end $$;
create trigger profiles_create_volunteer after insert on profiles for each row execute function create_volunteer_profile();

create function my_volunteer_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from volunteer_profiles where user_id = auth.uid()
$$;

create table professional_credentials (
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer_profiles (id) on delete cascade,
  profession_id uuid not null references professions (id),
  license_no text not null,
  initial_registration_date date,
  expiry_date date,
  registration_status text,
  verification_status verification_status not null default 'unverified',
  verified_by uuid references profiles (id),
  verified_at timestamptz,
  verification_remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (volunteer_id, profession_id)
);
create index credentials_verif_idx on professional_credentials (verification_status);
create trigger credentials_touch before update on professional_credentials for each row execute function touch_updated_at();

-- Self-declared license data is never trusted: any volunteer edit resets verification to pending.
create function credential_reset_verification() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
    new.verified_by := null; new.verified_at := null;
  elsif (new.license_no, new.profession_id, new.expiry_date, new.initial_registration_date)
        is distinct from (old.license_no, old.profession_id, old.expiry_date, old.initial_registration_date) then
    new.verification_status := 'pending';
    new.verified_by := null; new.verified_at := null; new.verification_remarks := null;
  end if;
  return new;
end $$;
create trigger credentials_reset before insert or update of license_no, profession_id, expiry_date, initial_registration_date
  on professional_credentials for each row execute function credential_reset_verification();

create table employment_records (
  volunteer_id uuid primary key references volunteer_profiles (id) on delete cascade,
  is_employed boolean not null default false,
  employer_name text,
  employer_address text,
  position text,
  sector text check (sector in ('Government', 'Private', 'Self-employed', 'Other')),
  updated_at timestamptz not null default now()
);
create trigger employment_touch before update on employment_records for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- restricted financial data
-- No direct table privileges for any API role. Access only through the functions below.
create table volunteer_financial (
  volunteer_id uuid primary key references volunteer_profiles (id) on delete cascade,
  tin text,
  tin_last4 text,
  bank_name text not null default 'LandBank of the Philippines',
  bank_account_no text,
  account_last4 text,
  account_holder text,
  bank_verification_status verification_status not null default 'unverified',
  bank_verified_by uuid references profiles (id),
  bank_verified_at timestamptz,
  finance_remarks text,
  updated_at timestamptz not null default now()
);
alter table volunteer_financial enable row level security; -- no policies: nothing is readable directly

create function mask_value(v text, prefix text) returns text language sql immutable as $$
  select case when v is null or v = '' then null else prefix || right(v, 4) end
$$;

create function financial_json(f volunteer_financial, full_values boolean) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'volunteer_id', f.volunteer_id,
    'has_tin', f.tin is not null,
    'tin_masked', mask_value(f.tin_last4, '•••-•••-•••-'),
    'has_account', f.bank_account_no is not null,
    'account_masked', mask_value(f.account_last4, '••••••'),
    'bank_name', f.bank_name,
    'account_holder', f.account_holder,
    'bank_verification_status', f.bank_verification_status,
    'finance_remarks', f.finance_remarks
  ) || case when full_values then jsonb_build_object('tin', f.tin, 'bank_account_no', f.bank_account_no) else '{}'::jsonb end
$$;

create function get_my_financial() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f volunteer_financial;
begin
  select * into f from volunteer_financial where volunteer_id = my_volunteer_id();
  if not found then return jsonb_build_object('has_tin', false, 'has_account', false, 'bank_verification_status', 'unverified'); end if;
  return financial_json(f, false);
end $$;

create function save_my_financial(p_tin text, p_account_no text, p_holder text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := my_volunteer_id(); t text; a text; cur volunteer_financial;
begin
  if v is null or not exists (select 1 from profiles where id = auth.uid() and account_status in ('pending', 'active')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  t := nullif(regexp_replace(coalesce(p_tin, ''), '[\s-]', '', 'g'), '');
  a := nullif(regexp_replace(coalesce(p_account_no, ''), '[\s-]', '', 'g'), '');
  if t is not null and t !~ '^\d{9,12}$' then raise exception 'TIN must be 9 to 12 digits'; end if;
  if a is not null and a !~ '^\d{8,20}$' then raise exception 'Account number must be 8 to 20 digits'; end if;
  insert into volunteer_financial (volunteer_id) values (v) on conflict do nothing;
  select * into cur from volunteer_financial where volunteer_id = v;
  update volunteer_financial set
    tin = coalesce(t, tin),
    tin_last4 = case when t is not null then right(t, 4) else tin_last4 end,
    bank_account_no = coalesce(a, bank_account_no),
    account_last4 = case when a is not null then right(a, 4) else account_last4 end,
    account_holder = coalesce(nullif(btrim(p_holder), ''), account_holder),
    -- changing the account invalidates any previous bank verification
    bank_verification_status = case when (a is not null and a is distinct from cur.bank_account_no)
                                       or (nullif(btrim(p_holder), '') is not null and nullif(btrim(p_holder), '') is distinct from cur.account_holder)
                                    then 'unverified' else bank_verification_status end,
    bank_verified_by = case when a is not null and a is distinct from cur.bank_account_no then null else bank_verified_by end,
    bank_verified_at = case when a is not null and a is distinct from cur.bank_account_no then null else bank_verified_at end,
    updated_at = now()
  where volunteer_id = v;
end $$;

create function get_financial_masked(p_volunteer uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f volunteer_financial;
begin
  perform require_permission('financial.view_masked');
  select * into f from volunteer_financial where volunteer_id = p_volunteer;
  if not found then return jsonb_build_object('volunteer_id', p_volunteer, 'has_tin', false, 'has_account', false, 'bank_verification_status', 'unverified'); end if;
  return financial_json(f, false);
end $$;

create function get_financial_full(p_volunteer uuid, p_purpose text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f volunteer_financial;
begin
  perform require_permission('financial.view_sensitive');
  if coalesce(btrim(p_purpose), '') = '' then raise exception 'A purpose is required to view full financial details'; end if;
  select * into f from volunteer_financial where volunteer_id = p_volunteer;
  perform log_event('sensitive_read', 'volunteer_financial', p_volunteer::text, jsonb_build_object('fields', 'tin,bank_account_no'), p_purpose);
  if not found then return jsonb_build_object('volunteer_id', p_volunteer, 'has_tin', false, 'has_account', false); end if;
  return financial_json(f, true);
end $$;

create function set_bank_verification(p_volunteer uuid, p_status verification_status, p_remarks text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('allowance.process');
  if p_status = 'rejected' and coalesce(btrim(p_remarks), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', coalesce(p_remarks, ''), true);
  update volunteer_financial
     set bank_verification_status = p_status, bank_verified_by = auth.uid(), bank_verified_at = now(), finance_remarks = p_remarks, updated_at = now()
   where volunteer_id = p_volunteer;
  if not found then raise exception 'No financial information on file'; end if;
end $$;

-- ---------------------------------------------------------------- documents
create table document_requirements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  required_for_assignment boolean not null default false,
  required_for_allowance boolean not null default false,
  registered_professional_only boolean not null default false,
  allowed_mime_types text[] not null default array['application/pdf', 'image/jpeg', 'image/png'],
  max_size_mb integer not null default 5 check (max_size_mb between 1 and 20),
  valid_for_days integer,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table volunteer_documents (
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer_profiles (id) on delete cascade,
  requirement_id uuid not null references document_requirements (id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status doc_status not null default 'submitted',
  expires_on date,
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  review_reason text,
  submitted_at timestamptz not null default now()
);
create index volunteer_documents_vol_idx on volunteer_documents (volunteer_id, requirement_id, submitted_at desc);
create index volunteer_documents_status_idx on volunteer_documents (status);

create function volunteer_documents_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r document_requirements; owner uuid;
begin
  select * into r from document_requirements where id = new.requirement_id and active;
  if not found then raise exception 'Unknown or inactive document requirement'; end if;
  select user_id into owner from volunteer_profiles where id = new.volunteer_id;
  if split_part(new.storage_path, '/', 1) <> owner::text then raise exception 'Invalid storage path'; end if;
  if not (new.mime_type = any (r.allowed_mime_types)) then raise exception 'File type % is not allowed for %', new.mime_type, r.name; end if;
  if new.size_bytes > r.max_size_mb * 1024 * 1024 then raise exception 'File exceeds the % MB limit', r.max_size_mb; end if;
  new.status := 'submitted'; new.reviewed_by := null; new.reviewed_at := null; new.review_reason := null;
  if r.valid_for_days is not null and new.expires_on is null then new.expires_on := (now() + make_interval(days => r.valid_for_days))::date; end if;
  return new;
end $$;
create trigger volunteer_documents_guard_ins before insert on volunteer_documents for each row execute function volunteer_documents_guard();

-- Current document per requirement with expiry applied.
create view volunteer_documents_current with (security_invoker = true) as
select distinct on (d.volunteer_id, d.requirement_id)
  d.*, case when d.expires_on is not null and d.expires_on < current_date then 'expired' else d.status::text end as effective_status
from volunteer_documents d
order by d.volunteer_id, d.requirement_id, d.submitted_at desc;

-- ---------------------------------------------------------------- review / verification RPCs
create function verify_volunteer(p_volunteer uuid, p_status verification_status, p_remarks text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('volunteers.verify');
  if p_status = 'rejected' and coalesce(btrim(p_remarks), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', coalesce(p_remarks, ''), true);
  update volunteer_profiles
     set verification_status = p_status, verified_by = auth.uid(), verified_at = now(), verification_remarks = p_remarks
   where id = p_volunteer;
  if not found then raise exception 'Volunteer not found'; end if;
end $$;

create function verify_credential(p_credential uuid, p_status verification_status, p_registration_status text default null, p_remarks text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_permission('credentials.verify');
  if p_status = 'rejected' and coalesce(btrim(p_remarks), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', coalesce(p_remarks, ''), true);
  -- bypass the reset trigger (only verification columns change here)
  update professional_credentials
     set verification_status = p_status, registration_status = coalesce(p_registration_status, registration_status),
         verified_by = auth.uid(), verified_at = now(), verification_remarks = p_remarks
   where id = p_credential;
  if not found then raise exception 'Credential not found'; end if;
end $$;

create function review_document(p_document uuid, p_status doc_status, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid; docname text;
begin
  perform require_permission('documents.review');
  if p_status = 'submitted' then raise exception 'Invalid review status'; end if;
  if p_status in ('rejected', 'requires_resubmission') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update volunteer_documents set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_reason = p_reason
   where id = p_document;
  if not found then raise exception 'Document not found'; end if;
  select vp.user_id, dr.name into owner, docname
    from volunteer_documents d join volunteer_profiles vp on vp.id = d.volunteer_id
    join document_requirements dr on dr.id = d.requirement_id where d.id = p_document;
  if p_status in ('verified', 'rejected', 'requires_resubmission') then
    perform notify(owner, 'documents', 'Document ' || replace(p_status::text, '_', ' '),
      docname || ' was marked ' || replace(p_status::text, '_', ' ') || coalesce(': ' || p_reason, '.'), '/profile/documents');
  end if;
end $$;

-- What still blocks a volunteer for a stage ('assignment' or 'allowance'). Single source of truth for UI + triggers.
create function _volunteer_blockers(p_volunteer uuid, p_stage text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare vp volunteer_profiles; res text[] := '{}'; r record; f volunteer_financial; reg boolean;
begin
  select * into vp from volunteer_profiles where id = p_volunteer;
  if not found then return array['Volunteer not found']; end if;
  if (select account_status from profiles where id = vp.user_id) <> 'active' then res := array_append(res, 'Account is not active'); end if;
  if vp.verification_status <> 'verified' then res := array_append(res, 'Volunteer profile is not verified'); end if;
  reg := coalesce(vp.is_registered_professional, false);
  for r in select * from document_requirements dr
            where dr.active and (dr.required_for_assignment and p_stage = 'assignment' or dr.required_for_allowance and p_stage = 'allowance')
              and (not dr.registered_professional_only or reg) loop
    if not exists (select 1 from volunteer_documents_current c
                    where c.volunteer_id = p_volunteer and c.requirement_id = r.id and c.effective_status = 'verified') then
      res := array_append(res, ('Document not verified: ' || r.name));
    end if;
  end loop;
  if p_stage = 'allowance' then
    select * into f from volunteer_financial where volunteer_id = p_volunteer;
    if not found or f.tin is null then res := array_append(res, 'TIN is missing'); end if;
    if not found or f.bank_account_no is null then res := array_append(res, 'Bank account is missing');
    elsif f.bank_verification_status <> 'verified' then res := array_append(res, 'Bank account is not verified'); end if;
  end if;
  return res;
end $$;

create function volunteer_blockers(p_volunteer uuid, p_stage text) returns text[]
language plpgsql stable security definer set search_path = public as $$
begin
  if not (p_volunteer = my_volunteer_id() or has_permission('volunteers.view') or has_permission('assignments.view')
          or has_permission('assignments.manage') or has_permission('allowance.view')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return _volunteer_blockers(p_volunteer, p_stage);
end $$;

-- ---------------------------------------------------------------- RLS + grants
create function is_active_account_or_pending() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select account_status in ('pending', 'active') from profiles where id = auth.uid()), false)
$$;

alter table professions enable row level security;
alter table volunteer_profiles enable row level security;
alter table professional_credentials enable row level security;
alter table employment_records enable row level security;
alter table document_requirements enable row level security;
alter table volunteer_documents enable row level security;

create policy professions_read on professions for select to authenticated using (true);
create policy professions_write on professions for all to authenticated
  using (has_permission('settings.manage')) with check (has_permission('settings.manage'));

create policy vp_self on volunteer_profiles for select to authenticated using (user_id = auth.uid());
create policy vp_staff on volunteer_profiles for select to authenticated using (has_permission('volunteers.view') or has_permission('audit.view'));
create policy vp_self_update on volunteer_profiles for update to authenticated
  using (user_id = auth.uid() and is_active_account_or_pending()) with check (user_id = auth.uid());

create policy cred_self on professional_credentials for select to authenticated using (volunteer_id = my_volunteer_id());
create policy cred_staff on professional_credentials for select to authenticated using (has_permission('credentials.view') or has_permission('volunteers.view'));
create policy cred_self_ins on professional_credentials for insert to authenticated with check (volunteer_id = my_volunteer_id());
create policy cred_self_upd on professional_credentials for update to authenticated
  using (volunteer_id = my_volunteer_id()) with check (volunteer_id = my_volunteer_id());
create policy cred_self_del on professional_credentials for delete to authenticated
  using (volunteer_id = my_volunteer_id() and verification_status <> 'verified');

create policy emp_self on employment_records for all to authenticated
  using (volunteer_id = my_volunteer_id()) with check (volunteer_id = my_volunteer_id());
create policy emp_staff on employment_records for select to authenticated using (has_permission('volunteers.view'));

create policy docreq_read on document_requirements for select to authenticated using (true);
create policy docreq_write on document_requirements for all to authenticated
  using (has_permission('settings.manage')) with check (has_permission('settings.manage'));

create policy vdoc_self on volunteer_documents for select to authenticated using (volunteer_id = my_volunteer_id());
create policy vdoc_staff on volunteer_documents for select to authenticated using (has_permission('documents.review'));
create policy vdoc_self_ins on volunteer_documents for insert to authenticated with check (volunteer_id = my_volunteer_id());

grant select on professions, document_requirements, volunteer_documents_current to authenticated;
grant insert, update, delete on professions, document_requirements to authenticated;
grant select on volunteer_profiles, professional_credentials, employment_records, volunteer_documents to authenticated;
-- Volunteers may edit only these personal fields. Verification columns are intentionally excluded.
grant update (last_name, first_name, middle_name, name_extension, preferred_name, date_of_birth, sex, mobile_no, alt_contact_no,
  address, city_municipality, province, emergency_name, emergency_relationship, emergency_contact_no, is_registered_professional,
  experience_notes, prior_assignments_notes, skills, training_certifications) on volunteer_profiles to authenticated;
grant insert (volunteer_id, profession_id, license_no, initial_registration_date, expiry_date) on professional_credentials to authenticated;
grant update (profession_id, license_no, initial_registration_date, expiry_date) on professional_credentials to authenticated;
grant delete on professional_credentials to authenticated;
grant insert, update, delete on employment_records to authenticated;
grant insert (volunteer_id, requirement_id, storage_path, file_name, mime_type, size_bytes, expires_on) on volunteer_documents to authenticated;

grant execute on function my_volunteer_id(), get_my_financial(), save_my_financial(text, text, text), get_financial_masked(uuid),
  get_financial_full(uuid, text), set_bank_verification(uuid, verification_status, text), verify_volunteer(uuid, verification_status, text),
  verify_credential(uuid, verification_status, text, text), review_document(uuid, doc_status, text), volunteer_blockers(uuid, text),
  is_active_account_or_pending() to authenticated;

-- ---------------------------------------------------------------- seed reference data
insert into professions (code, name) values
  ('ARCH', 'Architect'), ('CE', 'Civil Engineer'), ('CRIM', 'Criminologist'), ('CPA', 'Certified Public Accountant'),
  ('LET', 'Licensure Examination for Teachers'), ('NLE', 'Nurse'), ('PHARM', 'Pharmacist'), ('ME', 'Mechanical Engineer'),
  ('EE', 'Electrical Engineer'), ('SW', 'Social Worker');

insert into document_requirements (code, name, description, required_for_assignment, required_for_allowance, registered_professional_only, sort_order) values
  ('VALID_ID', 'Valid government-issued ID', 'Clear copy of one valid government ID', true, true, false, 1),
  ('PRC_ID', 'PRC ID / license evidence', 'PRC ID or certificate of registration', false, false, true, 2),
  ('BANK_PROOF', 'Bank account verification document', 'Proof of LandBank account (e.g. ATM card front or passbook page)', false, true, false, 3);
