// End-to-end smoke tests: real browser, built app, mocked Supabase HTTP API (no live backend needed).
// Run with: npm run test:e2e   (builds the app first)
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type Page, type Route } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PORT = 4179
const BASE = `http://localhost:${PORT}`
const SB = 'http://localhost:54321'
let server: ChildProcess
let browser: Browser

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (sub: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

interface Mock { tables?: Record<string, unknown[]>; rpc?: Record<string, unknown> }

async function open(mock: Mock, opts: { userId?: string; path: string }): Promise<Page> {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  ;(page as unknown as { errors: string[] }).errors = errors
  if (opts.userId) {
    const session = { access_token: jwt(opts.userId), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: opts.userId, email: 'user@example.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } }
    await page.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), session)
  }
  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) })
  await page.route(`${SB}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (url.pathname.startsWith('/auth/v1/token')) return json(route, { error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400)
    if (url.pathname.startsWith('/auth/v1/')) return json(route, {})
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop()!
      return json(route, mock.rpc?.[name] ?? null)
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop()!
      const rows = mock.tables?.[table] ?? []
      const range = { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...range } })
      const wantsObject = (req.headers().accept ?? '').includes('vnd.pgrst.object')
      if (wantsObject) return rows.length ? json(route, rows[0], 200, { 'access-control-expose-headers': 'content-range' }) : json(route, { code: 'PGRST116', message: 'no rows' }, 406)
      return json(route, rows, 200, { 'access-control-expose-headers': 'content-range', ...range })
    }
    return route.continue()
  })
  await page.goto(`${BASE}${opts.path}`)
  return page
}
const pageErrors = (p: Page) => (p as unknown as { errors: string[] }).errors

const VOL = { id: 'v1', user_id: 'u-vol', volunteer_no: 'VOL-2026-000001', last_name: 'Cruz', first_name: 'Ana', preferred_name: null, verification_status: 'verified', is_registered_professional: false, updated_at: '2026-01-01', mobile_no: '09170000000', address: 'x', city_municipality: 'y', province: 'z', emergency_name: 'e', emergency_contact_no: '09170000001' }
const PROFILE = { id: 'u-vol', email: 'ana@example.test', account_status: 'active', email_verified_at: '2026-01-01', terms_accepted_at: '2026-01-01' }

beforeAll(async () => {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', env: { ...process.env } })
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)) }
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
}, 60000)
afterAll(async () => { await browser?.close(); server?.kill() })

describe('public pages', () => {
  it('landing page explains the portal and links to registration and sign-in', async () => {
    const p = await open({}, { path: '/' })
    await p.getByRole('heading', { name: /Licensure Examination Personnel Portal/ }).waitFor()
    expect(await p.getByRole('link', { name: 'Register as volunteer' }).first().isVisible()).toBe(true)
    expect(await p.getByText('Submitting a preference is not an assignment').isVisible()).toBe(true)
    expect(pageErrors(p)).toEqual([])
    await p.close()
  })
  it('registration validates input and requires acknowledging the privacy notice', async () => {
    const p = await open({}, { path: '/register' })
    await p.getByRole('button', { name: 'Create account' }).click()
    await p.getByText('Enter a valid email address').waitFor()
    await p.locator('input[autocomplete="new-password"]').first().fill('short')
    await p.getByRole('button', { name: 'Create account' }).click()
    await p.getByText('Use at least 10 characters').waitFor()
    await p.getByText('You must acknowledge the Privacy Notice and Terms to register').waitFor()
    await p.close()
  })
  it('sign-in shows a generic error for bad credentials', async () => {
    const p = await open({}, { path: '/sign-in' })
    await p.getByLabel('Email address').fill('nobody@example.test')
    await p.getByLabel('Password').fill('wrong-password')
    await p.getByRole('button', { name: 'Sign in' }).click()
    await p.getByText('Invalid email or password.').waitFor()
    await p.close()
  })
  it('protected routes redirect anonymous visitors to sign-in', async () => {
    const p = await open({}, { path: '/assignments' })
    await p.waitForURL(/sign-in/)
    await p.close()
  })
})

describe('authenticated shells (mocked API)', () => {
  it('volunteer dashboard renders profile, stats and a volunteer-only navigation', async () => {
    const p = await open({ tables: { profiles: [PROFILE], volunteer_profiles: [VOL], assignment_roster: [], notifications: [], examination_events: [] }, rpc: { my_permissions: [], get_my_financial: { has_tin: false, has_account: false, bank_verification_status: 'unverified' }, my_allowances: [] } }, { userId: 'u-vol', path: '/' })
    await p.getByRole('heading', { name: 'Welcome, Ana' }).waitFor()
    expect(await p.getByRole('link', { name: 'Opportunities' }).isVisible()).toBe(true)
    expect(await p.getByRole('link', { name: 'Audit Logs' }).count()).toBe(0)
    expect(await p.getByRole('link', { name: 'Planning Board' }).count()).toBe(0)
    expect(pageErrors(p)).toEqual([])
    await p.close()
  })
  it('a volunteer who opens an administrative route gets the access-denied screen', async () => {
    const p = await open({ tables: { profiles: [PROFILE], volunteer_profiles: [VOL], notifications: [] }, rpc: { my_permissions: [] } }, { userId: 'u-vol', path: '/admin/users' })
    await p.getByRole('heading', { name: 'Access denied' }).waitFor()
    await p.close()
  })
  it('management dashboard shows figures from the database and staff navigation', async () => {
    const dash = { volunteers_total: 42, volunteers_active: 30, volunteers_verified: 25, volunteers_pending_verification: 7, volunteers_available: 12, events_upcoming: 3, staffing: { required: 100, assigned: 80, confirmed: 60, awaiting: 20, vacant: 20 }, confirmation_rate: 75, attendance_completion_rate: null, absences: 1, substitutions: 2, needs_staffing: [{ id: 'e1', name: 'CE Board Exam', status: 'under_staffing', start_date: '2026-11-01', required: 100, assigned: 80, vacant: 20 }] }
    const p = await open({ tables: { profiles: [{ ...PROFILE, id: 'u-admin' }], volunteer_profiles: [{ ...VOL, user_id: 'u-admin', last_name: null, first_name: null }], notifications: [] }, rpc: { my_permissions: ['reports.view', 'volunteers.view', 'audit.view', 'assignments.manage'], management_dashboard: dash } }, { userId: 'u-admin', path: '/admin' })
    await p.getByRole('heading', { name: 'Management Dashboard' }).waitFor()
    await p.getByText('42', { exact: true }).first().waitFor()
    expect(await p.getByText('CE Board Exam').isVisible()).toBe(true)
    expect(await p.getByRole('link', { name: 'Audit Logs' }).isVisible()).toBe(true)
    expect(await p.getByRole('link', { name: 'Users & Roles' }).count()).toBe(0)
    expect(pageErrors(p)).toEqual([])
    await p.screenshot({ path: 'test-results/admin-dashboard.png', fullPage: true })
    await p.close()
  })
})
