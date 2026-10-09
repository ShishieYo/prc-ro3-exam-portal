-- 0009_helpers.sql
-- Small read helpers for the UI that must not expose broader tables.

-- Active supervisors, for the event form. Only event managers may call it.
create function list_supervisors() returns table (id uuid, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email
    from profiles p
    join user_roles ur on ur.user_id = p.id and ur.role = 'supervisor'
   where p.account_status = 'active' and has_permission('events.manage')
   order by p.email
$$;

-- Actor emails for audit log display (audit viewers only).
create function actor_emails(p_ids uuid[]) returns table (id uuid, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email from profiles p where p.id = any (p_ids) and has_permission('audit.view')
$$;

grant execute on function list_supervisors(), actor_emails(uuid[]) to authenticated;

-- Deactivate a versioned rule with a documented reason (rules are otherwise immutable).
create function deactivate_rule(p_kind text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('app.reason', p_reason, true);
  if p_kind = 'allowance' then
    perform require_permission('allowance.rules.manage');
    update allowance_rules set active = false, effective_to = greatest((now() at time zone 'Asia/Manila')::date, effective_from) where id = p_id;
  elsif p_kind = 'cpd' then
    perform require_permission('cpd.rules.manage');
    update cpd_rules set active = false, effective_to = greatest((now() at time zone 'Asia/Manila')::date, effective_from) where id = p_id;
  else
    raise exception 'Unknown rule kind';
  end if;
  if not found then raise exception 'Rule not found'; end if;
end $$;
grant execute on function deactivate_rule(text, uuid, text) to authenticated;
