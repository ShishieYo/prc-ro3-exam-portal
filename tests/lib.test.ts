import { describe, it, expect } from 'vitest'
import { toCsv, parseCsv, safeCell, safeFilename } from '../src/lib/csv'
import { fmtDate, fmtTime, peso, todayManila, toManilaInput, fromManilaInput, fullName } from '../src/lib/format'
import { staffingIndicator } from '../src/lib/staffing'
import { profileCompleteness } from '../src/lib/completeness'
import { recommend, type Candidate } from '../src/lib/recommend'

describe('csv safety', () => {
  it('neutralises formula injection', () => {
    for (const s of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x']) expect(safeCell(s)).toBe(`'${s}`)
    expect(safeCell('Juan')).toBe('Juan')
    expect(safeCell(5)).toBe(5)
    expect(toCsv([{ n: '=HYPERLINK("x")' }], [{ header: 'n', value: (r) => r.n }])).toContain(`"'=HYPERLINK(""x"")"`)
  })
  it('round-trips quoted fields', () => {
    const csv = toCsv([{ a: 'x, y', b: 'line1\nline2', c: 'say "hi"' }], [
      { header: 'a', value: (r) => r.a }, { header: 'b', value: (r) => r.b }, { header: 'c', value: (r) => r.c }])
    expect(parseCsv(csv)).toEqual([['a', 'b', 'c'], ['x, y', 'line1\nline2', 'say "hi"']])
  })
  it('parses CRLF and ignores blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })
  it('builds safe filenames', () => {
    expect(safeFilename('../../Etc/Passwd Report', 'csv')).toBe('etc-passwd-report.csv')
    expect(safeFilename('***', 'xlsx')).toBe('export.xlsx')
  })
})

describe('Manila date handling', () => {
  it('does not shift date-only values', () => { expect(fmtDate('2026-03-15')).toBe('Mar 15, 2026') })
  it('formats times and money', () => {
    expect(fmtTime('08:00:00')).toMatch(/8:00\s?AM/i)
    expect(peso(1234.5)).toContain('1,234.50')
  })
  it('computes Manila "today" across midnight UTC', () => {
    expect(todayManila(new Date('2026-03-14T17:30:00Z'))).toBe('2026-03-15')
  })
  it('round-trips datetime-local values', () => {
    const iso = fromManilaInput('2026-03-15T07:05')!
    expect(iso).toBe('2026-03-14T23:05:00.000Z')
    expect(toManilaInput(iso)).toBe('2026-03-15T07:05')
  })
  it('formats names', () => { expect(fullName({ last_name: 'Cruz', first_name: 'Ana', middle_name: 'B.', name_extension: null })).toBe('Cruz, Ana B.') })
})

describe('staffing indicators', () => {
  it.each([
    [{ required_count: 4, assigned_count: 0, confirmed_count: 0 }, 'unassigned'],
    [{ required_count: 4, assigned_count: 1, confirmed_count: 0 }, 'understaffed'],
    [{ required_count: 4, assigned_count: 3, confirmed_count: 2 }, 'partially_staffed'],
    [{ required_count: 4, assigned_count: 4, confirmed_count: 2 }, 'awaiting_confirmation'],
    [{ required_count: 4, assigned_count: 4, confirmed_count: 4 }, 'fully_staffed'],
  ] as const)('%j -> %s', (c, expected) => { expect(staffingIndicator(c)).toBe(expected) })
})

describe('profile completeness', () => {
  const base = { last_name: 'A', first_name: 'B', mobile_no: '1', address: 'x', city_municipality: 'c', province: 'p', emergency_name: 'e', emergency_contact_no: '2', is_registered_professional: false }
  it('lists what is missing and ignores registered-only items for non-professionals', () => {
    const r = profileCompleteness({ profile: base, credentialCount: 0, hasEmploymentRecord: false, hasTin: false, hasBankAccount: true,
      requiredDocs: [{ id: 'd1', name: 'ID', registeredOnly: false }, { id: 'd2', name: 'PRC ID', registeredOnly: true }], submittedDocIds: new Set() })
    expect(r.missing).toEqual(['Employment information', 'TIN', 'Document: ID'])
    expect(r.percent).toBeLessThan(100)
  })
  it('requires licence details and registered-only documents for professionals', () => {
    const r = profileCompleteness({ profile: { ...base, is_registered_professional: true }, credentialCount: 0, hasEmploymentRecord: true, hasTin: true, hasBankAccount: true,
      requiredDocs: [{ id: 'd2', name: 'PRC ID', registeredOnly: true }], submittedDocIds: new Set() })
    expect(r.missing).toEqual(['PRC license details', 'Document: PRC ID'])
  })
  it('reaches 100% when everything is present', () => {
    const r = profileCompleteness({ profile: base, credentialCount: 0, hasEmploymentRecord: true, hasTin: true, hasBankAccount: true, requiredDocs: [], submittedDocIds: new Set() })
    expect(r).toEqual({ percent: 100, missing: [] })
  })
})

describe('assisted assignment ranking', () => {
  const mk = (o: Partial<Candidate>): Candidate => ({
    volunteer_id: 'x', volunteer_no: 'V', full_name: 'Name', is_registered: false, profile_verified: true, license_verified: false, availability_declared: true, available: true,
    preferred_event: false, preferred_position_ids: [], preferred_center_ids: [], prior_completed: 0, prior_no_show: 0, prior_total: 0, recent_assignments: 0,
    has_experience: false, has_training: false, has_conflict: false, assigned_this_day: false, blockers: [], ...o })
  const pos = { id: 'p1', name: 'Room Watcher', requires_registered_professional: false, requires_verified_license: false }
  it('prefers available, applicant, position-matched, reliable candidates and explains why', () => {
    const best = mk({ volunteer_id: 'best', full_name: 'Best', preferred_event: true, preferred_position_ids: ['p1'], prior_total: 4, prior_completed: 4 })
    const meh = mk({ volunteer_id: 'meh', full_name: 'Meh', available: false })
    const r = recommend([meh, best], pos, null)
    expect(r[0].candidate.volunteer_id).toBe('best')
    expect(r[0].reasons).toContain('Prefers Room Watcher')
    expect(r[0].score).toBeGreaterThan(r[1].score)
  })
  it('never ranks ineligible candidates above eligible ones and states blockers', () => {
    const blocked = mk({ volunteer_id: 'b', full_name: 'Blocked', preferred_event: true, has_conflict: true, preferred_position_ids: ['p1'] })
    const ok = mk({ volunteer_id: 'o', full_name: 'Ok' })
    const r = recommend([blocked, ok], pos, null)
    expect(r[0].candidate.volunteer_id).toBe('o')
    expect(r[1].eligible).toBe(false)
    expect(r[1].blockedBy.join()).toMatch(/conflict/)
  })
  it('enforces licence requirements and rewards fair distribution', () => {
    const sup = { ...pos, id: 'p2', name: 'Building Supervisor', requires_registered_professional: true, requires_verified_license: true }
    const r = recommend([mk({ volunteer_id: 'a', is_registered: true }), mk({ volunteer_id: 'b', is_registered: true, license_verified: true })], sup, null)
    expect(r.find((x) => x.candidate.volunteer_id === 'a')!.eligible).toBe(false)
    const busy = mk({ volunteer_id: 'busy', full_name: 'Busy', recent_assignments: 6 })
    const idle = mk({ volunteer_id: 'idle', full_name: 'Idle', recent_assignments: 0 })
    expect(recommend([busy, idle], pos, null)[0].candidate.volunteer_id).toBe('idle')
  })
})
