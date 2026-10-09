import { describe, it, expect, beforeAll } from 'vitest'
import { as, q } from './harness'
import { buildWorld, assign, release, type World } from './fixture'

let w: World
beforeAll(async () => { w = await buildWorld() })
const run = (user: string, sql: string, params: unknown[] = []) => as(w.db, user, () => w.db.query(sql, params))
const status = async (id: string) => (await q<{ status: string }>(w.db, 'select status from assignments where id=$1', [id]))[0].status

describe('preferences & availability', () => {
  it('accepts a preference only while recruitment is open and records availability', async () => {
    const id = ((await run(w.u.A, `select submit_preference($1,1,$2::uuid[],$3::uuid[],$4::uuid[],'happy to help') as id`, [w.ev, [w.positions['Room Watcher']], [w.center], [w.dates[0]]])).rows[0] as { id: string }).id
    expect(id).toBeTruthy()
    const av = await q(w.db, `select available from volunteer_availability where volunteer_id=$1 order by exam_date_id`, [w.vol.A])
    expect(av.length).toBe(2)
    expect((av as { available: boolean }[]).filter((x) => x.available).length).toBe(1)
    const p = (await q<{ status: string }>(w.db, 'select status from examination_preferences where id=$1', [id]))[0]
    expect(p.status).toBe('pending')
  })
  it('rejects preferences from inactive accounts or without dates, and withdraws on request', async () => {
    await run(w.u.admin, `select set_account_status($1,'suspended','test')`, [w.u.B])
    await expect(run(w.u.B, `select submit_preference($1,1,'{}','{}',$2::uuid[])`, [w.ev, [w.dates[0]]])).rejects.toThrow(/approved/)
    await run(w.u.admin, `select set_account_status($1,'active')`, [w.u.B])
    await expect(run(w.u.B, `select submit_preference($1,1,'{}','{}','{}')`, [w.ev])).rejects.toThrow(/at least one/)
    const id = ((await run(w.u.B, `select submit_preference($1,2,'{}','{}',$2::uuid[]) as id`, [w.ev, [w.dates[1]]])).rows[0] as { id: string }).id
    await run(w.u.B, `select withdraw_preference($1)`, [id])
    expect((await q<{ status: string }>(w.db, 'select status from examination_preferences where id=$1', [id]))[0].status).toBe('withdrawn')
  })
  it('enforces the configurable limit of simultaneous preferences', async () => {
    await run(w.u.sysadmin, `select update_setting('preferences.max_active','0','test limit')`)
    await expect(run(w.u.C, `select submit_preference($1,1,'{}','{}',$2::uuid[])`, [w.ev, [w.dates[0]]])).rejects.toThrow(/at most 0/)
    await run(w.u.sysadmin, `select update_setting('preferences.max_active','5','restore')`)
  })
})

