import { describe, it, expect, beforeAll } from 'vitest'
import { as, q } from './harness'
import { buildWorld, assign, type World } from './fixture'

let w: World
beforeAll(async () => { w = await buildWorld() })

const run = (user: string | null, sql: string, params: unknown[] = []) => as(w.db, user, () => w.db.query(sql, params))

describe('authentication & anonymous access', () => {
  it('unauthenticated users cannot read private tables', async () => {
    for (const t of ['volunteer_profiles', 'profiles', 'assignments', 'audit_logs', 'volunteer_documents', 'allowance_records', 'cpd_records']) {
      await expect(run(null, `select * from ${t}`)).rejects.toThrow(/permission denied/)
    }
  })
  it('anonymous users can read only branding settings', async () => {
    const rows = (await run(null, `select key from system_settings`)).rows as { key: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.key.startsWith('branding.'))).toBe(true)
  })
})

describe('role assignment restrictions', () => {
  it('a volunteer cannot grant themselves a role (direct insert or RPC)', async () => {
    await expect(run(w.u.A, `insert into user_roles (user_id, role) values ($1,'admin')`, [w.u.A])).rejects.toThrow(/permission denied/)
    await expect(run(w.u.A, `select grant_role($1,'admin')`, [w.u.A])).rejects.toThrow(/Not authorized/)
  })
  it('an admin (operations) cannot manage roles; system admin can but not for themselves', async () => {
    await expect(run(w.u.admin, `select grant_role($1,'coordinator')`, [w.u.B])).rejects.toThrow(/Not authorized/)
    await expect(run(w.u.sysadmin, `select grant_role($1,'admin')`, [w.u.sysadmin])).rejects.toThrow(/own roles/)
    await run(w.u.sysadmin, `select grant_role($1,'coordinator','trial')`, [w.u.B])
    expect((await q(w.db, `select 1 from user_roles where user_id=$1 and role='coordinator'`, [w.u.B])).length).toBe(1)
    await run(w.u.sysadmin, `select revoke_role($1,'coordinator','done')`, [w.u.B])
  })
  it('client signup metadata cannot elevate the role', async () => {
    const roles = await q(w.db, `select role from user_roles where user_id=$1`, [w.u.B])
    expect(roles).toEqual([{ role: 'volunteer' }])
  })
  it('a volunteer cannot change their own account status or verification', async () => {
    await expect(run(w.u.C, `update profiles set account_status='active' where id=$1`, [w.u.C])).rejects.toThrow(/permission denied/)
    await expect(run(w.u.C, `update volunteer_profiles set verification_status='verified' where user_id=$1`, [w.u.C])).rejects.toThrow(/permission denied/)
    await expect(run(w.u.C, `select set_account_status($1,'active')`, [w.u.C])).rejects.toThrow(/Not authorized/)
    await expect(run(w.u.C, `select verify_volunteer($1,'verified')`, [w.vol.C])).rejects.toThrow(/Not authorized/)
  })
})

