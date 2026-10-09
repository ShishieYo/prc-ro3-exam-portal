import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')

export type Db = PGlite

/** Creates an in-memory Postgres with the Supabase stubs and every migration applied in order. */
export async function createDb(): Promise<Db> {
  const db = new PGlite()
  await db.exec(readFileSync(join(root, 'tests/db/stubs.sql'), 'utf8'))
  const dir = join(root, 'supabase/migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, f), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`)
    }
  }
  return db
}

/** Run `fn` as an authenticated end-user (RLS applies). Always resets to the superuser afterwards. */
export async function as<T>(db: Db, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(userId ? `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);` : `set role anon; select set_config('request.jwt.claim.sub','',false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`)
  }
}

export async function q<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows
}

/** Expect a statement to fail; returns the error message. */
export async function fails(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params)
  } catch (e) {
    // a failed statement inside a transaction-less exec leaves no state; return the message
    return (e as Error).message
  }
  throw new Error(`Expected failure but succeeded: ${sql}`)
}

export async function addUser(db: Db, email: string, meta: Record<string, unknown> = { terms_accepted: true }): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2::jsonb, now()) returning id`,
    [email, JSON.stringify(meta)],
  )
  return r.rows[0].id
}

export async function makeStaff(db: Db, userId: string, role: string) {
  await db.query(`insert into user_roles (user_id, role) values ($1, $2) on conflict do nothing`, [userId, role])
  await db.query(`update profiles set account_status = 'active' where id = $1`, [userId])
}
