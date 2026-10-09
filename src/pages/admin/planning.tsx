import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { Checkbox, FilterSelect, TextArea, TextInput } from '@/components/ui/form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge } from '@/components/ui/ui'
import { fmtDate, fmtTime, titleCase } from '@/lib/format'
import { applyPage, runPage } from '@/lib/query'
import { DEFAULT_WEIGHTS, recommend, type Candidate, type Weights } from '@/lib/recommend'
import { INDICATOR_LABEL, staffingIndicator } from '@/lib/staffing'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { Building, ExamDate, ExamEvent, ExternalPerson, Floor, Position, Preference, RosterRow, Room, StaffingRow } from '@/types/db'
import { useCenters, usePositions } from './events'

const LIVE = ['draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed', 'completed']

function useLookups() {
  const centers = useCenters()
  const positions = usePositions()
  const buildings = useQuery({ queryKey: ['buildings-all'], queryFn: async () => unwrap(await supabase.from('buildings').select('*').order('name')) as Building[] })
  const floors = useQuery({ queryKey: ['floors-all'], queryFn: async () => unwrap(await supabase.from('floors').select('*').order('level_no')) as Floor[] })
  const rooms = useQuery({ queryKey: ['rooms-all'], queryFn: async () => unwrap(await supabase.from('rooms').select('*').order('name')) as Room[] })
  const place = (r: { center_id: string; building_id: string | null; floor_id: string | null; room_id: string | null }) => [
    centers.data?.find((c) => c.id === r.center_id)?.name, r.building_id && buildings.data?.find((b) => b.id === r.building_id)?.name,
    r.floor_id && floors.data?.find((f) => f.id === r.floor_id)?.label, r.room_id && rooms.data?.find((m) => m.id === r.room_id)?.name].filter(Boolean).join(' › ')
  return { centers, positions, buildings, floors, rooms, place }
}

// ------------------------------------------------------------------ preferences & availability review
type PrefRow = Preference & { volunteer_profiles: { last_name: string | null; first_name: string | null; volunteer_no: string; is_registered_professional: boolean | null; verification_status: string } }