describe('volunteer data isolation', () => {
  it('a volunteer sees only their own volunteer profile', async () => {
    const rows = (await run(w.u.A, `select id from volunteer_profiles`)).rows as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual([w.vol.A])
  })
  it("a volunteer cannot update another volunteer's profile", async () => {
    const r = await run(w.u.A, `update volunteer_profiles set first_name='Hacked' where id=$1`, [w.vol.B])
    expect(r.affectedRows).toBe(0)
  })
  it('coordinators and admins can review volunteers; finance cannot browse volunteer profiles', async () => {
    expect(((await run(w.u.coordinator, `select id from volunteer_profiles`)).rows).length).toBeGreaterThanOrEqual(3)
    expect(((await run(w.u.finance, `select user_id from volunteer_profiles`)).rows as { user_id: string }[]).every((r) => r.user_id === w.u.finance)).toBe(true)
  })
  it('a volunteer cannot read private documents of others', async () => {
    const rows = (await run(w.u.B, `select volunteer_id from volunteer_documents`)).rows as { volunteer_id: string }[]
    expect(rows.every((r) => r.volunteer_id === w.vol.B)).toBe(true)
  })
  it('a volunteer cannot register a document for someone else or outside their folder', async () => {
    const req = (await q<{ id: string }>(w.db, `select id from document_requirements where code='VALID_ID'`))[0].id
    await expect(run(w.u.C, `insert into volunteer_documents (volunteer_id, requirement_id, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,'x.pdf','application/pdf',10)`, [w.vol.A, req, `${w.u.C}/x.pdf`])).rejects.toThrow(/Invalid storage path|row-level security/)
    await expect(run(w.u.C, `insert into volunteer_documents (volunteer_id, requirement_id, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,'x.pdf','application/pdf',10)`, [w.vol.C, req, `${w.u.A}/x.pdf`])).rejects.toThrow(/Invalid storage path/)
  })
  it('enforces document type and size limits and ignores a self-declared status', async () => {
    const req = (await q<{ id: string }>(w.db, `select id from document_requirements where code='VALID_ID'`))[0].id
    await expect(run(w.u.C, `insert into volunteer_documents (volunteer_id, requirement_id, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,'x.exe','application/x-msdownload',10)`, [w.vol.C, req, `${w.u.C}/a.exe`])).rejects.toThrow(/not allowed/)
    await expect(run(w.u.C, `insert into volunteer_documents (volunteer_id, requirement_id, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,'x.pdf','application/pdf',99999999)`, [w.vol.C, req, `${w.u.C}/b.pdf`])).rejects.toThrow(/exceeds/)
    await expect(run(w.u.C, `insert into volunteer_documents (volunteer_id, requirement_id, storage_path, file_name, mime_type, size_bytes, status) values ($1,$2,$3,'x.pdf','application/pdf',10,'verified')`, [w.vol.C, req, `${w.u.C}/c.pdf`])).rejects.toThrow(/permission denied/)
  })
  it('editing a verified licence resets verification to pending', async () => {
    await run(w.u.A, `update professional_credentials set license_no='NEW999' where volunteer_id=$1`, [w.vol.A])
    expect((await q(w.db, `select verification_status from professional_credentials where volunteer_id=$1`, [w.vol.A]))[0]).toEqual({ verification_status: 'pending' })
    const id = (await q<{ id: string }>(w.db, `select id from professional_credentials where volunteer_id=$1`, [w.vol.A]))[0].id
    await run(w.u.admin, `select verify_credential($1,'verified','Active')`, [id])
  })
})

describe('financial data protection (TIN / bank account)', () => {
  it('no one can read the financial table directly', async () => {
    for (const u of [w.u.A, w.u.finance, w.u.admin, w.u.sysadmin]) await expect(run(u, `select * from volunteer_financial`)).rejects.toThrow(/permission denied/)
  })
  it('a volunteer sees only masked values for themselves', async () => {
    const f = ((await run(w.u.A, `select get_my_financial() as f`)).rows[0] as { f: Record<string, unknown> }).f
    expect(f.tin_masked).toBe('•••-•••-•••-9000')
    expect(f.account_masked).toBe('••••••7890')
    expect(JSON.stringify(f)).not.toContain('123456789')
  })
  it("a volunteer cannot read someone else's financial data", async () => {
    await expect(run(w.u.B, `select get_financial_masked($1)`, [w.vol.A])).rejects.toThrow(/Not authorized/)
    await expect(run(w.u.B, `select get_financial_full($1,'x')`, [w.vol.A])).rejects.toThrow(/Not authorized/)
  })
  it('coordinators and admins cannot see full TIN / account numbers', async () => {
    await expect(run(w.u.coordinator, `select get_financial_masked($1)`, [w.vol.A])).rejects.toThrow(/Not authorized/)
    await expect(run(w.u.admin, `select get_financial_full($1,'audit')`, [w.vol.A])).rejects.toThrow(/Not authorized/)
    const m = ((await run(w.u.admin, `select get_financial_masked($1) as f`, [w.vol.A])).rows[0] as { f: Record<string, unknown> }).f
    expect(m.tin).toBeUndefined()
  })
  it('finance sees full values only with a purpose, and the access is audited without the secret', async () => {
    await expect(run(w.u.finance, `select get_financial_full($1,'')`, [w.vol.A])).rejects.toThrow(/purpose/)
    const f = ((await run(w.u.finance, `select get_financial_full($1,'payment processing') as f`, [w.vol.A])).rows[0] as { f: Record<string, string> }).f
    expect(f.bank_account_no).toBe('1234567890')
    const log = await q<{ after_values: unknown; reason: string }>(w.db, `select after_values, reason from audit_logs where action='sensitive_read'`)
    expect(log.length).toBeGreaterThan(0)
    expect(JSON.stringify(log)).not.toContain('1234567890')
  })
  it('audit entries never contain the full TIN or account number', async () => {
    const all = JSON.stringify(await q(w.db, `select before_values, after_values from audit_logs`))
    expect(all).not.toContain('123456789000')
    expect(all).not.toContain('1234567890')
  })
  it('validates formats and invalidates bank verification when the account changes', async () => {
    await expect(run(w.u.A, `select save_my_financial('12','x','n')`)).rejects.toThrow(/TIN/)
    await run(w.u.A, `select save_my_financial(null,'9988776655',null)`)
    expect((await q(w.db, `select bank_verification_status from volunteer_financial where volunteer_id=$1`, [w.vol.A]))[0]).toEqual({ bank_verification_status: 'unverified' })
    await run(w.u.finance, `select set_bank_verification($1,'verified')`, [w.vol.A])
  })
})

