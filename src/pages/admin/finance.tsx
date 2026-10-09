import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/auth/AuthProvider'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { FilterSelect, TextArea, TextInput } from '@/components/ui/form'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { Alert, Badge, Button, Card, DescriptionList, ErrorState, PageHeader, Spinner, StatCard, StatusBadge } from '@/components/ui/ui'
import { DecisionModal } from '@/components/DecisionModal'
import { fmtDate, peso, titleCase } from '@/lib/format'
import { applyPage, runPage } from '@/lib/query'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { AllowanceRow, ExamEvent, PaymentRow } from '@/types/db'
import { usePositions } from './events'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Alw = AllowanceRow & { volunteer_id: string | null; external_id: string | null }
const PROC = ['not_evaluated', 'for_validation', 'requirements_incomplete', 'for_approval', 'approved', 'disapproved', 'for_processing', 'ready_for_payment']
const PAY = ['not_yet_paid', 'processing', 'paid', 'partially_paid', 'on_hold', 'returned_failed', 'cancelled']

function useEvents() {
  return useQuery({ queryKey: ['events-pick-all'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').neq('status', 'draft').order('created_at', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
}

export function AllowanceMonitoring() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const events = useEvents()
  const [eventId, setEventId] = useState('')
  const dash = useQuery({ queryKey: ['allowance-dash', eventId], queryFn: async () => unwrap(await supabase.rpc('allowance_dashboard', { p_event: eventId || null })) as any })
  const regen = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('generate_allowances', { p_event: eventId })) as number,
    onSuccess: (n) => { toast.success(`Re-evaluated ${n} verified attendance record(s)`); qc.invalidateQueries() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const d = dash.data
  return (
    <div className="space-y-4">
      <PageHeader title="Allowance Monitoring" description="Tracking and administrative control only. This portal does not disburse funds." actions={can('allowance.process') ? <Button variant="secondary" disabled={!eventId} loading={regen.isPending} onClick={() => regen.mutate()} title={eventId ? '' : 'Select an examination first'}>Re-evaluate eligibility for selected exam</Button> : undefined} />
      <Card><FilterSelect label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)} className="min-w-64"><option value="">All examinations</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect></Card>
      {dash.isLoading ? <Spinner /> : dash.isError ? <ErrorState error={dash.error} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Eligible personnel" value={d.eligible_personnel} /><StatCard label="Pending validation" value={d.pending_validation} /><StatCard label="Awaiting approval" value={d.awaiting_approval} />
            <StatCard label="Approved amount" value={peso(d.approved_amount)} /><StatCard label="Being processed" value={peso(d.processing_amount)} /><StatCard label="Total paid" value={peso(d.total_paid)} />
            <StatCard label="Outstanding balance" value={peso(d.outstanding)} tone={Number(d.outstanding) > 0 ? 'warning' : 'neutral'} />
            <StatCard label="On hold / returned" value={`${d.on_hold} / ${d.returned}`} tone={d.on_hold + d.returned ? 'danger' : 'neutral'} />
            <StatCard label="Missing TIN / bank / rule" value={d.missing_requirements} tone={d.missing_requirements ? 'warning' : 'neutral'} />
            <StatCard label="Flagged for review" value={d.needs_review} tone={d.needs_review ? 'danger' : 'neutral'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[['By position — approved vs. paid', d.by_position], ['By personnel category — approved vs. paid', d.by_category.map((x: any) => ({ ...x, label: titleCase(x.label) }))]].map(([title, data]: any) => (
              <Card key={title} title={title}>
                {data.length === 0 ? <p className="text-sm text-muted">No allowance records yet.</p> : (
                  <div className="h-56" role="img" aria-label={title}><ResponsiveContainer><BarChart data={data} margin={{ left: 0, right: 10 }}><CartesianGrid vertical={false} stroke="#e5e9f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v: any) => peso(v)} /><Legend />
                    <Bar dataKey="approved" name="Approved" fill="#5b8fd1" /><Bar dataKey="paid" name="Paid" fill="#0b2a5b" /></BarChart></ResponsiveContainer></div>)}
              </Card>))}
          </div>
        </>)}
      <AllowanceTable eventId={eventId} />
    </div>
  )
}