describe('assignment workflow & eligibility', () => {
  it('draft -> offered -> confirmed with history, notification and attendance row', async () => {
    const id = await assign(w, 'A', 'Room Watcher', 0, 'Room Watcher')
    expect(await status(id)).toBe('draft')
    // a volunteer cannot see a draft, cannot confirm it directly
    expect((await run(w.u.A, `select id from assignments where id=$1`, [id])).rows.length).toBe(0)
    expect((await run(w.u.A, `update assignments set status='confirmed' where id=$1`, [id])).affectedRows).toBe(0)
    await expect(run(w.u.A, `select respond_assignment($1,'accept')`, [id])).rejects.toThrow(/not found/i)
    const rel = await release(w, [id])
    expect(rel.r.released).toBe(1)
    expect(await status(id)).toBe('awaiting_volunteer_confirmation')
    await run(w.u.A, `select respond_assignment($1,'accept')`, [id])
    expect(await status(id)).toBe('confirmed')
    expect((await q(w.db, 'select 1 from attendance_records where assignment_id=$1', [id])).length).toBe(1)
    const hist = await q<{ to_status: string }>(w.db, 'select to_status from assignment_history where assignment_id=$1 order by seq', [id])
    expect(hist.map((h) => h.to_status)).toEqual(['draft', 'offered', 'awaiting_volunteer_confirmation', 'confirmed'])
    const n = await q(w.db, `select 1 from notifications where user_id=$1 and title='New assignment offer'`, [w.u.A])
    expect(n.length).toBe(1)
  })
  it('blocks ineligible volunteers (unverified profile, missing license) at release', async () => {
    const id = await assign(w, 'C', 'Building Supervisor', 0)
    const rel = await release(w, [id])
    expect(rel.r.released).toBe(0)
    expect(JSON.stringify(rel.r.errors)).toMatch(/not verified/)
    expect(await status(id)).toBe('draft')
  })
  it('requires a verified licence for positions that need one', async () => {
    const id = await assign(w, 'B', 'Building Supervisor', 0)
    const rel = await release(w, [id])
    expect(JSON.stringify(rel.r.errors)).toMatch(/registered professional|licen/i)
  })
  it('prevents duplicate live assignments on one day and detects cross-event time conflicts', async () => {
    await expect(assign(w, 'A', 'Supply Aide', 0)).rejects.toThrow(/duplicate key/)
    // second event on the same calendar date for volunteer A
    const d = (await q<{ exam_date: string }>(w.db, 'select exam_date::text from examination_dates where id=$1', [w.dates[0]]))[0].exam_date
    const ev2 = ((await run(w.u.coordinator, `insert into examination_events (name, profession_id, recruitment_open, recruitment_close, confirmation_deadline) values ('Second', (select id from professions limit 1), current_date, current_date+5, current_date+9) returning id`)).rows[0] as { id: string }).id
    const ed2 = (await q<{ id: string }>(w.db, `insert into examination_dates (event_id, exam_date, start_time, end_time) values ($1,$2,'09:00','12:00') returning id`, [ev2, d]))[0].id
    await run(w.u.coordinator, `insert into event_sites (event_id, center_id) values ($1,$2)`, [ev2, w.center])
    await run(w.u.coordinator, `insert into staffing_requirements (event_id, center_id, position_id, required_count) values ($1,$2,$3,1)`, [ev2, w.center, w.positions['Room Watcher']])
    await run(w.u.coordinator, `select set_event_status($1,'open_for_registration')`, [ev2])
    const conflicts = await run(w.u.coordinator, `select * from volunteer_conflicts($1,$2)`, [w.vol.A, ed2])
    expect(conflicts.rows.length).toBe(1)
    const a2 = (await run(w.u.coordinator, `insert into assignments (event_id, exam_date_id, volunteer_id, position_id, center_id) values ($1,$2,$3,$4,$5) returning id`, [ev2, ed2, w.vol.A, w.positions['Room Watcher'], w.center])).rows[0] as { id: string }
    const rel = await release(w, [a2.id])
    expect(JSON.stringify(rel.r.errors)).toMatch(/Schedule conflict/)
    // an override needs an approving officer
    await expect(run(w.u.coordinator, `update assignments set conflict_override_reason='ok' where id=$1`, [a2.id])).rejects.toThrow(/approving officer/)
    await run(w.u.admin, `update assignments set conflict_override_reason='Different shifts agreed' where id=$1`, [a2.id])
    expect((await release(w, [a2.id])).r.released).toBe(1)
  })
  it('volunteers can decline; declined is terminal; reassignment keeps the original record', async () => {
    const id = await assign(w, 'B', 'Room Watcher', 1)
    await release(w, [id])
    await expect(run(w.u.B, `select respond_assignment($1,'decline')`, [id])).rejects.toThrow(/reason/)
    await run(w.u.B, `select respond_assignment($1,'decline','family emergency')`, [id])
    expect(await status(id)).toBe('declined')
    await expect(run(w.u.coordinator, `select set_assignment_status($1,'offered')`, [id])).rejects.toThrow(/not permitted/)
    const id2 = await assign(w, 'A', 'Supply Officer', 1)
    await release(w, [id2])
    await expect(run(w.u.coordinator, `select reassign_assignment($1,$2,null,'')`, [id2, w.vol.B])).rejects.toThrow(/reason/)
    const nid = ((await run(w.u.coordinator, `select reassign_assignment($1,$2,null,'volunteer unavailable') as id`, [id2, w.vol.B])).rows[0] as { id: string }).id
    expect(await status(id2)).toBe('reassigned')
    expect(await status(nid)).toBe('draft')
    const link = await q<{ replaces_assignment_id: string }>(w.db, 'select replaces_assignment_id from assignments where id=$1', [nid])
    expect(link[0].replaces_assignment_id).toBe(id2)
    const hist = await q<{ reason: string }>(w.db, `select reason from assignment_history where assignment_id=$1 and to_status='reassigned'`, [id2])
    expect(hist[0].reason).toBe('volunteer unavailable')
  })
  it('requires approval before release when configured, and supports approval-gated acceptance', async () => {
    for (const d of await q<{ id: string }>(w.db, `select id from assignments where volunteer_id=$1 and status='draft'`, [w.vol.B])) {
      await run(w.u.coordinator, `select set_assignment_status($1,'cancelled','cleanup')`, [d.id])
    }
    await run(w.u.sysadmin, `select update_setting('assignment.requires_approval','true','pilot')`)
    const id = await assign(w, 'B', 'Supply Aide', 0)
    const rel = await release(w, [id])
    expect(rel.r.released).toBe(0)
    expect(await status(id)).toBe('pending_approval')
    await expect(run(w.u.coordinator, `select decide_assignment($1,true)`, [id])).rejects.toThrow(/Not authorized/)
    await run(w.u.admin, `select decide_assignment($1,true)`, [id])
    expect(await status(id)).toBe('awaiting_volunteer_confirmation')
    await run(w.u.sysadmin, `select update_setting('assignment.requires_approval','false','done')`)
    await run(w.u.sysadmin, `select update_setting('assignment.confirmation_requires_approval','true','pilot')`)
    await run(w.u.B, `select respond_assignment($1,'accept')`, [id])
    expect(await status(id)).toBe('awaiting_volunteer_confirmation')
    await run(w.u.admin, `select decide_assignment($1,true)`, [id])
    expect(await status(id)).toBe('confirmed')
    await run(w.u.sysadmin, `select update_setting('assignment.confirmation_requires_approval','false','done')`)
  })
})