describe('events, venues and positions', () => {
  it('volunteers cannot create events, venues or positions', async () => {
    await expect(run(w.u.A, `insert into examination_events (name) values ('x')`)).rejects.toThrow(/permission denied|row-level security/)
    await expect(run(w.u.A, `insert into examination_centers (name) values ('x')`)).rejects.toThrow(/row-level security/)
    await expect(run(w.u.coordinator, `insert into assignment_positions (name) values ('x')`)).rejects.toThrow(/row-level security/)
  })
  it('draft events are hidden from volunteers but supervisors see their own', async () => {
    const id = (await run(w.u.coordinator, `insert into examination_events (name, supervisor_id) values ('Hidden draft', $1) returning id`, [w.u.supervisor])).rows[0] as { id: string }
    expect(((await run(w.u.A, `select id from examination_events where id=$1`, [id.id])).rows).length).toBe(0)
    expect(((await run(w.u.supervisor, `select id from examination_events where id=$1`, [id.id])).rows).length).toBe(1)
  })
  it('an incomplete event cannot be published', async () => {
    const id = ((await run(w.u.coordinator, `insert into examination_events (name) values ('Incomplete') returning id`)).rows[0] as { id: string }).id
    await expect(run(w.u.coordinator, `select set_event_status($1,'open_for_registration')`, [id])).rejects.toThrow(/Missing: .*examination dates/)
    await expect(run(w.u.coordinator, `update examination_events set status='open_for_registration' where id=$1`, [id])).rejects.toThrow(/incomplete/)
  })
  it('cancelling needs a reason; archived events cannot be reopened', async () => {
    const id = ((await run(w.u.coordinator, `insert into examination_events (name) values ('To cancel') returning id`)).rows[0] as { id: string }).id
    await expect(run(w.u.coordinator, `select set_event_status($1,'cancelled')`, [id])).rejects.toThrow(/reason/)
    await run(w.u.coordinator, `select set_event_status($1,'cancelled','duplicate')`, [id])
    await run(w.u.coordinator, `select set_event_status($1,'archived','cleanup')`, [id])
    await expect(run(w.u.coordinator, `select set_event_status($1,'draft')`, [id])).rejects.toThrow(/Archived/)
  })
})

