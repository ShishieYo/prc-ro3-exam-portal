export const TZ = 'Asia/Manila'

const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

/** Date-only values (YYYY-MM-DD) are calendar dates in Manila; never shift them by the browser time zone. */
export function parseDateOnly(d: string): Date {
  return new Date(`${d}T00:00:00+08:00`)
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return dateFmt.format(typeof d === 'string' ? (d.length === 10 ? parseDateOnly(d) : new Date(d)) : d)
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  return d ? dateTimeFmt.format(new Date(d)) : '—'
}

/** 'HH:MM[:SS]' -> '8:00 AM' */
export function fmtTime(t: string | null | undefined): string {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  return timeFmt.format(new Date(Date.UTC(2000, 0, 1, h - 8, m)))
}

export function fmtClock(ts: string | null | undefined): string {
  return ts ? timeFmt.format(new Date(ts)) : '—'
}

export function peso(n: number | string | null | undefined): string {
  return n === null || n === undefined || n === '' ? '—' : pesoFmt.format(Number(n))
}

export function titleCase(s: string | null | undefined): string {
  return (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Today's date in Manila as YYYY-MM-DD. */
export function todayManila(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

/** Convert a timestamptz to the value of an <input type="datetime-local"> in Manila time. */
export function toManilaInput(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(new Date(ts).getTime() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 16)
}

/** Convert an <input type="datetime-local"> value (Manila time) to an ISO timestamp. */
export function fromManilaInput(v: string): string | null {
  return v ? new Date(`${v}:00+08:00`).toISOString() : null
}

export function fullName(p: { last_name?: string | null; first_name?: string | null; middle_name?: string | null; name_extension?: string | null }): string {
  const given = [p.first_name, p.middle_name, p.name_extension].filter(Boolean).join(' ')
  return [p.last_name, given].filter(Boolean).join(', ') || '—'
}
