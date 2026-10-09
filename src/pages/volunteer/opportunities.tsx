import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '@/components/ui/ui'
import { Checkbox, TextArea, TextInput } from '@/components/ui/form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { EventCalendar } from '@/components/EventCalendar'
import { useAuth } from '@/auth/AuthProvider'
import { fmtDate, fmtTime } from '@/lib/format'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { Position, Preference } from '@/types/db'

interface OppEvent {
  id: string; name: string; status: string; recruitment_open: string | null; recruitment_close: string | null; confirmation_deadline: string | null; instructions: string | null
  professions: { name: string } | null
  examination_dates: { id: string; exam_date: string; report_time: string | null; start_time: string | null; end_time: string | null }[]
  event_sites: { center_id: string; examination_centers: { id: string; name: string; city_municipality: string | null } | null }[]
  staffing_requirements: { position_id: string; required_count: number }[]
}

export function useMyPreferences() {
  return useQuery({
    queryKey: ['my-preferences'],
    queryFn: async () => unwrap(await supabase.from('examination_preferences').select('*, examination_events(id,name,status,recruitment_close,professions(name))').order('submitted_at', { ascending: false })) as unknown as Preference[],
  })
}

function useMyDates() {
  return useQuery({
    queryKey: ['my-committed-dates'],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('assignments').select('status, examination_dates(exam_date)').in('status', ['offered', 'awaiting_volunteer_confirmation', 'confirmed'])) as unknown as { status: string; examination_dates: { exam_date: string } }[]
      return new Set(rows.map((r) => r.examination_dates.exam_date))
    },
  })
}

