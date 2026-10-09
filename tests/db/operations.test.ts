import { describe, it, expect, beforeAll } from 'vitest'
import { as, q, addUser, makeStaff } from './harness'
import { buildWorld, confirmed, attendanceOf, type World } from './fixture'

let w: World
let examDay: string
let attA: string, attB: string, asgA: string, asgB: string, asgA2: string, attA2: string
const run = (user: string, sql: string, params: unknown[] = []) => as(w.db, user, () => w.db.query(sql, params))
const at = (time: string) => `${examDay}T${time}+08:00`

beforeAll(async () => {
  w = await buildWorld()
  examDay = (await q<{ d: string }>(w.db, 'select exam_date::text d from examination_dates where id=$1', [w.dates[0]]))[0].d
  asgA = await confirmed(w, 'A', 'Room Watcher', 0, 'Room Watcher')
  asgB = await confirmed(w, 'B', 'Room Watcher', 0, 'Room Watcher')
  attA = await attendanceOf(w, asgA)
  attB = await attendanceOf(w, asgB)
})

describe('attendance', () => {
  it('starts as not yet recorded / unverified', async () => {
    const r = (await q<{ status: string; verification_status: string }>(w.db, 'select status, verification_status from attendance_records where id=$1', [attA]))[0]
    expect(r).toEqual({ status: 'not_yet_recorded', verification_status: 'unverified' })
  })
  it('the event supervisor can record check-in; late arrivals are flagged automatically', async () => {
    await run(w.u.supervisor, `update attendance_records set status='present', check_in_at=$2 where id=$1`, [attA, at('06:05:00')])
    await run(w.u.supervisor, `update attendance_records set status='present', check_in_at=$2 where id=$1`, [attB, at('07:10:00')])
    expect((await q<{ status: string }>(w.db, 'select status from attendance_records where id=$1', [attA]))[0].status).toBe('present')
    expect((await q<{ status: string }>(w.db, 'select status from attendance_records where id=$1', [attB]))[0].status).toBe('late')
    const rec = await q<{ recorded_by: string }>(w.db, 'select recorded_by from attendance_records where id=$1', [attA])
    expect(rec[0].recorded_by).toBe(w.u.supervisor)
  })
  it('recorders cannot verify; finance/volunteers cannot edit attendance', async () => {
    await expect(run(w.u.supervisor, `update attendance_records set verification_status='verified' where id=$1`, [attA])).rejects.toThrow(/permission denied/)
    await expect(run(w.u.supervisor, `select verify_attendance($1::uuid[])`, [[attA]])).rejects.toThrow(/Not authorized/)
    expect((await run(w.u.finance, `update attendance_records set status='absent' where id=$1`, [attA])).affectedRows).toBe(0)
    expect((await run(w.u.A, `update attendance_records set status='absent' where id=$1`, [attA])).affectedRows).toBe(0)
  })
  it('verification completes the assignment and a verified record cannot be edited directly', async () => {
    await run(w.u.attendance, `select submit_attendance($1::uuid[])`, [[attA, attB]])
    expect(await run(w.u.admin, `select verify_attendance($1::uuid[]) as n`, [[attA, attB]]).then((r) => (r.rows[0] as { n: number }).n)).toBe(2)
    expect((await q<{ status: string }>(w.db, 'select status from assignments where id=$1', [asgA]))[0].status).toBe('completed')
    await expect(run(w.u.attendance, `update attendance_records set status='absent' where id=$1`, [attA])).rejects.toThrow(/documented correction/)
    await expect(run(w.u.admin, `update attendance_records set status='absent' where id=$1`, [attA])).rejects.toThrow(/documented correction/)
  })
  it('records with no status cannot be verified', async () => {
    asgA2 = await confirmed(w, 'A', 'Supply Officer', 1)
    attA2 = await attendanceOf(w, asgA2)
    await expect(run(w.u.admin, `select verify_attendance($1::uuid[])`, [[attA2]])).rejects.toThrow(/not ready/)
  })
})

