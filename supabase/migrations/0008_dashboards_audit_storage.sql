-- 0008_dashboards_audit_storage.sql
-- Management dashboard, audit triggers on business tables, private document storage policies.

create function management_dashboard() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Manila')::date; res jsonb;
begin
  perform require_permission('reports.view');
  res := jsonb_build_object(
    'volunteers_total', (select count(*) from volunteer_profiles where last_name is not null),
    'volunteers_verified', (select count(*) from volunteer_profiles where last_name is not null and verification_status = 'verified'),
    'volunteers_pending_verification', (select count(*) from volunteer_profiles vp join profiles p on p.id = vp.user_id
        where vp.verification_status in ('unverified', 'pending') and p.account_status in ('pending', 'active') and vp.last_name is not null),
    'volunteers_active', (select count(*) from profiles p join volunteer_profiles vp on vp.user_id = p.id where vp.last_name is not null and p.account_status = 'active'),
    'volunteers_available', (select count(distinct va.volunteer_id) from volunteer_availability va join examination_dates ed on ed.id = va.exam_date_id
        where va.available and ed.exam_date >= today),
    'events_upcoming', (select count(*) from examination_events where status in ('open_for_registration', 'under_staffing', 'assignments_released', 'ready_for_deployment', 'ongoing')),
    'staffing', (select jsonb_build_object(
        'required', coalesce(sum(s.required_count), 0), 'assigned', coalesce(sum(s.assigned_count), 0),
        'confirmed', coalesce(sum(s.confirmed_count), 0), 'awaiting', coalesce(sum(s.awaiting_count), 0), 'vacant', coalesce(sum(s.vacant_count), 0))
      from staffing_summary s join examination_events e on e.id = s.event_id
      where e.status in ('open_for_registration', 'under_staffing', 'assignments_released', 'ready_for_deployment', 'ongoing')),
    'confirmation_rate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status in ('confirmed', 'completed', 'no_show')) / count(*), 1) end
        from assignments where volunteer_id is not null and status in ('awaiting_volunteer_confirmation', 'confirmed', 'declined', 'completed', 'no_show')),
    'attendance_completion_rate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where verification_status = 'verified') / count(*), 1) end
        from attendance_records ar join examination_dates ed on ed.id = ar.exam_date_id where ed.exam_date <= today),
    'absences', (select count(*) from attendance_records where status = 'absent'),
    'substitutions', (select count(*) from assignments where status = 'reassigned'),
    'needs_staffing', coalesce((select jsonb_agg(x) from (
        select e.id, e.name, e.status, e.start_date, sum(s.required_count)::integer as required, sum(s.assigned_count)::integer as assigned, sum(s.vacant_count)::integer as vacant
          from staffing_summary s join examination_events e on e.id = s.event_id
         where e.status in ('open_for_registration', 'under_staffing', 'assignments_released', 'ready_for_deployment')
         group by e.id having sum(s.vacant_count) > 0 order by e.start_date nulls last limit 10) x), '[]'));
  if has_permission('allowance.view') then res := res || jsonb_build_object('allowance', allowance_dashboard(null)); end if;
  if has_permission('cpd.view') then res := res || jsonb_build_object('cpd', cpd_dashboard()); end if;
  return res;
end $$;
grant execute on function management_dashboard() to authenticated;

-- ---------------------------------------------------------------- audit triggers
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'user_roles', 'role_permissions', 'system_settings', 'professions', 'volunteer_profiles', 'professional_credentials',
    'employment_records', 'volunteer_financial', 'document_requirements', 'volunteer_documents', 'examination_centers', 'buildings',
    'floors', 'rooms', 'assignment_positions', 'position_eligibility_rules', 'examination_events', 'examination_dates', 'event_sites',
    'staffing_requirements', 'examination_preferences', 'external_personnel', 'import_batches', 'assignments', 'approval_records',
    'attendance_records', 'attendance_adjustments', 'allowance_rules', 'allowance_records', 'allowance_payments',
    'cpd_rules', 'cpd_records', 'cpd_adjustments']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- private document storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('volunteer-documents', 'volunteer-documents', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Objects live under "<auth user id>/<requirement code>/<uuid>.<ext>". No update/delete: evidence is retained.
create policy "docs_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'volunteer-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'volunteer-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_reviewer_read" on storage.objects for select to authenticated
  using (bucket_id = 'volunteer-documents' and public.has_permission('documents.review'));