export function AllowanceProcessing() {
  return (<div className="space-y-4"><PageHeader title="Allowance Approval and Processing" description="Validate requirements, route for approval (the approver must differ from the processing officer), then prepare for payment." /><AllowanceTable eventId="" openOnly /></div>)
}

function AllowanceTable({ eventId, openOnly }: { eventId: string; openOnly?: boolean }) {
  const positions = usePositions()
  const [proc, setProc] = useState('')
  const [pay, setPay] = useState('')
  const [cat, setCat] = useState('')
  const [pos, setPos] = useState('')
  const [open, setOpen] = useState<Alw | null>(null)
  const cols: Col<Alw>[] = [
    { key: 'no', header: 'Record', sort: 'record_no', cell: (r) => <span className="font-mono text-xs">{r.record_no}</span> },
    { key: 'n', header: 'Payee', sort: 'payee_name', cell: (r) => <span className="font-medium">{r.payee_name}</span> },
    { key: 'e', header: 'Examination', cell: (r) => r.event_name },
    { key: 'p', header: 'Position', cell: (r) => r.position_name },
    { key: 'd', header: 'Duty date', sort: 'duty_date', cell: (r) => fmtDate(r.duty_date) },
    { key: 'a', header: 'Approved', sort: 'approved_amount', cell: (r) => peso(r.approved_amount) },
    { key: 'pd', header: 'Paid', cell: (r) => peso(r.total_paid) },
    { key: 'b', header: 'Balance', cell: (r) => peso(r.balance) },
    { key: 'el', header: 'Eligibility', cell: (r) => <StatusBadge status={r.eligibility_status} /> },
    { key: 'ps', header: 'Processing', sort: 'processing_status', cell: (r) => <><StatusBadge status={r.processing_status} />{r.needs_review && <Badge tone="danger">Review</Badge>}</> },
    { key: 'pm', header: 'Payment', sort: 'payment_status', cell: (r) => <StatusBadge status={r.payment_status} /> },
  ]
  return (
    <>
      <DataTable<Alw> queryKey={['allowances', eventId, proc, pay, cat, pos, openOnly]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'duty_date', asc: false }} onRowClick={setOpen} searchPlaceholder="Search payee or record no.…"
        filters={<>
          <FilterSelect label="Processing" value={proc} onChange={(e) => setProc(e.target.value)}><option value="">All</option>{PROC.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</FilterSelect>
          <FilterSelect label="Payment" value={pay} onChange={(e) => setPay(e.target.value)}><option value="">All</option>{PAY.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</FilterSelect>
          <FilterSelect label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{['volunteer', 'pnp', 'other_external', 'prc_staff'].map((s) => <option key={s} value={s}>{s}</option>)}</FilterSelect>
          <FilterSelect label="Position" value={pos} onChange={(e) => setPos(e.target.value)}><option value="">All</option>{positions.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</FilterSelect></>}
        fetchPage={(p) => { let q = supabase.from('allowance_summary').select('*', { count: 'exact' }); if (eventId) q = q.eq('event_id', eventId); if (proc) q = q.eq('processing_status', proc); if (pay) q = q.eq('payment_status', pay); if (cat) q = q.eq('personnel_category', cat); if (pos) q = q.eq('position_id', pos)
          if (openOnly && !proc && !pay) q = q.in('processing_status', ['for_validation', 'requirements_incomplete', 'for_approval', 'approved', 'for_processing', 'ready_for_payment']).not('payment_status', 'in', '(paid,cancelled)')
          return runPage(applyPage(q, p, ['payee_name', 'record_no'])) }}
        exportAs={{ name: 'allowances', columns: [{ header: 'Record', value: (r) => r.record_no }, { header: 'Payee', value: (r) => r.payee_name }, { header: 'Examination', value: (r) => r.event_name }, { header: 'Position', value: (r) => r.position_name }, { header: 'Duty date', value: (r) => r.duty_date },
          { header: 'Approved amount', value: (r) => r.approved_amount }, { header: 'Total paid', value: (r) => r.total_paid }, { header: 'Balance', value: (r) => r.balance }, { header: 'Processing', value: (r) => r.processing_status }, { header: 'Payment', value: (r) => r.payment_status }, { header: 'Payment date', value: (r) => r.payment_date }, { header: 'Payment reference', value: (r) => r.payment_reference }] }} />
      {open && <AllowanceDialog id={open.id} onClose={() => setOpen(null)} />}
    </>
  )
}

function AllowanceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [dlg, setDlg] = useState<null | 'disapprove' | 'hold' | 'adjust' | 'pay' | 'return' | 'bank' | 'reveal'>(null)
  const [returning, setReturning] = useState<PaymentRow | null>(null)
  const a = useQuery({ queryKey: ['allowance', id], queryFn: async () => unwrap(await supabase.from('allowance_summary').select('*').eq('id', id).single()) as Alw })
  const pays = useQuery({ queryKey: ['allowance-pays', id], queryFn: async () => unwrap(await supabase.from('allowance_payments').select('*').eq('allowance_id', id).order('created_at')) as PaymentRow[] })
  const fin = useQuery({ queryKey: ['allowance-fin', a.data?.volunteer_id], enabled: !!a.data?.volunteer_id && can('financial.view_masked'), queryFn: async () => unwrap(await supabase.rpc('get_financial_masked', { p_volunteer: a.data!.volunteer_id })) as any })
  const [revealed, setRevealed] = useState<any>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['allowance', id] }); qc.invalidateQueries({ queryKey: ['allowance-pays', id] }); qc.invalidateQueries({ queryKey: ['allowances'] }); qc.invalidateQueries({ queryKey: ['allowance-dash'] }); qc.invalidateQueries({ queryKey: ['allowance-fin'] }) }
  const proc = useMutation({
    mutationFn: async (v: { status: string; reason?: string }) => { unwrap(await supabase.rpc('set_allowance_processing', { p_id: id, p_status: v.status, p_reason: v.reason ?? null })) },
    onSuccess: () => { toast.success('Updated'); refresh() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const payStatus = useMutation({
    mutationFn: async (v: { status: string; reason?: string }) => { unwrap(await supabase.rpc('set_allowance_payment_status', { p_id: id, p_status: v.status, p_reason: v.reason ?? null })) },
    onSuccess: () => { toast.success('Updated'); refresh() }, onError: (e) => toast.error(errorMessage(e)),
  })
  if (a.isLoading) return <Modal open title="Allowance" onClose={onClose}><Spinner /></Modal>
  if (a.isError) return <Modal open title="Allowance" onClose={onClose}><ErrorState error={a.error} /></Modal>
  const r = a.data!
  const P = r.processing_status
  const canProc = can('allowance.process'); const canAppr = can('allowance.approve'); const canPay = can('payments.record')
  const btn = (label: string, onClick: () => void, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => <Button key={label} size="sm" variant={variant} onClick={onClick} loading={proc.isPending || payStatus.isPending}>{label}</Button>
  return (
    <Modal open wide title={`${r.record_no} — ${r.payee_name}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4 text-sm">
        {r.needs_review && <Alert tone="danger" title="Flagged for review">{r.review_note ?? 'Linked attendance was corrected.'} Re-validate before further processing.</Alert>}
        {r.requirements_note && <Alert tone="warning" title="Requirements">{r.requirements_note}</Alert>}
        <DescriptionList items={[['Examination', r.event_name], ['Position', r.position_name], ['Duty date', fmtDate(r.duty_date)], ['Category', titleCase(r.personnel_category)],
          ['Approved amount', `${peso(r.approved_amount)}${r.rule_version ? ` (rule v${r.rule_version})` : ''}`], ['Total paid / balance', `${peso(r.total_paid)} / ${peso(r.balance)}`],
          ['Eligibility', <StatusBadge key="e" status={r.eligibility_status} />], ['Processing', <StatusBadge key="p" status={P} />], ['Payment', <StatusBadge key="y" status={r.payment_status} />], ['Last payment', r.payment_date ? `${fmtDate(r.payment_date)} · ${r.payment_reference}` : '—']]} />

        {fin.data && (
          <div className="rounded-md border border-line p-3">
            <p className="mb-2 text-xs font-medium uppercase text-muted">Payee bank details (masked)</p>
            <div className="flex flex-wrap items-center gap-4"><span>TIN: <span className="font-mono">{fin.data.has_tin ? fin.data.tin_masked : 'missing'}</span></span><span>Account: <span className="font-mono">{fin.data.has_account ? fin.data.account_masked : 'missing'}</span></span><StatusBadge status={fin.data.bank_verification_status} />
              {can('financial.view_sensitive') && <Button size="sm" variant="ghost" onClick={() => setDlg('reveal')}>View full details…</Button>}
              {canProc && fin.data.has_account && <Button size="sm" variant="ghost" onClick={() => setDlg('bank')}>Verify bank account…</Button>}</div>
            {revealed && <p className="mt-2 rounded bg-amber-50 p-2 font-mono text-xs">TIN {revealed.tin ?? '—'} · Account {revealed.bank_account_no ?? '—'} · Holder {revealed.account_holder ?? '—'} <button className="ml-2 underline" onClick={() => setRevealed(null)}>hide</button></p>}
          </div>)}

        <div>
          <p className="mb-2 text-xs font-medium uppercase text-muted">Workflow</p>
          <div className="flex flex-wrap gap-2">
            {canProc && P === 'for_validation' && r.eligibility_status === 'eligible' && btn('Send for approval', () => proc.mutate({ status: 'for_approval' }), 'primary')}
            {canAppr && P === 'for_approval' && <>{btn('Approve', () => proc.mutate({ status: 'approved' }), 'primary')}{btn('Disapprove…', () => setDlg('disapprove'), 'danger')}{btn('Return for validation', () => proc.mutate({ status: 'for_validation' }))}</>}
            {canProc && P === 'disapproved' && btn('Re-open for validation', () => proc.mutate({ status: 'for_validation' }))}
            {canProc && P === 'approved' && btn('Mark for processing', () => proc.mutate({ status: 'for_processing' }), 'primary')}
            {canProc && P === 'for_processing' && btn('Ready for payment', () => proc.mutate({ status: 'ready_for_payment' }), 'primary')}
            {canPay && P === 'ready_for_payment' && !['on_hold', 'cancelled', 'paid'].includes(r.payment_status) && btn('Record payment…', () => setDlg('pay'), 'primary')}
            {(canProc || canAppr) && ['not_yet_paid', 'processing', 'partially_paid', 'returned_failed'].includes(r.payment_status) && P !== 'not_evaluated' && btn('Place payment on hold…', () => setDlg('hold'), 'danger')}
            {(canProc || canAppr) && r.payment_status === 'on_hold' && btn('Release hold', () => payStatus.mutate({ status: 'not_yet_paid' }))}
            {canPay && ['not_yet_paid', 'returned_failed', 'on_hold'].includes(r.payment_status) && P === 'ready_for_payment' && btn('Mark payment as processing', () => payStatus.mutate({ status: 'processing' }))}
            {canAppr && ['not_yet_paid', 'processing', 'on_hold', 'returned_failed'].includes(r.payment_status) && btn('Cancel payment…', () => setDlg('return'), 'danger')}
            {canAppr && ['approved', 'for_processing', 'ready_for_payment'].includes(P) && btn('Adjust amount…', () => setDlg('adjust'))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase text-muted">Payment transactions</p>
          {pays.data?.length === 0 ? <p className="text-muted">No payments recorded.</p> : (
            <table className="w-full text-left"><thead className="text-xs uppercase text-muted"><tr>{['Date', 'Reference', 'Batch / voucher', 'Amount', 'Status', ''].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{pays.data?.map((p) => <tr key={p.id}><td className="py-1.5 pr-3">{fmtDate(p.paid_on)}</td><td className="py-1.5 pr-3 font-mono text-xs">{p.reference_no}</td><td className="py-1.5 pr-3">{p.batch_ref}</td><td className="py-1.5 pr-3">{peso(p.amount)}{p.exception_reason && <Badge tone="warning">exception</Badge>}</td>
                <td className="py-1.5 pr-3"><StatusBadge status={p.status} />{p.return_reason && <span className="ml-1 text-xs text-muted">{p.return_reason}</span>}</td><td>{canPay && p.status === 'paid' && <Button size="sm" variant="ghost" onClick={() => setReturning(p)}>Mark returned…</Button>}</td></tr>)}</tbody></table>)}
        </div>
      </div>

      {dlg === 'disapprove' && <DecisionModal title="Disapprove allowance" onClose={() => setDlg(null)} options={[{ value: 'disapproved', label: 'Disapproved', reasonRequired: true }]} onSubmit={async (_d, reason) => proc.mutateAsync({ status: 'disapproved', reason })} />}
      {dlg === 'hold' && <DecisionModal title="Place payment on hold" onClose={() => setDlg(null)} options={[{ value: 'on_hold', label: 'On hold', reasonRequired: true }]} onSubmit={async (_d, reason) => payStatus.mutateAsync({ status: 'on_hold', reason })} />}
      {dlg === 'return' && <DecisionModal title="Cancel payment" onClose={() => setDlg(null)} options={[{ value: 'cancelled', label: 'Cancel this payment obligation', reasonRequired: true }]} onSubmit={async (_d, reason) => payStatus.mutateAsync({ status: 'cancelled', reason })} />}
      {dlg === 'adjust' && <AdjustDialog a={r} onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg === 'pay' && <PayDialog a={r} canExcept={canAppr} onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg === 'bank' && a.data?.volunteer_id && <DecisionModal title="Verify bank account" onClose={() => setDlg(null)} options={[{ value: 'verified', label: 'Verified (matches supporting document)' }, { value: 'rejected', label: 'Rejected', reasonRequired: true }]}
        onSubmit={async (d, reason) => { unwrap(await supabase.rpc('set_bank_verification', { p_volunteer: a.data!.volunteer_id, p_status: d, p_remarks: reason || null })); toast.success('Bank verification recorded'); refresh() }} />}
      {dlg === 'reveal' && a.data?.volunteer_id && <RevealDialog volunteer={a.data.volunteer_id} onClose={() => setDlg(null)} onReveal={(v) => setRevealed(v)} />}
      {returning && <DecisionModal title={`Mark ${returning.reference_no} as returned / failed`} onClose={() => setReturning(null)} options={[{ value: 'returned', label: 'Returned / failed', reasonRequired: true }]}
        onSubmit={async (_d, reason) => { const { error } = await supabase.from('allowance_payments').update({ status: 'returned', return_reason: reason }).eq('id', returning.id); if (error) throw new Error(error.message); toast.success('Payment marked as returned'); refresh() }} />}
    </Modal>
  )
}

function RevealDialog({ volunteer, onClose, onReveal }: { volunteer: string; onClose: () => void; onReveal: (v: any) => void }) {
  return (
    <DecisionModal title="View full financial details" onClose={onClose} options={[{ value: 'view', label: 'Reveal TIN and account number', reasonRequired: true }]}
      onSubmit={async (_d, purpose) => { onReveal(unwrap(await supabase.rpc('get_financial_full', { p_volunteer: volunteer, p_purpose: purpose }))) }}>
      <Alert tone="warning">This access is logged with your name and purpose. Do not copy these values into spreadsheets, chats or email.</Alert>
    </DecisionModal>
  )
}

function AdjustDialog({ a, onClose, onDone }: { a: Alw; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(a.approved_amount ?? ''))
  return (
    <DecisionModal title="Adjust approved amount" onClose={onClose} options={[{ value: 'adjust', label: 'Adjust amount', reasonRequired: true }]}
      onSubmit={async (_d, reason) => { unwrap(await supabase.rpc('adjust_allowance_amount', { p_id: a.id, p_amount: Number(amount), p_reason: reason })); toast.success('Amount adjusted and logged'); onDone() }}>
      <TextInput label="New approved amount (PHP)" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Currently ${peso(a.approved_amount)}; already paid ${peso(a.total_paid)}`} />
    </DecisionModal>
  )
}

function PayDialog({ a, canExcept, onClose, onDone }: { a: Alw; canExcept: boolean; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ amount: String(Math.max(Number(a.balance), 0)), paid_on: new Date().toISOString().slice(0, 10), reference_no: '', batch_ref: '', remarks: '', exception_reason: '' })
  const over = Number(v.amount) > Number(a.balance) + 0.0001
  const go = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('allowance_payments').insert({ allowance_id: a.id, amount: Number(v.amount), paid_on: v.paid_on, reference_no: v.reference_no.trim(), batch_ref: v.batch_ref || null, remarks: v.remarks || null, exception_reason: over ? v.exception_reason || null : null })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => { toast.success('Payment recorded'); onDone(); onClose() }, onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Modal open title="Record payment" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={go.isPending} disabled={!v.reference_no.trim() || !(Number(v.amount) > 0)} onClick={() => go.mutate()}>Record payment</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Amount (PHP)" type="number" step="0.01" min={0.01} required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} hint={`Balance ${peso(a.balance)}. Partial payments are allowed.`} />
        <TextInput label="Payment date" type="date" required value={v.paid_on} onChange={(e) => setV({ ...v, paid_on: e.target.value })} />
        <TextInput label="Payment reference no." required value={v.reference_no} onChange={(e) => setV({ ...v, reference_no: e.target.value })} />
        <TextInput label="Batch / voucher reference" value={v.batch_ref} onChange={(e) => setV({ ...v, batch_ref: e.target.value })} />
        <TextArea label="Remarks" wrapperClassName="sm:col-span-2" value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
        {over && (canExcept ? <TextArea label="Authorised exception reason (required: amount exceeds balance)" wrapperClassName="sm:col-span-2" value={v.exception_reason} onChange={(e) => setV({ ...v, exception_reason: e.target.value })} required /> : <div className="sm:col-span-2"><Alert tone="danger">This amount exceeds the remaining balance. Only an approving officer can record an authorised exception.</Alert></div>)}
      </div>
    </Modal>
  )
}

export function PaymentTransactions() {
  const events = useEvents()
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  type P = PaymentRow & { allowance_records: { record_no: string; payee_name: string; event_id: string } }
  const cols: Col<P>[] = [
    { key: 'd', header: 'Paid on', sort: 'paid_on', cell: (r) => fmtDate(r.paid_on) },
    { key: 'rf', header: 'Reference', sort: 'reference_no', cell: (r) => <span className="font-mono text-xs">{r.reference_no}</span> },
    { key: 'b', header: 'Batch / voucher', cell: (r) => r.batch_ref },
    { key: 'p', header: 'Payee', cell: (r) => r.allowance_records.payee_name },
    { key: 'a', header: 'Allowance', cell: (r) => <button className="font-mono text-xs text-navy-800 underline" onClick={(e) => { e.stopPropagation(); setOpen(r.allowance_id) }}>{r.allowance_records.record_no}</button> },
    { key: 'am', header: 'Amount', sort: 'amount', cell: (r) => peso(r.amount) },
    { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'x', header: 'Notes', cell: (r) => r.return_reason ?? r.exception_reason ?? r.remarks },
  ]
  const [eventId, setEventId] = useState('')
  return (
    <div>
      <PageHeader title="Payment Transactions" description="Every recorded payment against an allowance obligation. Recorded payments are immutable; a return needs a reason." />
      <DataTable<P> queryKey={['payments', status, eventId]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'paid_on', asc: false }} searchPlaceholder="Search reference…"
        filters={<><FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="paid">Paid</option><option value="returned">Returned</option></FilterSelect>
          <FilterSelect label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">All</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect></>}
        fetchPage={(p) => { let q = supabase.from('allowance_payments').select(`*, allowance_records!inner(record_no,payee_name,event_id)`, { count: 'exact' }); if (status) q = q.eq('status', status); if (eventId) q = q.eq('allowance_records.event_id', eventId); return runPage(applyPage(q, p, ['reference_no', 'batch_ref'])) }}
        exportAs={{ name: 'payments', columns: [{ header: 'Paid on', value: (r) => r.paid_on }, { header: 'Reference', value: (r) => r.reference_no }, { header: 'Batch / voucher', value: (r) => r.batch_ref }, { header: 'Payee', value: (r) => r.allowance_records.payee_name }, { header: 'Allowance', value: (r) => r.allowance_records.record_no }, { header: 'Amount', value: (r) => r.amount }, { header: 'Status', value: (r) => r.status }] }} />
      {open && <AllowanceDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