describe('allowances', () => {
  it('creates allowance records only from verified attendance and checks requirements', async () => {
    const a = (await q<Record<string, unknown>>(w.db, `select * from allowance_records where assignment_id=$1`, [asgA]))[0]
    expect(a.eligibility_status).toBe('eligible')
    expect(a.processing_status).toBe('for_validation')
    expect(Number(a.approved_amount)).toBe(500)
    expect(a.rule_version).toBe(1 + 1) // version 1 is the inactive placeholder
    const b = (await q<Record<string, unknown>>(w.db, `select * from allowance_records where assignment_id=$1`, [asgB]))[0]
    expect(b.eligibility_status).toBe('pending_requirements')
    expect(b.processing_status).toBe('requirements_incomplete')
    expect(String(b.requirements_note)).toMatch(/TIN is missing/)
    // cannot be sent for approval while requirements are incomplete
    await expect(run(w.u.finance, `select set_allowance_processing($1,'for_approval')`, [b.id])).rejects.toThrow(/not permitted/)
  })
  it('PNP personnel with non-allowance positions get no allowance and no CPD', async () => {
    const ext = ((await run(w.u.coordinator, `insert into external_personnel (full_name, category, agency_unit) values ('PO3 Test','pnp','PPO') returning id`)).rows[0] as { id: string }).id
    const id = ((await run(w.u.coordinator, `insert into assignments (event_id, exam_date_id, requirement_id, external_id, position_id, center_id) values ($1,$2,$3,$4,$5,$6) returning id`,
      [w.ev, w.dates[0], w.req['PNP Personnel'], ext, w.positions['PNP Personnel'], w.center])).rows[0] as { id: string }).id
    await run(w.u.coordinator, `select release_assignments($1::uuid[])`, [[id]])
    const att = await attendanceOf(w, id)
    await run(w.u.attendance, `update attendance_records set status='present', check_in_at=$2 where id=$1`, [att, at('05:50:00')])
    await run(w.u.admin, `select verify_attendance($1::uuid[])`, [[att]])
    expect((await q(w.db, `select 1 from allowance_records where assignment_id=$1`, [id])).length).toBe(0)
    expect((await q(w.db, `select 1 from cpd_records where assignment_id=$1`, [id])).length).toBe(0)
  })
  it('follows the processing workflow with segregation of duties', async () => {
    const id = (await q<{ id: string }>(w.db, `select id from allowance_records where assignment_id=$1`, [asgA]))[0].id
    await expect(run(w.u.finance, `update allowance_records set processing_status='approved' where id=$1`, [id])).rejects.toThrow(/not permitted/)
    await expect(run(w.u.coordinator, `select set_allowance_processing($1,'for_approval')`, [id])).rejects.toThrow(/Not authorized/)
    await run(w.u.finance, `select set_allowance_processing($1,'for_approval')`, [id])
    await expect(run(w.u.finance, `select set_allowance_processing($1,'approved')`, [id])).rejects.toThrow(/not permitted/)
    await expect(run(w.u.admin, `select set_allowance_processing($1,'disapproved')`, [id])).rejects.toThrow(/reason/)
    // payments are not allowed before the allowance is ready for payment
    await expect(run(w.u.finance, `insert into allowance_payments (allowance_id, amount, paid_on, reference_no) values ($1,100,current_date,'R0')`, [id])).rejects.toThrow(/Ready for Payment/)
    await run(w.u.admin, `select set_allowance_processing($1,'approved')`, [id])
    await run(w.u.finance, `select set_allowance_processing($1,'for_processing')`, [id])
    await run(w.u.finance, `select set_allowance_processing($1,'ready_for_payment')`, [id])
    const r = (await q<{ approved_by: string; processed_by: string }>(w.db, 'select approved_by, processed_by from allowance_records where id=$1', [id]))[0]
    expect(r).toEqual({ approved_by: w.u.admin, processed_by: w.u.finance })
  })
  it('tracks partial payments, balance, duplicates and excess protection', async () => {
    const id = (await q<{ id: string }>(w.db, `select id from allowance_records where assignment_id=$1`, [asgA]))[0].id
    await run(w.u.finance, `insert into allowance_payments (allowance_id, amount, paid_on, reference_no) values ($1,200,current_date,'VCH-1')`, [id])
    let s = (await q<Record<string, unknown>>(w.db, `select payment_status, total_paid, balance from allowance_summary where id=$1`, [id]))[0]
    expect(s.payment_status).toBe('partially_paid')
    expect(Number(s.total_paid)).toBe(200)
    expect(Number(s.balance)).toBe(300)
    await expect(run(w.u.finance, `insert into allowance_payments (allowance_id, amount, paid_on, reference_no) values ($1,50,current_date,'VCH-1')`, [id])).rejects.toThrow(/duplicate key/)
    await expect(run(w.u.finance, `insert into allowance_payments (allowance_id, amount, paid_on, reference_no) values ($1,300.01,current_date,'VCH-2')`, [id])).rejects.toThrow(/exceeds the remaining balance/)
    await expect(run(w.u.finance, `insert into allowance_payments (allowance_id, amount, paid_on, reference_no, exception_reason) values ($1,300.01,current_date,'VCH-2','x')`, [id])).rejects.toThrow(/exceeds/)
    await run(w.u.finance, `insert into allowance_payments (allowance_id, amount, paid_on, reference_no) values ($1,300,current_date,'VCH-2')`, [id])
    s = (await q<Record<string, unknown>>(w.db, `select payment_status, total_paid, balance, payment_reference from allowance_summary where id=$1`, [id]))[0]
    expect(s.payment_status).toBe('paid')
    expect(Number(s.balance)).toBe(0)
    expect(s.payment_reference).toBe('VCH-2')
  })
  it('payments are immutable; a return needs a reason and reopens the balance', async () => {
    const id = (await q<{ id: string }>(w.db, `select id from allowance_records where assignment_id=$1`, [asgA]))[0].id
    const pid = (await q<{ id: string }>(w.db, `select id from allowance_payments where allowance_id=$1 and reference_no='VCH-2'`, [id]))[0].id
    await expect(run(w.u.finance, `update allowance_payments set amount=1 where id=$1`, [pid])).rejects.toThrow(/permission denied/)
    await expect(run(w.u.finance, `update allowance_payments set status='returned' where id=$1`, [pid])).rejects.toThrow(/immutable/)
    await run(w.u.finance, `update allowance_payments set status='returned', return_reason='Account closed' where id=$1`, [pid])
    const s = (await q<Record<string, unknown>>(w.db, `select payment_status, balance from allowance_summary where id=$1`, [id]))[0]
    expect(s.payment_status).toBe('partially_paid')
    expect(Number(s.balance)).toBe(300)
    await expect(run(w.u.A, `insert into allowance_payments (allowance_id, amount, paid_on, reference_no) values ($1,1,current_date,'X')`, [id])).rejects.toThrow(/Not authorized|permission denied/)
  })
  it('amount can only change by a documented adjustment after approval', async () => {
    const id = (await q<{ id: string }>(w.db, `select id from allowance_records where assignment_id=$1`, [asgA]))[0].id
    await expect(run(w.u.finance, `update allowance_records set approved_amount=900 where id=$1`, [id])).rejects.toThrow(/adjustment/)
    await expect(run(w.u.finance, `select adjust_allowance_amount($1,900,'x')`, [id])).rejects.toThrow(/Not authorized/)
    await expect(run(w.u.admin, `select adjust_allowance_amount($1,100,'correction')`, [id])).rejects.toThrow(/lower than the total already paid/)
    await run(w.u.admin, `select adjust_allowance_amount($1,600,'rate corrected by memo')`, [id])
    const log = await q(w.db, `select reason from audit_logs where record_type='allowance_records' and record_id=$1 and after_values ? 'approved_amount'`, [id])
    expect(log.length).toBeGreaterThan(0)
  })
  it('the allowance dashboard aggregates from records and is restricted', async () => {
    const d = ((await run(w.u.finance, `select allowance_dashboard() as d`)).rows[0] as { d: Record<string, unknown> }).d
    expect(Number(d.total_paid)).toBe(200)
    expect(d.missing_requirements).toBe(1)
    await expect(run(w.u.A, `select allowance_dashboard()`)).rejects.toThrow(/Not authorized/)
  })
  it('a volunteer sees only their own allowances and no internal fields', async () => {
    const rows = (await run(w.u.A, `select * from my_allowances()`)).rows as Record<string, unknown>[]
    expect(rows.length).toBe(1)
    expect(Object.keys(rows[0])).not.toContain('remarks')
    expect((await run(w.u.B, `select * from my_allowances()`)).rows.every((r) => (r as { id: string }).id !== rows[0].id)).toBe(true)
    await expect(run(w.u.A, `select * from allowance_records`)).resolves.toMatchObject({ rows: [] })
  })
})