describe('unassigned supervisor & scoped access', () => {
  it('a supervisor sees assignments only for events they supervise', async () => {
    const a = await assign(w, 'B', 'Room Watcher', 1)
    expect(((await run(w.u.supervisor, `select id from assignments where id=$1`, [a])).rows).length).toBe(1)
    // a different event the supervisor does not supervise
    const other = ((await run(w.u.coordinator, `insert into examination_events (name) values ('Other') returning id`)).rows[0] as { id: string }).id
    await run(w.u.coordinator, `insert into examination_dates (event_id, exam_date) values ($1, current_date + 40)`, [other])
    await run(w.u.coordinator, `insert into event_sites (event_id, center_id) values ($1,$2)`, [other, w.center])
    await run(w.u.coordinator, `insert into staffing_requirements (event_id, center_id, position_id, required_count) values ($1,$2,$3,1)`, [other, w.center, w.positions['Room Watcher']])
    await run(w.u.coordinator, `update examination_events set profession_id=(select id from professions limit 1), recruitment_open=current_date, recruitment_close=current_date+5, confirmation_deadline=current_date+9 where id=$1`, [other])
    await run(w.u.coordinator, `select set_event_status($1,'open_for_registration')`, [other])
    const od = ((await q<{ id: string }>(w.db, `select id from examination_dates where event_id=$1`, [other]))[0]).id
    await run(w.u.coordinator, `insert into assignments (event_id, exam_date_id, volunteer_id, position_id, center_id) values ($1,$2,$3,$4,$5)`, [other, od, w.vol.A, w.positions['Room Watcher'], w.center])
    const rows = (await run(w.u.supervisor, `select event_id from assignments`)).rows as { event_id: string }[]
    expect(rows.every((r) => r.event_id === w.ev)).toBe(true)
  })
})

describe('separation of duties', () => {
  it('finance cannot modify attendance or CPD approvals; coordinators have no financial access', async () => {
    await expect(run(w.u.finance, `update attendance_records set status='present'`)).resolves.toMatchObject({ affectedRows: 0 })
    await expect(run(w.u.finance, `update cpd_records set status='approved'`)).resolves.toMatchObject({ affectedRows: 0 })
    await expect(run(w.u.coordinator, `select * from allowance_records`)).resolves.toMatchObject({ rows: [] })
    await expect(run(w.u.coordinator, `select allowance_dashboard()`)).rejects.toThrow(/Not authorized/)
  })
  it('auditors are read-only', async () => {
    await expect(run(w.u.auditor, `insert into examination_centers (name) values ('x')`)).rejects.toThrow(/row-level security/)
    await expect(run(w.u.auditor, `select set_event_status($1,'ongoing')`, [w.ev])).rejects.toThrow(/Not authorized/)
    expect((await run(w.u.auditor, `select id from audit_logs limit 1`)).rows.length).toBe(1)
  })
})

describe('audit log integrity', () => {
  it('audit logs cannot be edited or deleted, even by privileged users', async () => {
    await expect(run(w.u.admin, `update audit_logs set action='x'`)).rejects.toThrow(/permission denied/)
    await expect(run(w.u.sysadmin, `delete from audit_logs`)).rejects.toThrow(/permission denied/)
    await expect(w.db.query(`update audit_logs set action='x'`)).rejects.toThrow(/append-only/)
  })
  it('volunteers cannot read the audit log', async () => {
    await expect(run(w.u.A, `select * from audit_logs`)).resolves.toMatchObject({ rows: [] })
  })
  it('privileged changes are audited with the actor and a reason', async () => {
    await run(w.u.sysadmin, `select update_setting('preferences.max_active','4','policy change')`)
    const r = await q<{ actor_id: string; reason: string }>(w.db, `select actor_id, reason from audit_logs where record_type='system_settings' and record_id='preferences.max_active' order by created_at desc limit 1`)
    expect(r[0]).toEqual({ actor_id: w.u.sysadmin, reason: 'policy change' })
    await expect(run(w.u.sysadmin, `select update_setting('preferences.max_active','4','')`)).rejects.toThrow(/reason/)
    await run(w.u.sysadmin, `select update_setting('preferences.max_active','5','revert')`)
  })
})

describe('helper RPCs', () => {
  it('only event managers can list supervisors; only audit viewers can resolve actors', async () => {
    const rows = (await run(w.u.coordinator, `select * from list_supervisors()`)).rows as { id: string }[]
    expect(rows.map((r) => r.id)).toContain(w.u.supervisor)
    expect((await run(w.u.A, `select * from list_supervisors()`)).rows.length).toBe(0)
    expect((await run(w.u.A, `select * from actor_emails($1::uuid[])`, [[w.u.admin]])).rows.length).toBe(0)
    expect((await run(w.u.auditor, `select * from actor_emails($1::uuid[])`, [[w.u.admin]])).rows.length).toBe(1)
  })
})
