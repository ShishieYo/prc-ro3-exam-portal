import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Button, Card, DescriptionList, EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge } from '@/components/ui/ui'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { ConfirmDialog } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { useMyVolunteer } from '@/hooks/useMyVolunteer'
import { fmtClock, fmtDate, fmtDateTime, fmtTime, peso, titleCase } from '@/lib/format'
import { applyPage, runPage } from '@/lib/query'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { AllowanceRow, CpdRow, RosterRow } from '@/types/db'

export function MyAssignments() {
  const cols: Col<RosterRow>[] = [
    { key: 'date', header: 'Date', sort: 'exam_date', cell: (r) => fmtDate(r.exam_date) },
    { key: 'event', header: 'Examination', sort: 'event_name', cell: (r) => <Link className="font-medium text-navy-800 hover:underline" to={`/assignments/${r.id}`}>{r.event_name}</Link> },
    { key: 'pos', header: 'Position', cell: (r) => r.position_name },
    { key: 'loc', header: 'Location', cell: (r) => [r.center_name, r.building_name, r.floor_label, r.room_name].filter(Boolean).join(' › ') },
    { key: 'rt', header: 'Report', cell: (r) => fmtTime(r.report_time) },
    { key: 'st', header: 'Status', sort: 'status', cell: (r) => <StatusBadge status={r.status} /> },
  ]
  return (
    <div>
      <PageHeader title="My Assignments" description="Offers, confirmed duties and history. Open an assignment to confirm, decline or print your notice." />
      <DataTable<RosterRow>
        queryKey={['my-assignments']} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'exam_date', asc: false }} searchPlaceholder="Search examination…"
        fetchPage={(p) => runPage(applyPage(supabase.from('assignment_roster').select('*', { count: 'exact' }), p, ['event_name', 'position_name', 'center_name']))}
        emptyTitle="No assignments yet" emptyHint="Assignments appear here once PRC releases them. Submitting a preference does not create an assignment."
      />
    </div>
  )
}

interface HistoryRow { id: string; from_status: string | null; to_status: string; reason: string | null; created_at: string }