describe('CPD', () => {
  it('registered professionals with verified licences earn proposed units; unregistered volunteers are not eligible', async () => {
    const a = (await q<Record<string, unknown>>(w.db, `select * from cpd_records where assignment_id=$1`, [asgA]))[0]
    expect(a.status).toBe('for_cpd_review')
    expect(Number(a.units_proposed)).toBe(2)
    expect(a.license_ref).toBe('000A123')
    expect(a.rule_version).toBe(1)
    const b = (await q<Record<string, unknown>>(w.db, `select * from cpd_records where assignment_id=$1`, [asgB]))[0]
    expect(b.status).toBe('not_eligible')
    expect(Number(b.units_proposed)).toBe(0)
    expect(b.remarks).toMatch(/registered professional/)
  })
  it('does not create credit before attendance is verified, and only a pending placeholder after recording', async () => {
    const att = attA2
    expect((await q(w.db, 'select 1 from cpd_records where attendance_id=$1', [att])).length).toBe(0)
    await run(w.u.attendance, `update attendance_records set status='present', check_in_at=$2 where id=$1`, [att, at('05:00:00')])
    expect((await q<{ status: string }>(w.db, 'select status from cpd_records where attendance_id=$1', [att]))[0].status).toBe('pending_attendance_verification')
    await expect(run(w.u.cpd, `select set_cpd_status((select id from cpd_records where attendance_id=$1),'approved')`, [att])).rejects.toThrow(/not permitted/)
    await run(w.u.admin, `select verify_attendance($1::uuid[])`, [[att]])
    expect((await q<{ status: string }>(w.db, 'select status from cpd_records where attendance_id=$1', [att]))[0].status).toBe('for_cpd_review')
  })
  it('counts a calendar date only once even with several assignments on that date', async () => {
    const d = examDay
    const ev2 = ((await run(w.u.coordinator, `insert into examination_events (name, profession_id, recruitment_open, recruitment_close, confirmation_deadline) values ('Same-day event', (select id from professions limit 1), current_date, current_date+5, current_date+9) returning id`)).rows[0] as { id: string }).id
    const ed2 = (await q<{ id: string }>(w.db, `insert into examination_dates (event_id, exam_date, start_time, end_time) values ($1,$2,'09:00','12:00') returning id`, [ev2, d]))[0].id
    await run(w.u.coordinator, `insert into event_sites (event_id, center_id) values ($1,$2)`, [ev2, w.center])
    await run(w.u.coordinator, `insert into staffing_requirements (event_id, center_id, position_id, required_count) values ($1,$2,$3,1)`, [ev2, w.center, w.positions['Room Watcher']])
    await run(w.u.coordinator, `select set_event_status($1,'open_for_registration')`, [ev2])
    const a2 = ((await run(w.u.coordinator, `insert into assignments (event_id, exam_date_id, volunteer_id, position_id, center_id, conflict_override_reason) values ($1,$2,$3,$4,$5,null) returning id`, [ev2, ed2, w.vol.A, w.positions['Room Watcher'], w.center])).rows[0] as { id: string }).id
    await run(w.u.admin, `update assignments set conflict_override_reason='parallel half-day shifts' where id=$1`, [a2])
    await run(w.u.coordinator, `select release_assignments($1::uuid[])`, [[a2]])
    await run(w.u.A, `select respond_assignment($1,'accept')`, [a2])
    const att = await attendanceOf(w, a2)
    await run(w.u.attendance, `update attendance_records set status='present', check_in_at=$2 where id=$1`, [att, at('09:00:00')])
    await run(w.u.admin, `select verify_attendance($1::uuid[])`, [[att]])
    expect((await q(w.db, 'select 1 from cpd_records where attendance_id=$1', [att])).length).toBe(0)
    const days = await q(w.db, `select service_date from cpd_records where volunteer_id=$1 and service_date=$2::date and status <> 'not_eligible'`, [w.vol.A, d])
    expect(days.length).toBe(1)
  })
  it('requires two-step review/approval with different people; approval needs verified attendance', async () => {
    const id = (await q<{ id: string }>(w.db, `select id from cpd_records where assignment_id=$1`, [asgA]))[0].id
    await expect(run(w.u.cpd, `select set_cpd_status($1,'approved')`, [id])).rejects.toThrow(/requires review/)
    await expect(run(w.u.cpd, `select set_cpd_status($1,'rejected')`, [id])).rejects.toThrow(/reason/)
    await run(w.u.cpd, `select set_cpd_status($1,'pending_approval')`, [id])
    await expect(run(w.u.cpd, `select set_cpd_status($1,'approved')`, [id])).rejects.toThrow(/Segregation/)
    await expect(run(w.u.finance, `select set_cpd_status($1,'approved')`, [id])).rejects.toThrow(/Not authorized/)
    await expect(run(w.u.A, `update cpd_records set status='approved', units_approved=99 where id=$1`, [id])).resolves.toMatchObject({ affectedRows: 0 })
    const cpd2 = await addUser(w.db, 'cpd2@example.test'); await makeStaff(w.db, cpd2, 'cpd_officer')
    await run(cpd2, `select set_cpd_status($1,'approved')`, [id])
    const r = (await q<Record<string, unknown>>(w.db, `select units_approved, approver_id, reviewer_id from cpd_records where id=$1`, [id]))[0]
    expect(Number(r.units_approved)).toBe(2)
    expect(r.approver_id).toBe(cpd2)
    expect(r.reviewer_id).toBe(w.u.cpd)
    const t = (await run(w.u.A, `select * from cpd_volunteer_totals`)).rows[0] as Record<string, unknown>
    expect(Number(t.approved_units)).toBe(2)
    expect(Number(t.qualifying_days)).toBe(1)
  })
  it('flags approved credit when attendance is corrected and never silently changes it', async () => {
    const id = (await q<{ id: string }>(w.db, `select id from cpd_records where assignment_id=$1`, [asgA]))[0].id
    await expect(run(w.u.admin, `select correct_attendance($1,'absent',null,null,'')`, [attA])).rejects.toThrow(/reason/)
    await expect(run(w.u.attendance, `select correct_attendance($1,'absent',null,null,'wrong record')`, [attA])).rejects.toThrow(/Not authorized/)
    await run(w.u.admin, `select correct_attendance($1,'absent',null,null,'Entered against the wrong volunteer')`, [attA])
    const r = (await q<Record<string, unknown>>(w.db, `select status, units_approved, needs_review, review_note from cpd_records where id=$1`, [id]))[0]
    expect(r.status).toBe('approved')
    expect(Number(r.units_approved)).toBe(2)
    expect(r.needs_review).toBe(true)
    const adj = await q(w.db, `select reason from attendance_adjustments where attendance_id=$1`, [attA])
    expect(adj.length).toBe(1)
    expect((await q<{ status: string }>(w.db, 'select status from assignments where id=$1', [asgA]))[0].status).toBe('no_show')
    // a flagged record cannot be released until resolved; revocation is a documented adjustment
    await expect(run(w.u.cpd, `select adjust_cpd_record($1,'clear_flag',null,'')`, [id])).rejects.toThrow(/reason/)
    await run(w.u.cpd, `select set_cpd_status($1,'revoked_corrected','Attendance voided after correction')`, [id])
    const f = (await q<Record<string, unknown>>(w.db, `select status, units_approved from cpd_records where id=$1`, [id]))[0]
    expect(f.status).toBe('revoked_corrected')
    expect(Number(f.units_approved)).toBe(0)
    const hist = await q<{ action: string }>(w.db, `select action from cpd_adjustments where cpd_record_id=$1 order by created_at, id`, [id])
    expect(hist.map((h) => h.action)).toContain('status:approved->revoked_corrected')
  })
  it('allowance for a corrected attendance is flagged, not silently altered', async () => {
    const r = (await q<{ needs_review: boolean; approved_amount: string }>(w.db, `select needs_review, approved_amount from allowance_records where assignment_id=$1`, [asgA]))[0]
    expect(r.needs_review).toBe(true)
    expect(Number(r.approved_amount)).toBe(600)
  })
  it('rules are versioned and immutable; the effective version is recorded on each record', async () => {
    await expect(run(w.u.cpd, `update cpd_rules set units_per_day=5`)).rejects.toThrow(/permission denied/)
    await expect(run(w.u.admin, `insert into cpd_rules (name, units_per_day, effective_from, reason) values ('x',3,current_date,'') `)).rejects.toThrow(/check constraint|reason/)
    await run(w.u.cpd, `insert into cpd_rules (name, units_per_day, effective_from, reason) values ('v2 test',3,current_date + 400,'PRB resolution (test)')`)
    const v = await q<{ version: number }>(w.db, `select version from cpd_rules order by version`)
    expect(v.map((x) => x.version)).toEqual([1, 2])
    await expect(w.db.query(`update cpd_rules set units_per_day=9 where version=1`)).rejects.toThrow(/immutable/)
    await expect(run(w.u.finance, `insert into cpd_rules (name, units_per_day, effective_from, reason) values ('x',3,current_date,'r')`)).rejects.toThrow(/row-level security|permission denied/)
  })
  it('the CPD dashboard reports portal-recorded totals', async () => {
    const d = ((await run(w.u.cpd, `select cpd_dashboard() as d`)).rows[0] as { d: Record<string, unknown> }).d
    expect(d.corrected).toBe(1)
    expect(Number(d.units_approved)).toBe(0)
    await expect(run(w.u.finance, `select cpd_dashboard()`)).rejects.toThrow(/Not authorized/)
  })
})