export function PreferenceModal({ event, existing, onClose }: { event: OppEvent | null; existing?: Preference; onClose: () => void }) {
  const qc = useQueryClient()
  const committed = useMyDates()
  const positions = useQuery({ queryKey: ['positions', 'volunteer'], queryFn: async () => unwrap(await supabase.from('assignment_positions').select('*').eq('active', true).eq('personnel_type', 'volunteer').order('sort_order')) as Position[] })
  const [dates, setDates] = useState<Set<string>>(new Set())
  const [pos, setPos] = useState<Set<string>>(new Set())
  const [centers, setCenters] = useState<Set<string>>(new Set())
  const [rank, setRank] = useState('1')
  const [remarks, setRemarks] = useState('')
  const avail = useQuery({
    queryKey: ['my-availability', event?.id], enabled: !!event,
    queryFn: async () => unwrap(await supabase.from('volunteer_availability').select('exam_date_id,available')) as { exam_date_id: string; available: boolean }[],
  })
  useEffect(() => {
    if (!event) return
    setPos(new Set(existing?.preferred_position_ids ?? [])); setCenters(new Set(existing?.preferred_center_ids ?? []))
    setRank(String(existing?.rank ?? 1)); setRemarks(existing?.remarks ?? '')
    setDates(new Set((avail.data ?? []).filter((a) => a.available && event.examination_dates.some((d) => d.id === a.exam_date_id)).map((a) => a.exam_date_id)))
  }, [event, existing, avail.data])

  const toggle = (s: Set<string>, set: (s: Set<string>) => void, id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); set(n) }
  const submit = useMutation({
    mutationFn: async () => {
      unwrap(await supabase.rpc('submit_preference', { p_event: event!.id, p_rank: Number(rank) || 1, p_positions: [...pos], p_centers: [...centers], p_dates: [...dates], p_remarks: remarks || null }))
    },
    onSuccess: () => { toast.success('Preference submitted. It is not an assignment — PRC will review it.'); qc.invalidateQueries({ queryKey: ['my-preferences'] }); qc.invalidateQueries({ queryKey: ['my-availability'] }); onClose() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (!event) return null
  const conflictDates = event.examination_dates.filter((d) => committed.data?.has(d.exam_date))
  return (
    <Modal open title={`Preference: ${event.name}`} onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={submit.isPending} disabled={dates.size === 0} onClick={() => submit.mutate()}>{existing ? 'Update preference' : 'Submit preference'}</Button></>}>
      <div className="space-y-5 text-sm">
        <Alert tone="info">Submitting a preference does <strong>not</strong> assign you. PRC reviews preferences and releases assignments separately.</Alert>
        {conflictDates.length > 0 && <Alert tone="warning" title="Schedule conflict">You already have a committed assignment on {conflictDates.map((d) => fmtDate(d.exam_date)).join(', ')}. You cannot offer availability on those dates.</Alert>}
        <fieldset><legend className="mb-2 font-medium">Dates you are available</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {event.examination_dates.map((d) => {
              const clash = committed.data?.has(d.exam_date)
              return <Checkbox key={d.id} disabled={clash} checked={dates.has(d.id)} onChange={() => toggle(dates, setDates, d.id)} label={`${fmtDate(d.exam_date)}${d.report_time ? ` · report ${fmtTime(d.report_time)}` : ''}`} hint={clash ? 'Conflicts with your assignment' : undefined} />
            })}
          </div></fieldset>
        <fieldset><legend className="mb-2 font-medium">Preferred operational roles (optional)</legend>
          <div className="grid gap-2 sm:grid-cols-2">{positions.data?.map((p) => <Checkbox key={p.id} checked={pos.has(p.id)} onChange={() => toggle(pos, setPos, p.id)} label={p.name} hint={p.requires_verified_license ? 'Requires a verified PRC license' : undefined} />)}</div></fieldset>
        {event.event_sites.length > 1 && <fieldset><legend className="mb-2 font-medium">Preferred centers (optional)</legend>
          <div className="grid gap-2 sm:grid-cols-2">{event.event_sites.map((s) => s.examination_centers && <Checkbox key={s.center_id} checked={centers.has(s.center_id)} onChange={() => toggle(centers, setCenters, s.center_id)} label={s.examination_centers.name} />)}</div></fieldset>}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput label="Rank (1 = most preferred)" type="number" min={1} value={rank} onChange={(e) => setRank(e.target.value)} />
          <TextArea label="Notes for PRC (optional)" wrapperClassName="sm:col-span-2" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

export function Opportunities() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [target, setTarget] = useState<OppEvent | null>(null)
  const events = useQuery({
    queryKey: ['opportunities'],
    queryFn: async () => unwrap(await supabase.from('examination_events')
      .select('id,name,status,recruitment_open,recruitment_close,confirmation_deadline,instructions, professions(name), examination_dates(id,exam_date,report_time,start_time,end_time), event_sites(center_id, examination_centers(id,name,city_municipality)), staffing_requirements(position_id,required_count)')
      .eq('status', 'open_for_registration').order('recruitment_close')) as unknown as OppEvent[],
  })
  const positions = useQuery({ queryKey: ['positions', 'all'], queryFn: async () => unwrap(await supabase.from('assignment_positions').select('id,name')) as { id: string; name: string }[] })
  const prefs = useMyPreferences()
  const committed = useMyDates()
  const focus = params.get('event')
  useEffect(() => { if (focus && events.data) { const e = events.data.find((x) => x.id === focus); if (e) { setTarget(e); setParams({}, { replace: true }) } } }, [focus, events.data, setParams])

  if (events.isLoading) return <Spinner />
  if (events.isError) return <ErrorState error={events.error} retry={() => events.refetch()} />
  const pname = (id: string) => positions.data?.find((p) => p.id === id)?.name ?? 'Position'
  return (
    <div>
      <PageHeader title="Examination Opportunities" description="Licensure examinations currently open for volunteer preferences. Submitting a preference is not an assignment." />
      {profile?.account_status !== 'active' && <div className="mb-4"><Alert tone="warning">Your account must be approved by PRC before you can submit preferences.</Alert></div>}
      {events.data?.length === 0 ? <Card><EmptyState title="No examinations are open for preferences" hint="Check back later or watch your notifications for announcements." /></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {events.data?.map((e) => {
            const pref = prefs.data?.find((p) => p.event_id === e.id)
            const clash = e.examination_dates.filter((d) => committed.data?.has(d.exam_date))
            const needs = new Map<string, number>()
            e.staffing_requirements.forEach((r) => needs.set(r.position_id, (needs.get(r.position_id) ?? 0) + r.required_count))
            return (
              <Card key={e.id} title={e.name} actions={pref && pref.status !== 'withdrawn' ? <StatusBadge status={pref.status} /> : undefined}>
                <div className="space-y-3 text-sm">
                  <p className="text-muted">{e.professions?.name}</p>
                  <p><strong>Schedule:</strong> {e.examination_dates.map((d) => fmtDate(d.exam_date)).join(' · ') || 'To be announced'}</p>
                  <p className="flex items-start gap-1"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />{e.event_sites.map((s) => s.examination_centers && `${s.examination_centers.name}${s.examination_centers.city_municipality ? `, ${s.examination_centers.city_municipality}` : ''}`).filter(Boolean).join(' · ') || 'Venue to be announced'}</p>
                  <div className="flex flex-wrap gap-1.5">{[...needs].map(([id, n]) => <Badge key={id} tone="brand">{pname(id)}: {n} needed</Badge>)}</div>
                  <p className="text-xs text-muted">Preferences close {fmtDate(e.recruitment_close)} · Confirm assignments by {fmtDate(e.confirmation_deadline)}</p>
                  {e.instructions && <details><summary className="cursor-pointer text-prc-600">Instructions</summary><p className="mt-1 whitespace-pre-wrap text-muted">{e.instructions}</p></details>}
                  {clash.length > 0 && <p className="flex items-center gap-1 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Conflicts with your assignment on {clash.map((c) => fmtDate(c.exam_date)).join(', ')}</p>}
                  <div className="flex gap-2 pt-1">
                    <Button disabled={profile?.account_status !== 'active' || (!!pref && !['pending', 'withdrawn'].includes(pref.status))} onClick={() => setTarget(e)}>{pref && pref.status !== 'withdrawn' ? 'Edit preference' : 'Submit preference'}</Button>
                    <Link to="/preferences" className="px-3 py-2 text-sm text-prc-600 hover:underline">My preferences</Link>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <PreferenceModal event={target} existing={prefs.data?.find((p) => p.event_id === target?.id)} onClose={() => setTarget(null)} />
    </div>
  )
}

export function VolunteerCalendar() {
  return (
    <div>
      <PageHeader title="Examination Calendar" description="Scheduled licensure examinations. Select an examination to view details or submit a preference." />
      <EventCalendar linkTo={(id) => `/opportunities?event=${id}`} />
    </div>
  )
}

export function MyPreferences() {
  const prefs = useMyPreferences()
  const qc = useQueryClient()
  const [withdraw, setWithdraw] = useState<Preference | null>(null)
  const events = useQuery({
    queryKey: ['opportunities'],
    queryFn: async () => unwrap(await supabase.from('examination_events')
      .select('id,name,status,recruitment_open,recruitment_close,confirmation_deadline,instructions, professions(name), examination_dates(id,exam_date,report_time,start_time,end_time), event_sites(center_id, examination_centers(id,name,city_municipality)), staffing_requirements(position_id,required_count)')
      .eq('status', 'open_for_registration')) as unknown as OppEvent[],
  })
  const [edit, setEdit] = useState<Preference | null>(null)
  const del = useMutation({
    mutationFn: async (id: string) => { unwrap(await supabase.rpc('withdraw_preference', { p_preference: id })) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-preferences'] }); toast.success('Preference withdrawn') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (prefs.isLoading) return <Spinner />
  if (prefs.isError) return <ErrorState error={prefs.error} />
  return (
    <div>
      <PageHeader title="My Preferences" description="Pending means PRC has not yet reviewed your preference. Only an assignment offer is a commitment." actions={<Link to="/opportunities"><Button>Browse opportunities</Button></Link>} />
      <Card padded={false}>
        {prefs.data?.length === 0 ? <EmptyState title="You have not submitted any preferences" action={<Link to="/opportunities" className="text-sm text-prc-600 hover:underline">Browse examination opportunities</Link>} /> : (
          <ul className="divide-y divide-line">
            {prefs.data?.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div><p className="font-medium">{p.examination_events?.name}</p><p className="text-xs text-muted">Rank {p.rank} · submitted {fmtDate(p.submitted_at)} · closes {fmtDate(p.examination_events?.recruitment_close)}</p>
                  {p.staff_remarks && <p className="mt-1 text-xs text-muted">PRC: {p.staff_remarks}</p>}</div>
                <div className="flex items-center gap-2"><StatusBadge status={p.status} />
                  {p.status === 'pending' && events.data?.some((e) => e.id === p.event_id) && <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>Edit</Button>}
                  {['pending', 'shortlisted', 'waitlisted'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => setWithdraw(p)}>Withdraw</Button>}</div>
              </li>
            ))}
          </ul>)}
      </Card>
      <PreferenceModal event={edit ? events.data?.find((e) => e.id === edit.event_id) ?? null : null} existing={edit ?? undefined} onClose={() => setEdit(null)} />
      <ConfirmDialog open={!!withdraw} title="Withdraw preference" danger confirmLabel="Withdraw" message={`Withdraw your preference for ${withdraw?.examination_events?.name}?`} onClose={() => setWithdraw(null)} onConfirm={() => del.mutateAsync(withdraw!.id)} />
    </div>
  )
}