export function PreferencesReview() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const lk = useLookups()
  const [eventId, setEventId] = useState('')
  const [status, setStatus] = useState('')
  const events = useQuery({ queryKey: ['events-pick'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').neq('status', 'draft').order('created_at', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
  const dates = useQuery({ queryKey: ['event-dates', eventId], enabled: !!eventId, queryFn: async () => unwrap(await supabase.from('examination_dates').select('*').eq('event_id', eventId).order('exam_date')) as ExamDate[] })
  const avail = useQuery({ queryKey: ['event-avail', eventId], enabled: !!eventId && !!dates.data, queryFn: async () => unwrap(await supabase.from('volunteer_availability').select('volunteer_id,exam_date_id,available').in('exam_date_id', (dates.data ?? []).map((d) => d.id))) as { volunteer_id: string; exam_date_id: string; available: boolean }[] })
  useEffect(() => { if (!eventId && events.data?.length) setEventId(events.data[0].id) }, [events.data, eventId])
  const setPref = useMutation({
    mutationFn: async (v: { id: string; status: string }) => { unwrap(await supabase.rpc('set_preference_status', { p_preference: v.id, p_status: v.status, p_remarks: null })) },
    onSuccess: () => { toast.success('Preference updated'); qc.invalidateQueries({ queryKey: ['prefs-review'] }) }, onError: (e) => toast.error(errorMessage(e)),
  })
  const cols: Col<PrefRow>[] = [
    { key: 'n', header: 'Volunteer', cell: (r) => <span className="font-medium">{r.volunteer_profiles.last_name}, {r.volunteer_profiles.first_name}</span> },
    { key: 'id', header: 'ID', cell: (r) => <span className="font-mono text-xs">{r.volunteer_profiles.volunteer_no}</span> },
    { key: 'rank', header: 'Rank', sort: 'rank', cell: (r) => r.rank },
    { key: 'av', header: 'Available dates', cell: (r) => { const n = avail.data?.filter((a) => a.volunteer_id === r.volunteer_id && a.available).length ?? 0; return `${n} of ${dates.data?.length ?? 0}` } },
    { key: 'pos', header: 'Preferred roles', cell: (r) => r.preferred_position_ids.map((id) => lk.positions.data?.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || 'Any' },
    { key: 'ctr', header: 'Preferred centers', cell: (r) => r.preferred_center_ids.map((id) => lk.centers.data?.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || 'Any' },
    { key: 'prof', header: 'Profile', cell: (r) => <StatusBadge status={r.volunteer_profiles.verification_status} /> },
    { key: 'st', header: 'Status', sort: 'status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'rm', header: 'Notes', cell: (r) => r.remarks, defaultHidden: true },
    { key: 'act', header: '', cell: (r) => can('assignments.manage') && ['pending', 'shortlisted', 'waitlisted'].includes(r.status) && (
      <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setPref.mutate({ id: r.id, status: 'shortlisted' })}>Shortlist</Button><Button size="sm" variant="ghost" onClick={() => setPref.mutate({ id: r.id, status: 'waitlisted' })}>Waitlist</Button><Button size="sm" variant="ghost" onClick={() => setPref.mutate({ id: r.id, status: 'declined' })}>Decline</Button></div>) },
  ]
  return (
    <div>
      <PageHeader title="Volunteer Preferences and Availability" description="A preference is a request, not an assignment. Shortlisting or declining here does not assign anyone." />
      <DataTable<PrefRow> queryKey={['prefs-review', eventId, status, avail.dataUpdatedAt]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'rank', asc: true }} hideSearch
        filters={<>
          <FilterSelect label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)}>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['pending', 'shortlisted', 'assigned', 'waitlisted', 'declined', 'withdrawn'].map((s) => <option key={s}>{s}</option>)}</FilterSelect></>}
        fetchPage={(p) => { if (!eventId) return Promise.resolve({ rows: [], total: 0 }); let q = supabase.from('examination_preferences').select('*, volunteer_profiles(last_name,first_name,volunteer_no,is_registered_professional,verification_status)', { count: 'exact' }).eq('event_id', eventId); if (status) q = q.eq('status', status); return runPage(applyPage(q, p, [])) }}
        exportAs={{ name: 'preferences', columns: [{ header: 'Volunteer ID', value: (r) => r.volunteer_profiles.volunteer_no }, { header: 'Name', value: (r) => `${r.volunteer_profiles.last_name}, ${r.volunteer_profiles.first_name}` }, { header: 'Rank', value: (r) => r.rank }, { header: 'Status', value: (r) => r.status }] }} />
    </div>
  )
}