export function AssignmentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: vol } = useMyVolunteer()
  const [confirm, setConfirm] = useState<'decline' | 'withdraw' | null>(null)
  const a = useQuery({ queryKey: ['assignment', id], queryFn: async () => unwrap(await supabase.from('assignment_roster').select('*').eq('id', id!).single()) as RosterRow })
  const ev = useQuery({
    queryKey: ['assignment-event', a.data?.event_id], enabled: !!a.data,
    queryFn: async () => unwrap(await supabase.from('examination_events').select('instructions,confirmation_deadline,professions(name)').eq('id', a.data!.event_id).single()) as unknown as { instructions: string | null; confirmation_deadline: string | null; professions: { name: string } | null },
  })
  const hist = useQuery({
    queryKey: ['assignment-history', id],
    queryFn: async () => unwrap(await supabase.from('assignment_history').select('id,from_status,to_status,reason,created_at').eq('assignment_id', id!).order('seq')) as HistoryRow[],
  })
  const respond = useMutation({
    mutationFn: async (v: { action: string; reason?: string }) => unwrap(await supabase.rpc('respond_assignment', { p_id: id, p_action: v.action, p_reason: v.reason ?? null })) as string,
    onSuccess: (st) => { toast.success(`Assignment ${titleCase(st).toLowerCase()}`); qc.invalidateQueries({ queryKey: ['assignment', id] }); qc.invalidateQueries({ queryKey: ['assignment-history', id] }); qc.invalidateQueries({ queryKey: ['my-assignments'] }); qc.invalidateQueries({ queryKey: ['assignments-home'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (a.isLoading) return <Spinner />
  if (a.isError) return <ErrorState error={a.error} />
  const r = a.data!
  const waitingApproval = r.status === 'awaiting_volunteer_confirmation' && r.volunteer_response === 'accepted'
  const showNotice = ['awaiting_volunteer_confirmation', 'confirmed', 'completed'].includes(r.status)
  return (
    <div className="space-y-4">
      <PageHeader title="Assignment Details" description={`${r.assignment_no} · ${r.event_name}`}
        actions={<><Button variant="secondary" onClick={() => nav('/assignments')}>Back</Button>{showNotice && <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print / save notice</Button>}</>} />
      {r.status === 'awaiting_volunteer_confirmation' && !waitingApproval && (
        <Alert tone="warning" title="Your confirmation is needed">Please accept or decline this assignment{ev.data?.confirmation_deadline ? ` by ${fmtDate(ev.data.confirmation_deadline)}` : ''}.
          <div className="mt-3 flex gap-2"><Button loading={respond.isPending} onClick={() => respond.mutate({ action: 'accept' })}>Accept assignment</Button><Button variant="secondary" onClick={() => setConfirm('decline')}>Decline</Button></div></Alert>)}
      {waitingApproval && <Alert tone="info">You accepted this assignment. It will be confirmed once PRC approves your acceptance.</Alert>}
      {r.status === 'confirmed' && <div><Button variant="secondary" onClick={() => setConfirm('withdraw')}>Withdraw from assignment</Button></div>}

      <div id="notice" className="space-y-4">
        <Card title="Assignment notice" actions={<StatusBadge status={r.status} />}>
          <DescriptionList items={[
            ['Volunteer', `${vol?.last_name ?? ''}, ${vol?.first_name ?? ''} (${vol?.volunteer_no ?? ''})`],
            ['Examination', `${r.event_name}${ev.data?.professions ? ` — ${ev.data.professions.name}` : ''}`],
            ['Duty date', fmtDate(r.exam_date)],
            ['Position', r.position_name],
            ['Reporting time', fmtTime(r.report_time)],
            ['Expected end', fmtTime(r.expected_end_time)],
            ['Center', r.center_name], ['Building', r.building_name],
            ['Floor', r.floor_label], ['Room / area', r.room_name],
            ['Assignment no.', r.assignment_no], ['Confirmed', r.confirmed_at ? fmtDateTime(r.confirmed_at) : '—'],
          ]} />
          {ev.data?.instructions && <div className="mt-4 border-t border-line pt-3"><p className="text-xs font-medium uppercase text-muted">Operational instructions</p><p className="mt-1 whitespace-pre-wrap text-sm">{ev.data.instructions}</p></div>}
          <p className="mt-4 text-xs text-muted">Present a valid ID on the day of duty. This notice is generated by the PRC Region III Examination Personnel Portal.</p>
        </Card>
      </div>

      <Card title="History" className="no-print">
        <ol className="space-y-2 text-sm">
          {hist.data?.map((h) => <li key={h.id} className="flex flex-wrap gap-2"><span className="w-40 text-xs text-muted">{fmtDateTime(h.created_at)}</span><span>{h.from_status ? `${titleCase(h.from_status)} → ` : ''}<strong>{titleCase(h.to_status)}</strong>{h.reason ? ` — ${h.reason}` : ''}</span></li>)}
        </ol>
      </Card>
      <ConfirmDialog open={!!confirm} title={confirm === 'withdraw' ? 'Withdraw from assignment' : 'Decline assignment'} danger requireReason reasonLabel="Reason (required)" confirmLabel={confirm === 'withdraw' ? 'Withdraw' : 'Decline'}
        message="PRC will be notified and may reassign this duty to someone else." onClose={() => setConfirm(null)} onConfirm={(reason) => respond.mutateAsync({ action: confirm!, reason })} />
    </div>
  )
}

interface AttRow { id: string; status: string; verification_status: string; check_in_at: string | null; check_out_at: string | null; examination_dates: { exam_date: string } | null; assignments: { assignment_positions: { name: string } | null; examination_events: { name: string } | null } | null }

export function MyAttendance() {
  const cols: Col<AttRow>[] = [
    { key: 'date', header: 'Date', cell: (r) => fmtDate(r.examination_dates?.exam_date) },
    { key: 'ev', header: 'Examination', cell: (r) => r.assignments?.examination_events?.name },
    { key: 'pos', header: 'Position', cell: (r) => r.assignments?.assignment_positions?.name },
    { key: 'in', header: 'Check-in', cell: (r) => fmtClock(r.check_in_at) },
    { key: 'out', header: 'Check-out', cell: (r) => fmtClock(r.check_out_at) },
    { key: 'st', header: 'Attendance', sort: 'status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'v', header: 'Verification', sort: 'verification_status', cell: (r) => <StatusBadge status={r.verification_status} /> },
  ]
  return (
    <div>
      <PageHeader title="My Attendance" description="Attendance is recorded by authorised personnel. Only verified attendance counts toward allowances and CPD." />
      <DataTable<AttRow> queryKey={['my-attendance']} rowKey={(r) => r.id} columns={cols} hideSearch
        fetchPage={(p) => runPage(applyPage(supabase.from('attendance_records').select('id,status,verification_status,check_in_at,check_out_at, examination_dates(exam_date), assignments(assignment_positions(name), examination_events(name))', { count: 'exact' }), p, [], { column: 'created_at', asc: false }))}
        emptyTitle="No attendance records yet" />
    </div>
  )
}

export function MyAllowances() {
  const q = useQuery({ queryKey: ['my-allowances'], queryFn: async () => unwrap(await supabase.rpc('my_allowances')) as AllowanceRow[] })
  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorState error={q.error} />
  const rows = q.data ?? []
  const sum = (f: (r: AllowanceRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  return (
    <div>
      <PageHeader title="My Allowances" description="Allowance processing is tracked here. This portal records status only; payment is made through PRC's financial process." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Approved amount" value={peso(sum((r) => Number(r.approved_amount ?? 0)))} />
        <StatCard label="Paid" value={peso(sum((r) => Number(r.total_paid)))} />
        <StatCard label="Outstanding" value={peso(sum((r) => (r.processing_status === 'disapproved' || r.payment_status === 'cancelled' ? 0 : Number(r.balance))))} />
      </div>
      <Card padded={false}>
        {rows.length === 0 ? <EmptyState title="No allowance records yet" hint="A record is created after your attendance for an allowance-eligible position is verified." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-muted"><tr>{['Record', 'Duty date', 'Examination / position', 'Amount', 'Processing', 'Payment', 'Paid on', 'Notes'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r) => (
              <tr key={r.id}><td className="px-3 py-2 font-mono text-xs">{r.record_no}</td><td className="px-3 py-2">{fmtDate(r.duty_date)}</td>
                <td className="px-3 py-2">{r.event_name}<br /><span className="text-xs text-muted">{r.position_name}</span></td><td className="px-3 py-2">{peso(r.approved_amount)}</td>
                <td className="px-3 py-2"><StatusBadge status={r.processing_status} /></td><td className="px-3 py-2"><StatusBadge status={r.payment_status} /></td>
                <td className="px-3 py-2">{fmtDate(r.payment_date)}{r.payment_reference && <><br /><span className="text-xs text-muted">Ref {r.payment_reference}</span></>}</td>
                <td className="px-3 py-2 text-xs text-amber-800">{r.requirements_note ?? ''}</td></tr>))}</tbody></table></div>)}
      </Card>
    </div>
  )
}

export function MyCpd() {
  const { data: vol } = useMyVolunteer()
  const totals = useQuery({ queryKey: ['my-cpd-totals'], enabled: !!vol, queryFn: async () => unwrap(await supabase.from('cpd_volunteer_totals').select('*').eq('volunteer_id', vol!.id).maybeSingle()) as { approved_units: number; pending_units: number; qualifying_days: number } | null })
  const cols: Col<CpdRow>[] = [
    { key: 'd', header: 'Service date', sort: 'service_date', cell: (r) => fmtDate(r.service_date) },
    { key: 'e', header: 'Examination', cell: (r) => r.event_name },
    { key: 'p', header: 'Position', cell: (r) => r.position_name },
    { key: 'pr', header: 'Proposed', cell: (r) => Number(r.units_proposed) },
    { key: 'ap', header: 'Approved', cell: (r) => Number(r.units_approved) },
    { key: 's', header: 'Status', sort: 'status', cell: (r) => <><StatusBadge status={r.status} />{r.status === 'not_eligible' && r.remarks && <p className="mt-1 text-xs text-muted">{r.remarks}</p>}</> },
    { key: 'ref', header: 'Record', cell: (r) => <span className="font-mono text-xs">{r.record_no}</span> },
  ]
  const t = totals.data
  return (
    <div>
      <PageHeader title="My CPD Records" description="CPD units recorded by this portal from verified participation. This is not your complete PRC CPD balance, and credit is subject to PRC and Professional Regulatory Board approval." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Approved units (recorded by this portal)" value={Number(t?.approved_units ?? 0)} tone="neutral" />
        <StatCard label="Units pending review" value={Number(t?.pending_units ?? 0)} />
        <StatCard label="Qualifying service days" value={Number(t?.qualifying_days ?? 0)} />
      </div>
      <DataTable<CpdRow> queryKey={['my-cpd']} rowKey={(r) => r.id} columns={cols} hideSearch defaultSort={{ column: 'service_date', asc: false }}
        fetchPage={(p) => runPage(applyPage(supabase.from('cpd_record_view').select('*', { count: 'exact' }).eq('volunteer_id', vol?.id ?? ''), p, []))}
        emptyTitle="No CPD records yet" emptyHint="Records appear after your attendance as a registered professional is verified." />
    </div>
  )
}
