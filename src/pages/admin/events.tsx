import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '@/auth/AuthProvider'
import { CrudCard, type FieldDef } from '@/components/CrudCard'
import { EventCalendar } from '@/components/EventCalendar'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { FilterSelect, SelectInput, TextArea, TextInput } from '@/components/ui/form'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { toast } from '@/components/ui/Toast'
import { Alert, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '@/components/ui/ui'
import { fmtDate, fmtTime } from '@/lib/format'
import { applyPage, runPage } from '@/lib/query'
import { INDICATOR_LABEL, staffingIndicator } from '@/lib/staffing'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { Building, Center, ExamDate, ExamEvent, Floor, Position, Profession, Room, StaffingRow } from '@/types/db'
import { Badge } from '@/components/ui/ui'

type EventRow = ExamEvent & { professions: { name: string } | null }

export function useProfessions() {
  return useQuery({ queryKey: ['professions'], queryFn: async () => unwrap(await supabase.from('professions').select('*').eq('active', true).order('name')) as Profession[] })
}
export function useCenters() {
  return useQuery({ queryKey: ['centers'], queryFn: async () => unwrap(await supabase.from('examination_centers').select('*').eq('active', true).order('name')) as Center[] })
}
export function usePositions() {
  return useQuery({ queryKey: ['positions', 'all'], queryFn: async () => unwrap(await supabase.from('assignment_positions').select('*').order('sort_order')) as Position[] })
}

export function EventList() {
  const { can } = useAuth()
  const nav = useNavigate()
  const profs = useProfessions()
  const [status, setStatus] = useState('')
  const [prof, setProf] = useState('')
  const cols: Col<EventRow>[] = [
    { key: 'no', header: 'Event ID', sort: 'event_no', cell: (r) => <span className="font-mono text-xs">{r.event_no}</span> },
    { key: 'n', header: 'Examination', sort: 'name', cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'p', header: 'Profession', cell: (r) => r.professions?.name },
    { key: 'd', header: 'Exam dates', sort: 'start_date', cell: (r) => r.start_date ? (r.start_date === r.end_date ? fmtDate(r.start_date) : `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`) : '—' },
    { key: 'rc', header: 'Recruitment closes', sort: 'recruitment_close', cell: (r) => fmtDate(r.recruitment_close) },
    { key: 's', header: 'Status', sort: 'status', cell: (r) => <StatusBadge status={r.status} /> },
  ]
  return (
    <div>
      <PageHeader title="Examination Events" description="Create and manage licensure examination events, dates, venues and staffing requirements." actions={can('events.manage') ? <Link to="/admin/events/new"><Button>New event</Button></Link> : undefined} />
      <DataTable<EventRow> queryKey={['events', status, prof]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'start_date', asc: false }} onRowClick={(r) => nav(`/admin/events/${r.id}`)}
        searchPlaceholder="Search name or event ID…"
        filters={<>
          <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['draft', 'open_for_registration', 'under_staffing', 'assignments_released', 'ready_for_deployment', 'ongoing', 'completed', 'cancelled', 'archived'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</FilterSelect>
          <FilterSelect label="Profession" value={prof} onChange={(e) => setProf(e.target.value)}><option value="">All</option>{profs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</FilterSelect>
        </>}
        fetchPage={(p) => { let q = supabase.from('examination_events').select('*, professions(name)', { count: 'exact' }); if (status) q = q.eq('status', status); if (prof) q = q.eq('profession_id', prof); return runPage(applyPage(q, p, ['name', 'event_no'])) }}
        exportAs={{ name: 'examination-events', columns: [{ header: 'Event ID', value: (r) => r.event_no }, { header: 'Examination', value: (r) => r.name }, { header: 'Profession', value: (r) => r.professions?.name }, { header: 'Start', value: (r) => r.start_date }, { header: 'End', value: (r) => r.end_date }, { header: 'Status', value: (r) => r.status }] }} />
    </div>
  )
}

export function AdminCalendar() {
  return (<div><PageHeader title="Examination Calendar" description="Month, week and list views of scheduled examinations." /><EventCalendar staff linkTo={(id) => `/admin/events/${id}`} /></div>)
}

// ------------------------------------------------------------------ form
const schema = z.object({
  name: z.string().trim().min(3, 'Enter the examination name'),
  profession_id: z.string().min(1, 'Select a profession'),
  exam_type: z.string().optional(),
  recruitment_open: z.string().min(1, 'Required'),
  recruitment_close: z.string().min(1, 'Required'),
  confirmation_deadline: z.string().min(1, 'Required'),
  staffing_target: z.string().optional(),
  supervisor_id: z.string().optional(),
  instructions: z.string().optional(),
  internal_remarks: z.string().optional(),
}).refine((v) => v.recruitment_open <= v.recruitment_close, { path: ['recruitment_close'], message: 'Must be on or after the opening date' })
type FormValues = z.infer<typeof schema>

function EventForm({ event, readOnly }: { event?: EventRow; readOnly?: boolean }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const profs = useProfessions()
  const sups = useQuery({ queryKey: ['supervisors'], enabled: !readOnly, queryFn: async () => unwrap(await supabase.rpc('list_supervisors')) as { id: string; email: string }[] })
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<FormValues>({ resolver: zodResolver(schema) })
  useEffect(() => { reset({ name: event?.name ?? '', profession_id: event?.profession_id ?? '', exam_type: event?.exam_type ?? '', recruitment_open: event?.recruitment_open ?? '', recruitment_close: event?.recruitment_close ?? '', confirmation_deadline: event?.confirmation_deadline ?? '', staffing_target: event?.staffing_target?.toString() ?? '', supervisor_id: event?.supervisor_id ?? '', instructions: event?.instructions ?? '', internal_remarks: event?.internal_remarks ?? '' }) }, [event, reset])
  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const row = { ...v, exam_type: v.exam_type || null, staffing_target: v.staffing_target ? Number(v.staffing_target) : null, supervisor_id: v.supervisor_id || null, instructions: v.instructions || null, internal_remarks: v.internal_remarks || null }
      if (event) return unwrap(await supabase.from('examination_events').update(row).eq('id', event.id).select('id').single()) as { id: string }
      return unwrap(await supabase.from('examination_events').insert(row).select('id').single()) as { id: string }
    },
    onSuccess: (r) => { toast.success('Event saved'); qc.invalidateQueries({ queryKey: ['events'] }); qc.invalidateQueries({ queryKey: ['event', event?.id] }); if (!event) nav(`/admin/events/${r.id}`, { replace: true }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Examination name" required wrapperClassName="sm:col-span-2" error={errors.name?.message} {...register('name')} />
          <SelectInput label="Profession / board" required error={errors.profession_id?.message} {...register('profession_id')}><option value="">Select…</option>{profs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput>
          <TextInput label="Examination type" placeholder="e.g. Licensure Examination" {...register('exam_type')} />
          <TextInput label="Recruitment opens" type="date" required error={errors.recruitment_open?.message} {...register('recruitment_open')} />
          <TextInput label="Recruitment closes" type="date" required error={errors.recruitment_close?.message} {...register('recruitment_close')} />
          <TextInput label="Volunteer confirmation deadline" type="date" required error={errors.confirmation_deadline?.message} {...register('confirmation_deadline')} />
          <TextInput label="Staffing target (overall headcount)" type="number" min={0} {...register('staffing_target')} />
          <SelectInput label="Examination supervisor" {...register('supervisor_id')}><option value="">Not assigned</option>{sups.data?.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}</SelectInput>
        </div>
        <TextArea label="Operational instructions (visible to assigned volunteers)" rows={4} {...register('instructions')} />
        <TextArea label="Internal administrative remarks (staff only)" {...register('internal_remarks')} />
        {!readOnly && <div className="flex justify-end"><Button type="submit" loading={save.isPending} disabled={!!event && !isDirty}>{event ? 'Save changes' : 'Create draft event'}</Button></div>}
      </fieldset>
    </form>
  )
}

export function EventNew() {
  return (<div><PageHeader title="New Examination Event" description="The event is saved as a draft. Add dates, venues and staffing requirements, then publish." /><Card><EventForm /></Card></div>)
}

const NEXT: Record<string, { to: string; label: string; danger?: boolean; reason?: boolean }[]> = {
  draft: [{ to: 'open_for_registration', label: 'Publish — open for registration' }, { to: 'cancelled', label: 'Cancel event', danger: true, reason: true }],
  open_for_registration: [{ to: 'under_staffing', label: 'Close recruitment — start staffing' }, { to: 'cancelled', label: 'Cancel event', danger: true, reason: true }],
  under_staffing: [{ to: 'assignments_released', label: 'Mark assignments released' }, { to: 'cancelled', label: 'Cancel event', danger: true, reason: true }],
  assignments_released: [{ to: 'ready_for_deployment', label: 'Ready for deployment' }, { to: 'cancelled', label: 'Cancel event', danger: true, reason: true }],
  ready_for_deployment: [{ to: 'ongoing', label: 'Start examination' }, { to: 'cancelled', label: 'Cancel event', danger: true, reason: true }],
  ongoing: [{ to: 'completed', label: 'Mark completed' }],
  completed: [{ to: 'archived', label: 'Archive', reason: true }],
  cancelled: [{ to: 'archived', label: 'Archive', reason: true }],
}

export function EventDetail() {
  const { id } = useParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [action, setAction] = useState<{ to: string; label: string; danger?: boolean; reason?: boolean } | null>(null)
  const q = useQuery({ queryKey: ['event', id], queryFn: async () => unwrap(await supabase.from('examination_events').select('*, professions(name)').eq('id', id!).single()) as EventRow })
  const move = useMutation({
    mutationFn: async (v: { to: string; reason: string }) => { unwrap(await supabase.rpc('set_event_status', { p_event: id, p_status: v.to, p_reason: v.reason || null })) },
    onSuccess: () => { toast.success('Event status updated'); qc.invalidateQueries() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorState error={q.error} />
  const e = q.data!
  const manage = can('events.manage')
  return (
    <div className="space-y-4">
      <PageHeader title={e.name} description={`${e.event_no} · ${e.professions?.name ?? ''}`}
        actions={<>{<StatusBadge status={e.status} />}{manage && NEXT[e.status]?.map((a) => <Button key={a.to} variant={a.danger ? 'danger' : 'secondary'} size="sm" onClick={() => setAction(a)}>{a.label}</Button>)}</>} />
      {e.status === 'draft' && <Alert tone="info">This event is a draft and is not visible to volunteers. To publish it needs a profession, at least one date, one venue, one staffing requirement, the recruitment period and the confirmation deadline.</Alert>}
      <Tabs tabs={[
        { id: 'details', label: 'Details', content: <Card><EventForm event={e} readOnly={!manage} /></Card> },
        { id: 'dates', label: 'Dates & schedule', content: <DatesTab eventId={e.id} canEdit={manage} /> },
        { id: 'venues', label: 'Venues', content: <VenuesTab eventId={e.id} canEdit={manage} /> },
        { id: 'staffing', label: 'Staffing requirements', content: <StaffingTab eventId={e.id} canEdit={manage} /> },
      ]} />
      <ConfirmDialog open={!!action} danger={action?.danger} requireReason={action?.reason} title={action?.label ?? ''} confirmLabel={action?.label}
        message={action?.to === 'open_for_registration' ? 'Publishing makes this event visible to volunteers, who can then submit preferences. Continue?' : action?.to === 'cancelled' ? 'Cancelling cancels all live assignments and notifies affected volunteers.' : action?.to === 'archived' ? 'Archived events are hidden from volunteers and cannot be reopened.' : `Change the status to “${action?.to.replace(/_/g, ' ')}”?`}
        onClose={() => setAction(null)} onConfirm={(reason) => move.mutateAsync({ to: action!.to, reason })} />
    </div>
  )
}

function DatesTab({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const fields: FieldDef[] = [
    { name: 'exam_date', label: 'Examination date', type: 'date', required: true }, { name: 'report_time', label: 'Reporting time', type: 'time' },
    { name: 'start_time', label: 'Start time', type: 'time' }, { name: 'end_time', label: 'End time', type: 'time' }, { name: 'notes', label: 'Notes', type: 'textarea' }]
  return <CrudCard title="Examination dates" table="examination_dates" queryKey={['crud-dates', eventId]} filter={{ column: 'event_id', value: eventId }} fixed={{ event_id: eventId }} orderBy="exam_date" canEdit={canEdit} canDelete fields={fields}
    columns={[{ header: 'Date', cell: (r) => fmtDate(r.exam_date) }, { header: 'Report', cell: (r) => fmtTime(r.report_time) }, { header: 'Start', cell: (r) => fmtTime(r.start_time) }, { header: 'End', cell: (r) => fmtTime(r.end_time) }, { header: 'Notes', cell: (r) => r.notes }]} />
}

function VenuesTab({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const centers = useCenters()
  const buildings = useQuery({ queryKey: ['buildings-all'], queryFn: async () => unwrap(await supabase.from('buildings').select('*').eq('active', true).order('name')) as Building[] })
  const fields: FieldDef[] = [
    { name: 'center_id', label: 'Examination center', type: 'select', required: true, options: centers.data?.map((c) => ({ value: c.id, label: `${c.name}${c.city_municipality ? ` — ${c.city_municipality}` : ''}` })) },
    { name: 'building_id', label: 'Building (optional)', type: 'select', hint: 'Leave blank for the whole center', options: buildings.data?.map((b) => ({ value: b.id, label: `${centers.data?.find((c) => c.id === b.center_id)?.name ?? ''} — ${b.name}` })) }]
  return <CrudCard title="Venues for this event" description="An event can use several centers and buildings." table="event_sites" select="*, examination_centers(name,city_municipality), buildings(name)" queryKey={['crud-sites', eventId]} filter={{ column: 'event_id', value: eventId }} fixed={{ event_id: eventId }} canEdit={canEdit} canDelete fields={fields}
    columns={[{ header: 'Center', cell: (r) => r.examination_centers?.name }, { header: 'City / municipality', cell: (r) => r.examination_centers?.city_municipality }, { header: 'Building', cell: (r) => r.buildings?.name ?? 'All buildings' }]} />
}

function StaffingTab({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const centers = useCenters()
  const positions = usePositions()
  const dates = useQuery({ queryKey: ['crud-dates', eventId, 'list'], queryFn: async () => unwrap(await supabase.from('examination_dates').select('*').eq('event_id', eventId).order('exam_date')) as ExamDate[] })
  const buildings = useQuery({ queryKey: ['buildings-all'], queryFn: async () => unwrap(await supabase.from('buildings').select('*').order('name')) as Building[] })
  const floors = useQuery({ queryKey: ['floors-all'], queryFn: async () => unwrap(await supabase.from('floors').select('*').order('level_no')) as Floor[] })
  const rooms = useQuery({ queryKey: ['rooms-all'], queryFn: async () => unwrap(await supabase.from('rooms').select('*').order('name')) as Room[] })
  const rows = useQuery({ queryKey: ['staffing', eventId], queryFn: async () => unwrap(await supabase.from('staffing_summary').select('*').eq('event_id', eventId)) as StaffingRow[] })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ date: '', center: '', building: '', floor: '', room: '', position: '', count: '1' })
  const add = useMutation({
    mutationFn: async () => {
      if (!form.center || !form.position || !(Number(form.count) > 0)) throw new Error('Center, position and a positive headcount are required')
      const targets = form.date ? [form.date] : (dates.data ?? []).map((d) => d.id)
      if (!targets.length) throw new Error('Add examination dates first')
      const payload = targets.map((d) => ({ event_id: eventId, exam_date_id: d, center_id: form.center, building_id: form.building || null, floor_id: form.floor || null, room_id: form.room || null, position_id: form.position, required_count: Number(form.count) }))
      const { error } = await supabase.from('staffing_requirements').insert(payload)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast.success('Requirement added'); setAdding(false); qc.invalidateQueries({ queryKey: ['staffing', eventId] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: async (rid: string) => { const { error } = await supabase.from('staffing_requirements').delete().eq('id', rid); if (error) throw new Error(error.message) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staffing', eventId] }), onError: (e) => toast.error(errorMessage(e)),
  })
  const upd = useMutation({
    mutationFn: async (v: { id: string; n: number }) => { unwrap(await supabase.from('staffing_requirements').update({ required_count: v.n }).eq('id', v.id).select('id').single()) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staffing', eventId] }), onError: (e) => toast.error(errorMessage(e)),
  })
  const name = <T extends { id: string }>(list: T[] | undefined, id: string | null, f: (x: T) => string) => (id ? (list?.find((x) => x.id === id) ? f(list.find((x) => x.id === id)!) : '—') : '—')
  const total = (rows.data ?? []).reduce((a, r) => ({ req: a.req + r.required_count, asg: a.asg + r.assigned_count, con: a.con + r.confirmed_count, vac: a.vac + r.vacant_count }), { req: 0, asg: 0, con: 0, vac: 0 })
  return (
    <Card title="Staffing requirements" padded={false} actions={canEdit ? <Button size="sm" onClick={() => setAdding(true)}>Add requirement</Button> : undefined}>
      <p className="border-b border-line px-4 py-2 text-xs text-muted">Required {total.req} · Assigned {total.asg} · Confirmed {total.con} · Vacant {total.vac} — calculated from assignment records.</p>
      {rows.isLoading ? <Spinner /> : rows.data?.length === 0 ? <EmptyState title="No staffing requirements yet" hint="Add the positions needed per date, center, building, floor and room." /> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-muted"><tr>{['Date', 'Location', 'Position', 'Required', 'Assigned', 'Confirmed', 'Vacant', 'Indicator', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{[...(rows.data ?? [])].sort((a, b) => (dates.data?.find((d) => d.id === a.exam_date_id)?.exam_date ?? '').localeCompare(dates.data?.find((d) => d.id === b.exam_date_id)?.exam_date ?? '')).map((r) => {
            const ind = staffingIndicator(r)
            return <tr key={r.requirement_id}>
              <td className="px-3 py-2">{fmtDate(dates.data?.find((d) => d.id === r.exam_date_id)?.exam_date)}</td>
              <td className="px-3 py-2 text-xs">{[name(centers.data, r.center_id, (c) => c.name), r.building_id && name(buildings.data, r.building_id, (b) => b.name), r.floor_id && name(floors.data, r.floor_id, (f) => f.label), r.room_id && name(rooms.data, r.room_id, (m) => m.name)].filter(Boolean).join(' › ')}</td>
              <td className="px-3 py-2">{name(positions.data, r.position_id, (p) => p.name)}</td>
              <td className="px-3 py-2">{canEdit ? <input aria-label="Required headcount" type="number" min={Math.max(1, r.assigned_count)} defaultValue={r.required_count} className="w-16 rounded border border-line px-1 py-0.5" onBlur={(e) => { const n = Number(e.target.value); if (n !== r.required_count && n > 0) upd.mutate({ id: r.requirement_id, n }) }} /> : r.required_count}</td>
              <td className="px-3 py-2">{r.assigned_count}</td><td className="px-3 py-2">{r.confirmed_count}</td><td className="px-3 py-2 font-semibold">{r.vacant_count}</td>
              <td className="px-3 py-2"><Badge tone={ind === 'fully_staffed' ? 'success' : ind === 'understaffed' || ind === 'unassigned' ? 'danger' : 'warning'}>{INDICATOR_LABEL[ind]}</Badge></td>
              <td className="px-3 py-2">{canEdit && r.assigned_count === 0 && <Button size="sm" variant="ghost" onClick={() => del.mutate(r.requirement_id)}>Remove</Button>}</td></tr>
          })}</tbody></table></div>)}
      {adding && (
        <ConfirmDialog open title="Add staffing requirement" confirmLabel="Add" onClose={() => setAdding(false)} onConfirm={() => add.mutateAsync()} message={
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput label="Date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}><option value="">All examination dates</option>{dates.data?.map((d) => <option key={d.id} value={d.id}>{fmtDate(d.exam_date)}</option>)}</SelectInput>
            <SelectInput label="Position" required value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}><option value="">Select…</option>{positions.data?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput>
            <SelectInput label="Center" required value={form.center} onChange={(e) => setForm({ ...form, center: e.target.value, building: '', floor: '', room: '' })}><option value="">Select…</option>{centers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectInput>
            <SelectInput label="Building" value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value, floor: '', room: '' })}><option value="">Any</option>{buildings.data?.filter((b) => b.center_id === form.center).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</SelectInput>
            <SelectInput label="Floor" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value, room: '' })}><option value="">Any</option>{floors.data?.filter((f) => f.building_id === form.building).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</SelectInput>
            <SelectInput label="Room" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}><option value="">Any</option>{rooms.data?.filter((m) => m.floor_id === form.floor).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</SelectInput>
            <TextInput label="Required headcount" type="number" min={1} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
          </div>} />)}
    </Card>
  )
}
