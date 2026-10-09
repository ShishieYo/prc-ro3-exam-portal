import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/auth/AuthProvider'
import { DecisionModal } from '@/components/DecisionModal'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { FilterSelect, TextInput } from '@/components/ui/form'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { Alert, Badge, Button, Card, DescriptionList, ErrorState, PageHeader, Spinner, StatCard, StatusBadge } from '@/components/ui/ui'
import { fmtDate, fmtDateTime, titleCase } from '@/lib/format'
import { applyPage, runPage } from '@/lib/query'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { CpdRow, ExamEvent } from '@/types/db'
import { useProfessions } from './events'

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUSES = ['not_eligible', 'pending_attendance_verification', 'for_cpd_review', 'pending_approval', 'approved', 'rejected', 'released', 'revoked_corrected']

function useEvents() {
  return useQuery({ queryKey: ['events-pick-all'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').neq('status', 'draft').order('created_at', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
}

function CpdTable({ review }: { review?: boolean }) {
  const events = useEvents()
  const profs = useProfessions()
  const [eventId, setEventId] = useState('')
  const [status, setStatus] = useState('')
  const [prof, setProf] = useState('')
  const [flagged, setFlagged] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const cols: Col<CpdRow>[] = [
    { key: 'no', header: 'Record', sort: 'record_no', cell: (r) => <span className="font-mono text-xs">{r.record_no}</span> },
    { key: 'n', header: 'Professional', sort: 'volunteer_name', cell: (r) => <span className="font-medium">{r.volunteer_name}</span> },
    { key: 'lic', header: 'License', cell: (r) => <span className="font-mono text-xs">{r.license_ref}</span> },
    { key: 'pr', header: 'Profession', cell: (r) => r.profession_name },
    { key: 'e', header: 'Examination', cell: (r) => r.event_name },
    { key: 'd', header: 'Service date', sort: 'service_date', cell: (r) => fmtDate(r.service_date) },
    { key: 'u', header: 'Proposed / approved', cell: (r) => `${Number(r.units_proposed)} / ${Number(r.units_approved)}` },
    { key: 'v', header: 'Rule', cell: (r) => `v${r.rule_version ?? '—'}` },
    { key: 's', header: 'Status', sort: 'status', cell: (r) => <><StatusBadge status={r.status} />{r.needs_review && <Badge tone="danger">Flagged</Badge>}</> },
  ]
  return (
    <>
      <DataTable<CpdRow> queryKey={['cpd', review, eventId, status, prof, flagged]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'service_date', asc: false }} onRowClick={(r) => setOpen(r.id)} searchPlaceholder="Search professional or record no.…"
        filters={<>
          <FilterSelect label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">All</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{review ? 'Needs action' : 'All'}</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</FilterSelect>
          <FilterSelect label="Profession" value={prof} onChange={(e) => setProf(e.target.value)}><option value="">All</option>{profs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</FilterSelect>
          <label className="flex items-center gap-1.5 pb-2 text-xs font-medium text-muted"><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> Flagged only</label></>}
        fetchPage={(p) => { let q = supabase.from('cpd_record_view').select('*', { count: 'exact' }); if (eventId) q = q.eq('event_id', eventId); if (prof) q = q.eq('profession_id', prof); if (flagged) q = q.eq('needs_review', true)
          if (status) q = q.eq('status', status); else if (review) q = q.or('status.in.(for_cpd_review,pending_approval,approved),needs_review.eq.true')
          return runPage(applyPage(q, p, ['volunteer_name', 'record_no', 'license_ref'])) }}
        exportAs={{ name: 'cpd-records', columns: [{ header: 'Record', value: (r) => r.record_no }, { header: 'Professional', value: (r) => r.volunteer_name }, { header: 'License', value: (r) => r.license_ref }, { header: 'Profession', value: (r) => r.profession_name }, { header: 'Examination', value: (r) => r.event_name },
          { header: 'Service date', value: (r) => r.service_date }, { header: 'Position', value: (r) => r.position_name }, { header: 'Units proposed', value: (r) => r.units_proposed }, { header: 'Units approved', value: (r) => r.units_approved }, { header: 'Rule version', value: (r) => r.rule_version }, { header: 'Status', value: (r) => r.status }] }} />
      {open && <CpdDialog id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

export function CpdMonitoring() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const events = useEvents()
  const [eventId, setEventId] = useState('')
  const dash = useQuery({ queryKey: ['cpd-dash'], queryFn: async () => unwrap(await supabase.rpc('cpd_dashboard')) as any })
  const regen = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('generate_cpd_records', { p_event: eventId })) as number,
    onSuccess: (n) => { toast.success(`Re-evaluated ${n} attendance record(s)`); qc.invalidateQueries() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const d = dash.data
  return (
    <div className="space-y-4">
      <PageHeader title="CPD Monitoring" description="Units shown are recorded by this portal from verified participation. They are not a professional's complete PRC CPD balance and are not submitted to any external system." />
      {(can('cpd.review') || can('cpd.adjust')) && (
        <Card><div className="flex flex-wrap items-end gap-3"><FilterSelect label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)} className="min-w-64"><option value="">Select…</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect>
          <Button variant="secondary" disabled={!eventId} loading={regen.isPending} onClick={() => regen.mutate()}>Re-evaluate CPD eligibility</Button></div></Card>)}
      {dash.isLoading ? <Spinner /> : dash.isError ? <ErrorState error={dash.error} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Eligible professionals" value={d.eligible_professionals} /><StatCard label="Qualifying service days" value={d.qualifying_days} /><StatCard label="Units approved" value={Number(d.units_approved)} /><StatCard label="Units pending" value={Number(d.units_pending)} />
            <StatCard label="For review" value={d.for_review} tone={d.for_review ? 'warning' : 'neutral'} /><StatCard label="Pending approval" value={d.pending_approval} tone={d.pending_approval ? 'warning' : 'neutral'} /><StatCard label="Rejected / corrected" value={`${d.rejected} / ${d.corrected}`} /><StatCard label="Flagged after correction" value={d.flagged} tone={d.flagged ? 'danger' : 'neutral'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Units by examination">{d.by_event.length === 0 ? <p className="text-sm text-muted">No records yet.</p> : <div className="h-56" role="img" aria-label="CPD units by examination"><ResponsiveContainer><BarChart data={d.by_event}><CartesianGrid vertical={false} stroke="#e5e9f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="approved" name="Approved" fill="#0b2a5b" /><Bar dataKey="pending" name="Pending" fill="#5b8fd1" /></BarChart></ResponsiveContainer></div>}</Card>
            <Card title="Approved units by profession">{d.by_profession.length === 0 ? <p className="text-sm text-muted">No records yet.</p> : <div className="h-56" role="img" aria-label="CPD units by profession"><ResponsiveContainer><BarChart data={d.by_profession}><CartesianGrid vertical={false} stroke="#e5e9f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="approved" name="Approved units" fill="#0b2a5b" /><Bar dataKey="professionals" name="Professionals" fill="#5b8fd1" /></BarChart></ResponsiveContainer></div>}</Card>
          </div>
        </>)}
      <CpdTable />
    </div>
  )
}

export function CpdReview() {
  return (<div className="space-y-4"><PageHeader title="CPD Review and Approval" description="Review verified participation, approve with a different officer where the rule requires two steps, and correct records only through documented adjustments." /><CpdTable review /></div>)
}

function CpdDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [dlg, setDlg] = useState<null | 'reject' | 'revoke' | 'reconsider' | 'return' | 'units' | 'flag' | 'release'>(null)
  const [units, setUnits] = useState('')
  const [cert, setCert] = useState('')
  const r = useQuery({ queryKey: ['cpd-one', id], queryFn: async () => unwrap(await supabase.from('cpd_record_view').select('*').eq('id', id).single()) as CpdRow })
  const hist = useQuery({ queryKey: ['cpd-hist', id], queryFn: async () => unwrap(await supabase.from('cpd_adjustments').select('*').eq('cpd_record_id', id).order('created_at')) as { id: string; action: string; units_before: number | null; units_after: number | null; reason: string | null; created_at: string }[] })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['cpd-one', id] }); qc.invalidateQueries({ queryKey: ['cpd-hist', id] }); qc.invalidateQueries({ queryKey: ['cpd'] }); qc.invalidateQueries({ queryKey: ['cpd-dash'] }) }
  const setStatus = useMutation({
    mutationFn: async (v: { status: string; reason?: string; units?: number }) => { unwrap(await supabase.rpc('set_cpd_status', { p_id: id, p_status: v.status, p_reason: v.reason ?? null, p_units: v.units ?? null })) },
    onSuccess: () => { toast.success('CPD record updated'); refresh() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const adjust = async (action: string, u: number | null, reason: string) => { unwrap(await supabase.rpc('adjust_cpd_record', { p_id: id, p_action: action, p_units: u, p_reason: reason })); toast.success('Adjustment recorded'); refresh() }
  if (r.isLoading) return <Modal open title="CPD record" onClose={onClose}><Spinner /></Modal>
  if (r.isError) return <Modal open title="CPD record" onClose={onClose}><ErrorState error={r.error} /></Modal>
  const c = r.data!
  const S = c.status
  const btn = (label: string, fn: () => void, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => <Button key={label} size="sm" variant={variant} onClick={fn} loading={setStatus.isPending}>{label}</Button>
  return (
    <Modal open wide title={`${c.record_no} — ${c.volunteer_name}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4 text-sm">
        {c.needs_review && <Alert tone="danger" title="Flagged for review">{c.review_note}. The record has not been changed. Resolve it by confirming it still stands, correcting units, or revoking it.</Alert>}
        <DescriptionList items={[['Status', <StatusBadge key="s" status={S} />], ['License', c.license_ref], ['Profession', c.profession_name], ['Examination', c.event_name], ['Position', c.position_name], ['Qualifying service date', fmtDate(c.service_date)],
          ['Rule version applied', `v${c.rule_version ?? '—'}`], ['Units proposed / approved', `${Number(c.units_proposed)} / ${Number(c.units_approved)}`], ['Certificate / record ref.', c.certificate_ref ?? '—'], ['Remarks', c.remarks ?? '—']]} />
        <div className="flex flex-wrap gap-2">
          {S === 'for_cpd_review' && can('cpd.review') && <>{btn('Forward for approval', () => setStatus.mutate({ status: 'pending_approval' }), 'primary')}{btn('Reject…', () => setDlg('reject'), 'danger')}</>}
          {S === 'for_cpd_review' && can('cpd.approve') && btn('Approve (single-step rules only)', () => setStatus.mutate({ status: 'approved' }))}
          {S === 'pending_approval' && can('cpd.approve') && <>{btn('Approve', () => setStatus.mutate({ status: 'approved' }), 'primary')}{btn('Reject…', () => setDlg('reject'), 'danger')}{btn('Return for review…', () => setDlg('return'))}</>}
          {S === 'approved' && can('cpd.approve') && btn('Release…', () => setDlg('release'), 'primary')}
          {['approved', 'released'].includes(S) && can('cpd.adjust') && <>{btn('Correct units…', () => { setUnits(String(c.units_approved)); setDlg('units') })}{btn('Revoke / correct…', () => setDlg('revoke'), 'danger')}</>}
          {S === 'rejected' && can('cpd.review') && btn('Reconsider…', () => setDlg('reconsider'))}
          {S === 'revoked_corrected' && can('cpd.adjust') && btn('Re-open for review…', () => setDlg('reconsider'))}
          {c.needs_review && can('cpd.adjust') && btn('Record: record stands…', () => setDlg('flag'))}
        </div>
        <div><p className="mb-1 text-xs font-medium uppercase text-muted">Ledger / adjustment history</p>
          {hist.data?.length === 0 ? <p className="text-muted">No history yet.</p> : <ul className="space-y-1">{hist.data?.map((h) => <li key={h.id} className="text-xs"><span className="text-muted">{fmtDateTime(h.created_at)}</span> · {titleCase(h.action.replace('status:', '').replace('->', ' → '))}{h.units_before !== null && ` · units ${Number(h.units_before)} → ${Number(h.units_after)}`}{h.reason && ` — ${h.reason}`}</li>)}</ul>}</div>
      </div>
      {dlg === 'reject' && <DecisionModal title="Reject CPD credit" onClose={() => setDlg(null)} options={[{ value: 'rejected', label: 'Rejected', reasonRequired: true }]} onSubmit={async (_d, reason) => setStatus.mutateAsync({ status: 'rejected', reason })} />}
      {dlg === 'return' && <DecisionModal title="Return for review" onClose={() => setDlg(null)} options={[{ value: 'for_cpd_review', label: 'Return to reviewer', reasonRequired: true }]} onSubmit={async (_d, reason) => setStatus.mutateAsync({ status: 'for_cpd_review', reason })} />}
      {dlg === 'reconsider' && <DecisionModal title="Re-open for review" onClose={() => setDlg(null)} options={[{ value: 'for_cpd_review', label: 'Re-open', reasonRequired: true }]} onSubmit={async (_d, reason) => setStatus.mutateAsync({ status: 'for_cpd_review', reason })} />}
      {dlg === 'revoke' && <DecisionModal title="Revoke / correct approved credit" onClose={() => setDlg(null)} options={[{ value: 'revoked_corrected', label: 'Revoke (units set to 0; history retained)', reasonRequired: true }]} onSubmit={async (_d, reason) => setStatus.mutateAsync({ status: 'revoked_corrected', reason })} />}
      {dlg === 'flag' && <DecisionModal title="Resolve flag" onClose={() => setDlg(null)} options={[{ value: 'clear', label: 'Confirm the record still stands', reasonRequired: true }]} onSubmit={async (_d, reason) => adjust('clear_flag', null, reason)} />}
      {dlg === 'units' && <DecisionModal title="Correct approved units" onClose={() => setDlg(null)} options={[{ value: 'units', label: 'Correct units', reasonRequired: true }]} onSubmit={async (_d, reason) => adjust('correct_units', Number(units), reason)}><TextInput label="Corrected approved units" type="number" step="0.5" min={0} value={units} onChange={(e) => setUnits(e.target.value)} /></DecisionModal>}
      {dlg === 'release' && <DecisionModal title="Release CPD record" onClose={() => setDlg(null)} options={[{ value: 'release', label: 'Release to volunteer record' }]}
        onSubmit={async () => { if (cert) { const { error } = await supabase.from('cpd_records').update({ certificate_ref: cert }).eq('id', id); if (error) throw new Error(error.message) } await setStatus.mutateAsync({ status: 'released' }) }}>
        <TextInput label="Certificate / record reference (optional)" value={cert} onChange={(e) => setCert(e.target.value)} /></DecisionModal>}
    </Modal>
  )
}