// ------------------------------------------------------------------ planning board
export function PlanningBoard() {
  const qc = useQueryClient()
  const lk = useLookups()
  const [eventId, setEventId] = useState('')
  const [dateId, setDateId] = useState('')
  const [centerId, setCenterId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [assignFor, setAssignFor] = useState<StaffingRow | null>(null)
  const [replace, setReplace] = useState<RosterRow | null>(null)
  const [cancel, setCancel] = useState<RosterRow | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [releaseResult, setReleaseResult] = useState<{ released: number; pending_approval: number; errors: { name: string; assignment_no: string; error: string }[] } | null>(null)

  const events = useQuery({ queryKey: ['events-pick'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').neq('status', 'draft').order('created_at', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
  useEffect(() => { if (!eventId && events.data?.length) setEventId(events.data.find((e) => ['open_for_registration', 'under_staffing'].includes(e.status))?.id ?? events.data[0].id) }, [events.data, eventId])
  const dates = useQuery({ queryKey: ['event-dates', eventId], enabled: !!eventId, queryFn: async () => unwrap(await supabase.from('examination_dates').select('*').eq('event_id', eventId).order('exam_date')) as ExamDate[] })
  useEffect(() => { if (dates.data?.length && !dates.data.some((d) => d.id === dateId)) setDateId(dates.data[0].id) }, [dates.data, dateId])
  const reqs = useQuery({ queryKey: ['board-reqs', eventId, dateId], enabled: !!eventId && !!dateId, queryFn: async () => unwrap(await supabase.from('staffing_summary').select('*').eq('event_id', eventId).eq('exam_date_id', dateId)) as StaffingRow[] })
  const asg = useQuery({ queryKey: ['board-asg', eventId, dateId], enabled: !!eventId && !!dateId, queryFn: async () => unwrap(await supabase.from('assignment_roster').select('*').eq('event_id', eventId).eq('exam_date_id', dateId).order('person_name')) as RosterRow[] })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['board-reqs'] }); qc.invalidateQueries({ queryKey: ['board-asg'] }); qc.invalidateQueries({ queryKey: ['staffing'] }); setPicked(new Set()) }

  const rows = (reqs.data ?? []).filter((r) => (!centerId || r.center_id === centerId) && (!buildingId || r.building_id === buildingId))
  const sum = rows.reduce((a, r) => ({ req: a.req + r.required_count, asg: a.asg + r.assigned_count, con: a.con + r.confirmed_count, vac: a.vac + r.vacant_count, wait: a.wait + r.awaiting_count }), { req: 0, asg: 0, con: 0, vac: 0, wait: 0 })
  const people = (asg.data ?? []).filter((a) => LIVE.includes(a.status))

  const release = useMutation({
    mutationFn: async (ids: string[]) => unwrap(await supabase.rpc('release_assignments', { p_ids: ids })) as { released: number; pending_approval: number; errors: { name: string; assignment_no: string; error: string }[] },
    onSuccess: (r) => { setReleaseResult(r); refresh() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const cancelMut = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => { unwrap(await supabase.rpc('set_assignment_status', { p_id: v.id, p_status: 'cancelled', p_reason: v.reason })) },
    onSuccess: () => { toast.success('Assignment cancelled'); refresh() }, onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Assignment Planning Board" description="Staffing requirements and assigned personnel side by side. Assignments are drafts until you release them; recommendations never finalise anything." />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect label="Examination" value={eventId} onChange={(e) => { setEventId(e.target.value); setDateId('') }} className="min-w-64">{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status.replace(/_/g, ' ')})</option>)}</FilterSelect>
          <FilterSelect label="Date" value={dateId} onChange={(e) => setDateId(e.target.value)}>{dates.data?.map((d) => <option key={d.id} value={d.id}>{fmtDate(d.exam_date)}</option>)}</FilterSelect>
          <FilterSelect label="Center" value={centerId} onChange={(e) => { setCenterId(e.target.value); setBuildingId('') }}><option value="">All</option>{lk.centers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</FilterSelect>
          <FilterSelect label="Building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}><option value="">All</option>{lk.buildings.data?.filter((b) => !centerId || b.center_id === centerId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</FilterSelect>
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Required" value={sum.req} /><StatCard label="Assigned" value={sum.asg} /><StatCard label="Confirmed" value={sum.con} /><StatCard label="Awaiting confirmation" value={sum.wait} tone={sum.wait ? 'warning' : 'neutral'} /><StatCard label="Vacant" value={sum.vac} tone={sum.vac ? 'danger' : 'neutral'} />
      </div>

      <Card title="Position staffing" padded={false}>
        {reqs.isLoading ? <Spinner /> : reqs.isError ? <div className="p-4"><ErrorState error={reqs.error} /></div> : rows.length === 0 ? <EmptyState title="No staffing requirements for this date" hint="Add requirements on the examination event page (Staffing requirements tab)." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-muted"><tr>{['Position', 'Location', 'Required', 'Assigned', 'Confirmed', 'Vacant', 'Indicator', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r) => { const ind = staffingIndicator(r); return (
              <tr key={r.requirement_id}><td className="px-3 py-2 font-medium">{lk.positions.data?.find((p) => p.id === r.position_id)?.name}</td><td className="px-3 py-2 text-xs">{lk.place(r)}</td>
                <td className="px-3 py-2">{r.required_count}</td><td className="px-3 py-2">{r.assigned_count}</td><td className="px-3 py-2">{r.confirmed_count}</td><td className="px-3 py-2 font-semibold">{r.vacant_count}</td>
                <td className="px-3 py-2"><Badge tone={ind === 'fully_staffed' ? 'success' : ind === 'understaffed' || ind === 'unassigned' ? 'danger' : 'warning'}>{INDICATOR_LABEL[ind]}</Badge></td>
                <td className="px-3 py-2 text-right"><Button size="sm" disabled={r.vacant_count === 0} onClick={() => setAssignFor(r)}>Fill vacancies</Button></td></tr>) })}</tbody></table></div>)}
      </Card>

      <Card title="Assigned personnel" padded={false} actions={<Button size="sm" disabled={picked.size === 0} onClick={() => release.mutate([...picked])}>Release selected ({picked.size})</Button>}>
        {asg.isLoading ? <Spinner /> : people.length === 0 ? <EmptyState title="Nobody assigned for this date yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-muted"><tr><th className="w-8 px-3 py-2"><span className="sr-only">Select</span></th>{['Name', 'ID', 'Position', 'Location', 'Status', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{people.map((a) => (
              <tr key={a.id}><td className="px-3 py-2">{a.status === 'draft' && <input type="checkbox" aria-label={`Select ${a.person_name}`} checked={picked.has(a.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n })} />}</td>
                <td className="px-3 py-2 font-medium">{a.person_name}{a.personnel_category !== 'volunteer' && <> <Badge tone="brand">{a.personnel_category.toUpperCase()}</Badge></>}</td><td className="px-3 py-2 font-mono text-xs">{a.person_no}</td><td className="px-3 py-2">{a.position_name}</td>
                <td className="px-3 py-2 text-xs">{[a.center_name, a.building_name, a.floor_label, a.room_name].filter(Boolean).join(' › ')}</td><td className="px-3 py-2"><StatusBadge status={a.status} />{a.volunteer_response === 'accepted' && a.status === 'awaiting_volunteer_confirmation' && <span className="ml-1 text-xs text-amber-800">accepted — needs approval</span>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {a.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => release.mutate([a.id])}>Release</Button>}
                  {a.external_id === null && a.status !== 'completed' && <Button size="sm" variant="ghost" onClick={() => setReplace(a)}>Replace</Button>}
                  {a.status !== 'completed' && <Button size="sm" variant="ghost" onClick={() => setCancel(a)}>Cancel</Button>}</td></tr>))}</tbody></table></div>)}
      </Card>

      {(assignFor || replace) && eventId && dateId && (
        <CandidatePanel eventId={eventId} dateId={dateId} req={assignFor ?? undefined} replacing={replace ?? undefined} reqs={reqs.data ?? []} lk={lk} onClose={() => { setAssignFor(null); setReplace(null) }} onDone={refresh} />)}
      <ConfirmDialog open={!!cancel} danger requireReason title="Cancel assignment" confirmLabel="Cancel assignment" message={`Cancel the assignment of ${cancel?.person_name}? The record and its history are kept.`} onClose={() => setCancel(null)} onConfirm={(reason) => cancelMut.mutateAsync({ id: cancel!.id, reason })} />
      <Modal open={!!releaseResult} title="Release result" onClose={() => setReleaseResult(null)} footer={<Button onClick={() => setReleaseResult(null)}>Close</Button>}>
        {releaseResult && <div className="space-y-3 text-sm"><p>Released: <strong>{releaseResult.released}</strong>{releaseResult.pending_approval > 0 && <> · Sent for approval: <strong>{releaseResult.pending_approval}</strong></>}</p>
          {releaseResult.errors.length > 0 && <Alert tone="danger" title={`${releaseResult.errors.length} could not be released`}><ul className="list-disc pl-5">{releaseResult.errors.map((e) => <li key={e.assignment_no}><strong>{e.name}</strong>: {e.error}</li>)}</ul></Alert>}</div>}
      </Modal>
    </div>
  )
}