describe('external (PNP) personnel', () => {
  it('can be encoded, assigned and confirmed without an account; duplicates are rejected', async () => {
    const ext = ((await run(w.u.coordinator, `insert into external_personnel (full_name, category, rank_position, agency_unit) values ('PO1 Juan Dela Cruz','pnp','PO1','Pampanga PPO') returning id`)).rows[0] as { id: string }).id
    await expect(run(w.u.coordinator, `insert into external_personnel (full_name, category, rank_position, agency_unit) values ('po1 juan dela cruz','pnp','po1','pampanga ppo')`)).rejects.toThrow(/duplicate key/)
    const a = ((await run(w.u.coordinator, `insert into assignments (event_id, exam_date_id, requirement_id, external_id, position_id, center_id) values ($1,$2,$3,$4,$5,$6) returning id`,
      [w.ev, w.dates[0], w.req['PNP Personnel'], ext, w.positions['PNP Personnel'], w.center])).rows[0] as { id: string }).id
    expect((await release(w, [a])).r.released).toBe(1)
    expect(await status(a)).toBe('confirmed')
    // volunteers cannot hold PNP positions and PNP cannot hold volunteer positions
    await expect(run(w.u.coordinator, `insert into assignments (event_id, exam_date_id, volunteer_id, position_id, center_id) values ($1,$2,$3,$4,$5)`, [w.ev, w.dates[1], w.vol.A, w.positions['PNP Personnel'], w.center])).rejects.toThrow(/not for volunteers/)
    await expect(run(w.u.coordinator, `insert into assignments (event_id, exam_date_id, external_id, position_id, center_id) values ($1,$2,$3,$4,$5)`, [w.ev, w.dates[1], ext, w.positions['Room Watcher'], w.center])).rejects.toThrow(/volunteers only/)
    // volunteers and unrelated staff cannot see the registry
    expect((await run(w.u.A, `select * from external_personnel`)).rows.length).toBe(0)
  })
  it('import reports invalid and duplicate rows instead of skipping silently', async () => {
    const res = ((await run(w.u.coordinator, `select import_external_personnel('test.csv', $1::jsonb) as r`, [JSON.stringify([
      { full_name: 'PO2 Maria Santos', agency_unit: 'Tarlac PPO', rank_position: 'PO2' },
      { full_name: '', agency_unit: 'x' },
      { full_name: 'PO2 Maria Santos', agency_unit: 'Tarlac PPO', rank_position: 'PO2' },
      { full_name: 'X', category: 'alien' },
    ])])).rows[0] as { r: { imported: number; rejected: number; errors: { row: number; error: string }[] } }).r
    expect(res.imported).toBe(1)
    expect(res.rejected).toBe(3)
    expect(res.errors.map((e) => e.row)).toEqual([3, 4, 5])
    expect(res.errors[1].error).toMatch(/Duplicate/)
    await expect(run(w.u.A, `select import_external_personnel('x', '[]'::jsonb)`)).rejects.toThrow(/Not authorized/)
  })
})

describe('staffing summary', () => {
  it('computes required / assigned / confirmed / vacant from actual records', async () => {
    const rows = (await run(w.u.coordinator, `select * from staffing_summary where event_id=$1`, [w.ev])).rows as Record<string, number | string>[]
    const rw = rows.find((r) => r.requirement_id === w.req['Room Watcher'])!
    expect(rw.required_count).toBe(2)
    expect(rw.confirmed_count).toBe(1) // volunteer A from the first test
    expect(rw.assigned_count).toBe(1)
    expect(rw.vacant_count).toBe(1)
  })
})
