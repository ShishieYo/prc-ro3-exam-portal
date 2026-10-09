import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, q, addUser, type Db } from './harness'

describe('foundation', () => {
  let db: Db
  beforeAll(async () => { db = await createDb() })

  it('creates profile + volunteer role on signup and ignores client role metadata', async () => {
    const id = await addUser(db, 'v1@example.test', { terms_accepted: true, role: 'system_admin' })
    const roles = await q(db, 'select role from user_roles where user_id=$1', [id])
    expect(roles).toEqual([{ role: 'volunteer' }])
    const [p] = await q<{ account_status: string; terms_accepted_at: string | null }>(db, 'select * from profiles where id=$1', [id])
    expect(p.account_status).toBe('pending')
    expect(p.terms_accepted_at).not.toBeNull()
  })
})
