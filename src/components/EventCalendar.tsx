import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, Spinner, StatusBadge } from '@/components/ui/ui'
import { FilterSelect } from '@/components/ui/form'
import { fmtDate, fmtTime, todayManila } from '@/lib/format'
import { supabase, unwrap } from '@/lib/supabase'
import type { Profession } from '@/types/db'

interface Item {
  id: string; exam_date: string; start_time: string | null; end_time: string | null
  examination_events: { id: string; name: string; status: string; profession_id: string | null; professions: { name: string } | null; supervisor_id: string | null; event_sites: { examination_centers: { name: string } | null }[] }
}

type View = 'month' | 'week' | 'list'
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const utc = (s: string) => new Date(`${s}T00:00:00Z`)

/** Month / week / list calendar of examination dates. `linkTo` decides where an event opens. */
export function EventCalendar({ linkTo, staff }: { linkTo: (eventId: string) => string; staff?: boolean }) {
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(() => utc(todayManila()))
  const [profession, setProfession] = useState('')
  const [status, setStatus] = useState('')
  const [text, setText] = useState('')

  const { start, end } = useMemo(() => {
    if (view === 'month') {
      const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
      const s = addDays(first, -first.getUTCDay())
      return { start: s, end: addDays(s, 41) }
    }
    if (view === 'week') { const s = addDays(anchor, -anchor.getUTCDay()); return { start: s, end: addDays(s, 6) } }
    return { start: utc(todayManila()), end: addDays(utc(todayManila()), 365) }
  }, [view, anchor])

  const professions = useQuery({ queryKey: ['professions'], queryFn: async () => unwrap(await supabase.from('professions').select('*').eq('active', true).order('name')) as Profession[] })
  const q = useQuery({
    queryKey: ['calendar', iso(start), iso(end)],
    queryFn: async () => unwrap(await supabase.from('examination_dates')
      .select('id,exam_date,start_time,end_time, examination_events!inner(id,name,status,profession_id,supervisor_id, professions(name), event_sites(examination_centers(name)))')
      .gte('exam_date', iso(start)).lte('exam_date', iso(end)).order('exam_date').limit(1000)) as unknown as Item[],
  })

  const items = (q.data ?? []).filter((i) => {
    const e = i.examination_events
    if (profession && e.profession_id !== profession) return false
    if (status && e.status !== status) return false
    const t = text.trim().toLowerCase()
    if (t && !(e.name.toLowerCase().includes(t) || e.event_sites.some((s) => s.examination_centers?.name.toLowerCase().includes(t)))) return false
    return true
  })
  const byDay = new Map<string, Item[]>()
  for (const i of items) byDay.set(i.exam_date, [...(byDay.get(i.exam_date) ?? []), i])

  const shift = (n: number) => setAnchor((a) => view === 'month' ? new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + n, 1)) : addDays(a, 7 * n))
  const title = view === 'list' ? 'Upcoming examinations' : view === 'month'
    ? anchor.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${fmtDate(iso(start))} – ${fmtDate(iso(end))}`
  const today = todayManila()

  const chip = (i: Item) => (
    <Link key={i.id} to={linkTo(i.examination_events.id)} title={`${i.examination_events.name} · ${i.examination_events.event_sites.map((s) => s.examination_centers?.name).filter(Boolean).join(', ')}`}
      className="block truncate rounded bg-prc-50 px-1.5 py-0.5 text-xs text-navy-800 ring-1 ring-prc-100 hover:bg-prc-100">
      {i.examination_events.name}
    </Link>
  )

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-3">
        <div className="flex items-center gap-1">
          {view !== 'list' && <><Button size="sm" variant="secondary" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="secondary" onClick={() => setAnchor(utc(todayManila()))}>Today</Button>
            <Button size="sm" variant="secondary" onClick={() => shift(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button></>}
          <h2 className="ml-2 text-sm font-semibold text-navy-900">{title}</h2>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-muted">Search<input value={text} onChange={(e) => setText(e.target.value)} placeholder="Exam or venue" className="mt-1 block rounded-md border border-line px-2 py-1.5 text-sm" /></label>
          <FilterSelect label="Profession" value={profession} onChange={(e) => setProfession(e.target.value)}><option value="">All</option>{professions.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</FilterSelect>
          {staff && <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['open_for_registration', 'under_staffing', 'assignments_released', 'ready_for_deployment', 'ongoing', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</FilterSelect>}
          <div role="group" aria-label="Calendar view" className="flex overflow-hidden rounded-md border border-line">
            {(['month', 'week', 'list'] as View[]).map((v) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-3 py-1.5 text-xs font-medium capitalize ${view === v ? 'bg-navy-900 text-white' : 'bg-white hover:bg-prc-50'}`}>{v}</button>)}
          </div>
        </div>
      </div>

      {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} retry={() => q.refetch()} /></div> : view === 'list' ? (
        items.length === 0 ? <EmptyState title="No upcoming examinations" /> : (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div><Link to={linkTo(i.examination_events.id)} className="font-medium text-navy-800 hover:underline">{i.examination_events.name}</Link>
                  <p className="text-xs text-muted">{fmtDate(i.exam_date)} · {fmtTime(i.start_time)} – {fmtTime(i.end_time)} · {i.examination_events.event_sites.map((s) => s.examination_centers?.name).filter(Boolean).join(', ') || 'Venue to be announced'}</p></div>
                <StatusBadge status={i.examination_events.status} />
              </li>
            ))}
          </ul>)
      ) : (
        <div>
          <div className="grid grid-cols-7 border-b border-line bg-slate-50 text-center text-xs font-medium uppercase text-muted">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: view === 'month' ? 42 : 7 }, (_, n) => addDays(start, n)).map((d) => {
              const k = iso(d)
              const list = byDay.get(k) ?? []
              const muted = view === 'month' && d.getUTCMonth() !== anchor.getUTCMonth()
              return (
                <div key={k} className={`min-h-24 border-b border-r border-line p-1 ${muted ? 'bg-slate-50/70' : ''}`}>
                  <p className={`mb-1 text-right text-xs ${k === today ? 'font-bold text-prc-600' : 'text-muted'}`}>{d.getUTCDate()}</p>
                  <div className="space-y-1">{list.slice(0, view === 'week' ? 20 : 3).map(chip)}{view === 'month' && list.length > 3 && <p className="text-xs text-muted">+{list.length - 3} more</p>}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}