function CandidatePanel({ eventId, dateId, req, replacing, reqs, lk, onClose, onDone }: {
  eventId: string; dateId: string; req?: StaffingRow; replacing?: RosterRow; reqs: StaffingRow[]; lk: ReturnType<typeof useLookups>; onClose: () => void; onDone: () => void
}) {
  const target = req ?? reqs.find((r) => r.requirement_id === replacing?.requirement_id)
  const positionId = req?.position_id ?? replacing?.position_id
  const position = lk.positions.data?.find((p) => p.id === positionId) as Position | undefined
  const external = position ? position.personnel_type !== 'volunteer' : false
  const [search, setSearch] = useState('')
  const [applicantsOnly, setApplicantsOnly] = useState(false)
  const [hideBlocked, setHideBlocked] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<'pick' | 'preview'>('pick')
  const [remarks, setRemarks] = useState('')
  const [reason, setReason] = useState('')

  const pool = useQuery({ queryKey: ['candidate-pool', eventId, dateId], enabled: !external, queryFn: async () => unwrap(await supabase.rpc('candidate_pool', { p_event: eventId, p_exam_date: dateId })) as Candidate[] })
  const ext = useQuery({ queryKey: ['external-pool', dateId], enabled: external, queryFn: async () => {
    const people = unwrap(await supabase.from('external_personnel').select('*').eq('active', true).order('full_name')) as ExternalPerson[]
    const taken = unwrap(await supabase.from('assignments').select('external_id').eq('exam_date_id', dateId).in('status', ['draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed'])) as { external_id: string | null }[]
    const set = new Set(taken.map((t) => t.external_id))
    return people.filter((p) => !set.has(p.id) && (position?.personnel_type === 'prc_staff' || p.category === position?.personnel_type))
  } })
  const weights = useQuery({ queryKey: ['weights'], queryFn: async () => ({ ...DEFAULT_WEIGHTS, ...((unwrap(await supabase.from('system_settings').select('value').eq('key', 'recommendation.weights').maybeSingle()) as { value: Partial<Weights> } | null)?.value ?? {}) }) })

  const ranked = useMemo(() => {
    if (!pool.data || !position) return []
    const ratio = target ? target.vacant_count / Math.max(target.required_count, 1) : 1
    return recommend(pool.data, position, target?.center_id ?? null, weights.data ?? DEFAULT_WEIGHTS, ratio)
      .filter((r) => (!hideBlocked || r.eligible) && (!applicantsOnly || r.candidate.preferred_event) && r.candidate.full_name.toLowerCase().includes(search.toLowerCase()))
  }, [pool.data, position, target, weights.data, hideBlocked, applicantsOnly, search])
  const vacancies = replacing ? 1 : target?.vacant_count ?? 0

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (replacing) return new Set([id]); else n.add(id); return n })
  const autoFill = () => setSelected(new Set(ranked.filter((r) => r.eligible).slice(0, vacancies).map((r) => r.candidate.volunteer_id)))

  const create = useMutation({
    mutationFn: async () => {
      if (!target || !position) throw new Error('Select a staffing requirement')
      const base = { event_id: eventId, exam_date_id: dateId, requirement_id: target.requirement_id, position_id: position.id, center_id: target.center_id, building_id: target.building_id, floor_id: target.floor_id, room_id: target.room_id, remarks: remarks || null }
      const payload = [...selected].map((id) => external ? { ...base, external_id: id } : { ...base, volunteer_id: id })
      const { error } = await supabase.from('assignments').insert(payload)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast.success(`${selected.size} draft assignment(s) created. Release them when ready.`); onDone(); onClose() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const swap = useMutation({
    mutationFn: async () => { const id = [...selected][0]; unwrap(await supabase.rpc('reassign_assignment', { p_id: replacing!.id, p_new_volunteer: external ? null : id, p_new_external: external ? id : null, p_reason: reason })) },
    onSuccess: () => { toast.success('Replacement drafted; the original record is preserved. Release the new assignment when ready.'); onDone(); onClose() }, onError: (e) => toast.error(errorMessage(e)),
  })

  const over = !replacing && selected.size > vacancies
  const names = (id: string) => (external ? ext.data?.find((p) => p.id === id)?.full_name : pool.data?.find((c) => c.volunteer_id === id)?.full_name) ?? id
  return (
    <Modal open wide title={replacing ? `Replace ${replacing.person_name} — ${position?.name}` : `Fill ${position?.name} — ${target ? lk.place(target) : ''}`} onClose={onClose}
      footer={step === 'pick'
        ? <><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={selected.size === 0} onClick={() => setStep('preview')}>Review {selected.size} selected</Button></>
        : <><Button variant="secondary" onClick={() => setStep('pick')}>Back</Button>{replacing ? <Button loading={swap.isPending} disabled={!reason.trim()} onClick={() => swap.mutate()}>Confirm replacement</Button> : <Button loading={create.isPending} onClick={() => create.mutate()}>Create {selected.size} draft assignment(s)</Button>}</>}>
      {step === 'pick' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">{vacancies} {replacing ? 'replacement' : 'vacancy(ies)'} · Ranking uses availability, application, preferences, verified qualifications, experience, reliability and fair distribution. Review each recommendation — nothing is assigned until you confirm.</p>
          {external ? (
            ext.isLoading ? <Spinner /> : ext.data?.length === 0 ? <EmptyState title="No available external personnel" hint="Encode personnel in the PNP / External Personnel registry first." /> : (
              <ul className="divide-y divide-line rounded-md border border-line">{ext.data?.map((p) => <li key={p.id} className="p-2"><Checkbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} label={<><strong>{p.full_name}</strong> <span className="text-muted">{p.rank_position} · {p.agency_unit}</span></>} /></li>)}</ul>)
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <TextInput label="Search name" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Checkbox label="Applicants only" checked={applicantsOnly} onChange={(e) => setApplicantsOnly(e.target.checked)} />
                <Checkbox label="Hide ineligible" checked={hideBlocked} onChange={(e) => setHideBlocked(e.target.checked)} />
                {!replacing && <Button variant="secondary" size="sm" onClick={autoFill}><Sparkles className="h-4 w-4" aria-hidden /> Suggest top {vacancies}</Button>}
              </div>
              {pool.isLoading ? <Spinner /> : pool.isError ? <ErrorState error={pool.error} /> : ranked.length === 0 ? <EmptyState title="No matching candidates" /> : (
                <ul className="divide-y divide-line rounded-md border border-line">{ranked.map((r) => (
                  <li key={r.candidate.volunteer_id} className={`p-3 ${r.eligible ? '' : 'bg-slate-50'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <Checkbox disabled={!r.eligible} checked={selected.has(r.candidate.volunteer_id)} onChange={() => toggle(r.candidate.volunteer_id)}
                        label={<><strong>{r.candidate.full_name}</strong> <span className="font-mono text-xs text-muted">{r.candidate.volunteer_no}</span></>}
                        hint={r.reasons.join(' · ')} />
                      <div className="text-right"><p className="text-sm font-semibold text-navy-900">{r.score}</p><p className="text-[10px] uppercase text-muted">score</p></div>
                    </div>
                    {r.blockedBy.length > 0 && <p className="mt-1 pl-6 text-xs text-red-700">Cannot be assigned: {r.blockedBy.join('; ')}</p>}
                  </li>))}</ul>)}
            </>)}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <Alert tone="info" title="Preview — nothing has been saved yet">{replacing ? 'The original assignment is kept with its history; a new draft is created for the replacement.' : 'Draft assignments are not visible to volunteers until released.'}</Alert>
          {over && <Alert tone="warning">You selected {selected.size} but only {vacancies} vacancy(ies) remain.</Alert>}
          <ul className="list-disc pl-5">{[...selected].map((id) => <li key={id}>{names(id)} — {position?.name}{target ? `, ${lk.place(target)}` : ''}</li>)}</ul>
          {replacing ? <TextArea label="Reason for replacement (required)" value={reason} onChange={(e) => setReason(e.target.value)} required /> : <TextArea label="Internal remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
        </div>)}
    </Modal>
  )
}

// ------------------------------------------------------------------ roster
export function Roster() {
  const lk = useLookups()
  const [eventId, setEventId] = useState('')
  const [status, setStatus] = useState('')
  const [position, setPosition] = useState('')
  const events = useQuery({ queryKey: ['events-pick'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').neq('status', 'draft').order('created_at', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
  const cols: Col<RosterRow>[] = [
    { key: 'date', header: 'Date', sort: 'exam_date', cell: (r) => fmtDate(r.exam_date) },
    { key: 'no', header: 'Assignment', sort: 'assignment_no', cell: (r) => <span className="font-mono text-xs">{r.assignment_no}</span> },
    { key: 'n', header: 'Name', sort: 'person_name', cell: (r) => <span className="font-medium">{r.person_name}</span> },
    { key: 'c', header: 'Category', cell: (r) => titleCase(r.personnel_category) },
    { key: 'p', header: 'Position', sort: 'position_name', cell: (r) => r.position_name },
    { key: 'l', header: 'Location', cell: (r) => [r.center_name, r.building_name, r.floor_label, r.room_name].filter(Boolean).join(' › ') },
    { key: 'rt', header: 'Report', cell: (r) => fmtTime(r.report_time) },
    { key: 's', header: 'Status', sort: 'status', cell: (r) => <StatusBadge status={r.status} /> },
  ]
  return (
    <div>
      <PageHeader title="Assignment Roster" description="Official list of personnel per examination. Use the browser print function to produce a printable roster." actions={<Button variant="secondary" onClick={() => window.print()}>Print roster</Button>} />
      <DataTable<RosterRow> queryKey={['roster', eventId, status, position]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'exam_date', asc: true }} searchPlaceholder="Search name, assignment no., position…"
        filters={<>
          <FilterSelect label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">All</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect>
          <FilterSelect label="Position" value={position} onChange={(e) => setPosition(e.target.value)}><option value="">All</option>{lk.positions.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['draft', 'pending_approval', 'offered', 'awaiting_volunteer_confirmation', 'confirmed', 'declined', 'waitlisted', 'reassigned', 'cancelled', 'completed', 'no_show'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</FilterSelect></>}
        fetchPage={(p) => { let q = supabase.from('assignment_roster').select('*', { count: 'exact' }); if (eventId) q = q.eq('event_id', eventId); if (status) q = q.eq('status', status); if (position) q = q.eq('position_id', position); return runPage(applyPage(q, p, ['person_name', 'assignment_no', 'position_name', 'center_name'])) }}
        exportAs={{ name: 'assignment-roster', columns: [
          { header: 'Assignment no.', value: (r) => r.assignment_no }, { header: 'Examination', value: (r) => r.event_name }, { header: 'Date', value: (r) => r.exam_date }, { header: 'Name', value: (r) => r.person_name },
          { header: 'Personnel ID', value: (r) => r.person_no }, { header: 'Category', value: (r) => r.personnel_category }, { header: 'Position', value: (r) => r.position_name }, { header: 'Center', value: (r) => r.center_name },
          { header: 'Building', value: (r) => r.building_name }, { header: 'Floor', value: (r) => r.floor_label }, { header: 'Room', value: (r) => r.room_name }, { header: 'Report time', value: (r) => r.report_time }, { header: 'Status', value: (r) => r.status }] }} />
    </div>
  )
}