describe('management dashboard', () => {
  it('derives figures from records and honours permissions', async () => {
    const d = ((await run(w.u.admin, `select management_dashboard() as d`)).rows[0] as { d: Record<string, any> }).d
    expect(d.volunteers_total).toBe(3)
    expect(d.events_upcoming).toBeGreaterThanOrEqual(1)
    expect(d.staffing.required).toBeGreaterThan(0)
    expect(d.allowance).toBeDefined()
    expect(d.cpd).toBeDefined()
    const c = ((await run(w.u.coordinator, `select management_dashboard() as d`)).rows[0] as { d: Record<string, any> }).d
    expect(c.allowance).toBeUndefined()
    await expect(run(w.u.A, `select management_dashboard()`)).rejects.toThrow(/Not authorized/)
  })
})

describe('rule deactivation', () => {
  it('requires the rule-management permission and a reason; keeps the row', async () => {
    const id = (await q<{ id: string }>(w.db, `select id from cpd_rules where version=2`))[0].id
    await expect(run(w.u.finance, `select deactivate_rule('cpd',$1,'x')`, [id])).rejects.toThrow(/Not authorized/)
    await expect(run(w.u.cpd, `select deactivate_rule('cpd',$1,'')`, [id])).rejects.toThrow(/reason/)
    await run(w.u.cpd, `select deactivate_rule('cpd',$1,'superseded')`, [id])
    const r = (await q<{ active: boolean }>(w.db, `select active from cpd_rules where id=$1`, [id]))[0]
    expect(r.active).toBe(false)
    const log = await q<{ reason: string }>(w.db, `select reason from audit_logs where record_type='cpd_rules' and record_id=$1 and action='update'`, [id])
    expect(log[0].reason).toBe('superseded')
  })
})
