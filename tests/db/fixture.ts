import { createDb, as, q, addUser, makeStaff, type Db } from './harness'

export interface World {
  db: Db
  u: Record<string, string> // user ids by key
  vol: Record<string, string> // volunteer_profile ids by key (A, B, C)
  ev: string
  dates: string[]
  center: string
  building: string
  floor: string
  room: string
  positions: Record<string, string>
  req: Record<string, string>
}

const STAFF = ['sysadmin', 'admin', 'coordinator', 'attendance', 'finance', 'cpd', 'supervisor', 'auditor'] as const
const ROLE: Record<string, string> = {
  sysadmin: 'system_admin', admin: 'admin', coordinator: 'coordinator', attendance: 'attendance_officer',
  finance: 'finance_officer', cpd: 'cpd_officer', supervisor: 'supervisor', auditor: 'auditor',
}

/** Builds a realistic fixture. Volunteer A: registered, fully verified. B: unregistered, verified. C: registered, unverified. */
export async function buildWorld(): Promise<World> {
  const db = await createDb()
  const u: Record<string, string> = {}
  for (const s of STAFF) { u[s] = await addUser(db, `${s}@example.test`); await makeStaff(db, u[s], ROLE[s]) }
  for (const v of ['A', 'B', 'C']) { u[v] = await addUser(db, `vol${v}@example.test`, { terms_accepted: true, first_name: `Vol${v}`, last_name: 'Tester' }) }
  const vol: Record<string, string> = {}
  for (const v of ['A', 'B', 'C']) vol[v] = (await q<{ id: string }>(db, 'select id from volunteer_profiles where user_id=$1', [u[v]]))[0].id

  // A & B: active + verified; C: active but unverified
  for (const v of ['A', 'B', 'C']) await db.query(`update profiles set account_status='active' where id=$1`, [u[v]])
  await db.query(`update volunteer_profiles set verification_status='verified', is_registered_professional=true, mobile_no='09170000000' where id=$1`, [vol.A])
  await db.query(`update volunteer_profiles set verification_status='verified', is_registered_professional=false where id=$1`, [vol.B])
  await db.query(`update volunteer_profiles set is_registered_professional=true where id=$1`, [vol.C])

  // licence for A and C (A verified by the admin through the RPC)
  const prof = (await q<{ id: string }>(db, `select id from professions where code='CE'`))[0].id
  for (const v of ['A', 'C']) {
    await as(db, u[v], () => db.query(`insert into professional_credentials (volunteer_id, profession_id, license_no) values ($1,$2,$3)`, [vol[v], prof, `000${v}123`]))
  }
  const credA = (await q<{ id: string }>(db, 'select id from professional_credentials where volunteer_id=$1', [vol.A]))[0].id
  await as(db, u.admin, () => db.query(`select verify_credential($1,'verified','Active','checked against PRC records')`, [credA]))

  // documents (verified directly as the superuser, representing completed reviews)
  const reqs = await q<{ id: string; code: string }>(db, 'select id, code from document_requirements')
  for (const v of ['A', 'B']) {
    for (const r of reqs.filter((x) => x.code !== 'PRC_ID')) {
      await as(db, u[v], () => db.query(
        `insert into volunteer_documents (volunteer_id, requirement_id, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,'f.pdf','application/pdf',1000)`,
        [vol[v], r.id, `${u[v]}/${r.code}/${v}.pdf`]))
    }
  }
  await as(db, u.admin, async () => {
    for (const d of await q<{ id: string }>(db, 'select id from volunteer_documents')) await db.query(`select review_document($1,'verified')`, [d.id])
  })
  // bank details for A (valid) -> finance verifies
  await as(db, u.A, () => db.query(`select save_my_financial('123-456-789-000','1234567890','Vol A Tester')`))
  await as(db, u.finance, () => db.query(`select set_bank_verification($1,'verified')`, [vol.A]))

  // venue
  const center = (await q<{ id: string }>(db, `insert into examination_centers (name, city_municipality, province) values ('Test Center','San Fernando','Pampanga') returning id`))[0].id
  const building = (await q<{ id: string }>(db, `insert into buildings (center_id, name) values ($1,'Bldg 1') returning id`, [center]))[0].id
  const floor = (await q<{ id: string }>(db, `insert into floors (building_id, label) values ($1,'2F') returning id`, [building]))[0].id
  const room = (await q<{ id: string }>(db, `insert into rooms (floor_id, name, capacity) values ($1,'Room 201',40) returning id`, [floor]))[0].id

  const positions: Record<string, string> = {}
  for (const p of await q<{ id: string; name: string }>(db, 'select id, name from assignment_positions')) positions[p.name] = p.id

  // event with two days, created through the coordinator
  const today = new Date(); const d1 = new Date(today.getTime() + 30 * 864e5).toISOString().slice(0, 10); const d2 = new Date(today.getTime() + 31 * 864e5).toISOString().slice(0, 10)
  const ev = (await as(db, u.coordinator, () => db.query<{ id: string }>(
    `insert into examination_events (name, profession_id, recruitment_open, recruitment_close, confirmation_deadline, supervisor_id)
     values ('CE Board Exam (test)', $1, current_date - 2, current_date + 10, current_date + 20, $2) returning id`, [prof, u.supervisor]))).rows[0].id
  const dates: string[] = []
  for (const d of [d1, d2]) {
    dates.push((await q<{ id: string }>(db, `insert into examination_dates (event_id, exam_date, report_time, start_time, end_time) values ($1,$2,'06:00','08:00','17:00') returning id`, [ev, d]))[0].id)
  }
  await db.query(`insert into event_sites (event_id, center_id, building_id) values ($1,$2,$3)`, [ev, center, building])
  const req: Record<string, string> = {}
  for (const [name, n] of [['Room Watcher', 2], ['Building Supervisor', 1], ['PNP Personnel', 1]] as const) {
    req[name] = (await q<{ id: string }>(db,
      `insert into staffing_requirements (event_id, exam_date_id, center_id, building_id, floor_id, position_id, required_count) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [ev, dates[0], center, building, floor, positions[name], n]))[0].id
  }
  await as(db, u.coordinator, async () => {
    await db.query(`select set_event_status($1,'open_for_registration')`, [ev])
  })
  // allowance rule (amount is test data only)
  await as(db, u.finance, () => db.query(`insert into allowance_rules (name, amount, effective_from, reason) values ('Test rule', 500, current_date - 365, 'test')`))
  return { db, u, vol, ev, dates, center, building, floor, room, positions, req }
}

export async function assign(w: World, who: 'A' | 'B' | 'C', position: string, dateIdx = 0, reqName?: string): Promise<string> {
  const r = await as(w.db, w.u.coordinator, () => w.db.query<{ id: string }>(
    `insert into assignments (event_id, exam_date_id, requirement_id, volunteer_id, position_id, center_id, building_id, floor_id, room_id, report_time)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'06:00') returning id`,
    [w.ev, w.dates[dateIdx], reqName ? w.req[reqName] : null, w.vol[who], w.positions[position], w.center, w.building, w.floor, w.room]))
  return r.rows[0].id
}

export async function release(w: World, ids: string[], actor = 'coordinator') {
  return (await as(w.db, w.u[actor], () => w.db.query(`select release_assignments($1::uuid[]) as r`, [ids]))).rows[0] as { r: { released: number; errors: unknown[] } }
}

/** Assign, release and accept -> a confirmed assignment with attendance row. */
export async function confirmed(w: World, who: 'A' | 'B', position: string, dateIdx = 0, reqName?: string): Promise<string> {
  const id = await assign(w, who, position, dateIdx, reqName)
  const rel = await release(w, [id])
  if (rel.r.errors.length) throw new Error(JSON.stringify(rel.r.errors))
  await as(w.db, w.u[who], () => w.db.query(`select respond_assignment($1,'accept')`, [id]))
  return id
}

export async function attendanceOf(w: World, assignmentId: string): Promise<string> {
  return (await q<{ id: string }>(w.db, 'select id from attendance_records where assignment_id=$1', [assignmentId]))[0].id
}
