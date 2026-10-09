import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { activeBadge, CrudCard, yesNo, type FieldDef } from '@/components/CrudCard'
import { DecisionModal } from '@/components/DecisionModal'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { Checkbox, FilterSelect, SelectInput, TextArea, TextInput } from '@/components/ui/form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { toast } from '@/components/ui/Toast'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '@/components/ui/ui'
import { downloadCsv, type Column } from '@/lib/csv'
import { downloadXlsx } from '@/lib/xlsx'
import { fmtDate, fmtDateTime, peso } from '@/lib/format'
import { ROLE_LABEL } from '@/lib/labels'
import { applyPage, runPage } from '@/lib/query'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { ExamEvent, Position } from '@/types/db'
import { usePositions } from './events'

/* eslint-disable @typescript-eslint/no-explicit-any */
function useEvents() {
  return useQuery({ queryKey: ['events-pick-all'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').neq('status', 'draft').order('created_at', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
}

// ------------------------------------------------------------------ reports
interface ReportDef { id: string; label: string; perm: string; table: string; select: string; eventCol?: string; order: string; columns: Column<any>[]; note?: string }
const REPORTS: ReportDef[] = [
  { id: 'roster', label: 'Personnel roster', perm: 'assignments.view', table: 'assignment_roster', select: '*', eventCol: 'event_id', order: 'exam_date',
    columns: [{ header: 'Examination', value: (r) => r.event_name }, { header: 'Date', value: (r) => r.exam_date }, { header: 'Assignment no.', value: (r) => r.assignment_no }, { header: 'Name', value: (r) => r.person_name }, { header: 'Category', value: (r) => r.personnel_category }, { header: 'Position', value: (r) => r.position_name }, { header: 'Center', value: (r) => r.center_name }, { header: 'Building', value: (r) => r.building_name }, { header: 'Floor', value: (r) => r.floor_label }, { header: 'Room', value: (r) => r.room_name }, { header: 'Status', value: (r) => r.status }] },
  { id: 'attendance', label: 'Attendance report', perm: 'attendance.view', table: 'attendance_records', select: '*, assignments(person_name,person_no,assignment_positions(name)), examination_dates(exam_date)', eventCol: 'event_id', order: 'created_at',
    columns: [{ header: 'Date', value: (r) => r.examination_dates?.exam_date }, { header: 'Name', value: (r) => r.assignments?.person_name }, { header: 'Position', value: (r) => r.assignments?.assignment_positions?.name }, { header: 'Check-in', value: (r) => r.check_in_at }, { header: 'Check-out', value: (r) => r.check_out_at }, { header: 'Status', value: (r) => r.status }, { header: 'Verification', value: (r) => r.verification_status }, { header: 'Remarks', value: (r) => r.remarks }] },
  { id: 'allowance', label: 'Allowance monitoring / reconciliation', perm: 'allowance.view', table: 'allowance_summary', select: '*', eventCol: 'event_id', order: 'duty_date', note: 'Contains payment status only. TIN and bank account numbers are never included in exports.',
    columns: [{ header: 'Record', value: (r) => r.record_no }, { header: 'Payee', value: (r) => r.payee_name }, { header: 'Examination', value: (r) => r.event_name }, { header: 'Position', value: (r) => r.position_name }, { header: 'Duty date', value: (r) => r.duty_date }, { header: 'Approved amount', value: (r) => r.approved_amount }, { header: 'Total paid', value: (r) => r.total_paid }, { header: 'Balance', value: (r) => r.balance }, { header: 'Processing', value: (r) => r.processing_status }, { header: 'Payment', value: (r) => r.payment_status }, { header: 'Payment date', value: (r) => r.payment_date }, { header: 'Reference', value: (r) => r.payment_reference }] },
  { id: 'cpd', label: 'CPD participation summary', perm: 'cpd.view', table: 'cpd_record_view', select: '*', eventCol: 'event_id', order: 'service_date', note: 'Units recorded by this portal only; not the professional’s complete PRC CPD balance.',
    columns: [{ header: 'Record', value: (r) => r.record_no }, { header: 'Professional', value: (r) => r.volunteer_name }, { header: 'License', value: (r) => r.license_ref }, { header: 'Profession', value: (r) => r.profession_name }, { header: 'Examination', value: (r) => r.event_name }, { header: 'Service date', value: (r) => r.service_date }, { header: 'Proposed', value: (r) => r.units_proposed }, { header: 'Approved', value: (r) => r.units_approved }, { header: 'Rule version', value: (r) => r.rule_version }, { header: 'Status', value: (r) => r.status }] },
  { id: 'volunteers', label: 'Volunteer list (non-sensitive fields)', perm: 'volunteers.view', table: 'volunteer_profiles', select: '*, profiles(email,account_status)', order: 'last_name',
    columns: [{ header: 'Volunteer ID', value: (r) => r.volunteer_no }, { header: 'Last name', value: (r) => r.last_name }, { header: 'First name', value: (r) => r.first_name }, { header: 'City / municipality', value: (r) => r.city_municipality }, { header: 'Province', value: (r) => r.province }, { header: 'Registered professional', value: (r) => r.is_registered_professional }, { header: 'Account', value: (r) => r.profiles?.account_status }, { header: 'Profile verification', value: (r) => r.verification_status }] },
]

export function Reports() {
  const { can } = useAuth()
  const events = useEvents()
  const available = REPORTS.filter((r) => can(r.perm))
  const [id, setId] = useState(available[0]?.id ?? '')
  const [eventId, setEventId] = useState('')
  const def = REPORTS.find((r) => r.id === id)
  const q = useQuery({
    queryKey: ['report', id, eventId], enabled: !!def,
    queryFn: async () => { let b = supabase.from(def!.table).select(def!.select).order(def!.order).limit(5000); if (eventId && def!.eventCol) b = b.eq(def!.eventCol, eventId); return unwrap(await b) as unknown as any[] },
  })
  const doExport = async (kind: 'csv' | 'xlsx') => {
    try {
      const { error } = await supabase.rpc('log_export', { p_report: def!.id, p_filters: { event_id: eventId || null, rows: q.data?.length } })
      if (error) throw new Error(error.message)
      if (kind === 'csv') downloadCsv(q.data!, def!.columns, def!.id); else await downloadXlsx(q.data!, def!.columns, def!.id)
      toast.success('Export recorded in the audit log')
    } catch (e) { toast.error(errorMessage(e)) }
  }
  if (!def) return <EmptyState title="No reports are available for your role" />
  return (
    <div className="space-y-4">
      <PageHeader title="Reports and Exports" description="Filter, preview, print or export. Exports are limited to the fields your role may see and are recorded in the audit log." />
      <Card><div className="flex flex-wrap items-end gap-3">
        <FilterSelect label="Report" value={id} onChange={(e) => setId(e.target.value)} className="min-w-64">{available.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</FilterSelect>
        {def.eventCol && <FilterSelect label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">All</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect>}
        <div className="ml-auto flex gap-2 no-print"><Button variant="secondary" onClick={() => window.print()}>Print</Button>
          {can('reports.export') && <><Button variant="secondary" disabled={!q.data?.length} onClick={() => doExport('csv')}>Export CSV</Button><Button variant="secondary" disabled={!q.data?.length} onClick={() => doExport('xlsx')}>Export Excel</Button></>}</div></div>
        {def.note && <p className="mt-3 text-xs text-muted">{def.note}</p>}
      </Card>
      <Card title={`${def.label} — ${q.data?.length ?? 0} row(s)`} padded={false}>
        {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} /></div> : q.data?.length === 0 ? <EmptyState title="No data for this selection" /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-muted"><tr>{def.columns.map((c) => <th key={c.header} className="px-3 py-2 font-medium">{c.header}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{q.data?.slice(0, 200).map((r, i) => <tr key={i}>{def.columns.map((c) => <td key={c.header} className="px-3 py-1.5">{String(c.value(r) ?? '')}</td>)}</tr>)}</tbody></table>
            {(q.data?.length ?? 0) > 200 && <p className="p-3 text-xs text-muted">Preview shows the first 200 rows; exports include all {q.data?.length}.</p>}</div>)}
      </Card>
    </div>
  )
}

// ------------------------------------------------------------------ announcements
export function Announcements() {
  const events = useEvents()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [aud, setAud] = useState('all_volunteers')
  const [eventId, setEventId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const send = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('send_announcement', { p_title: title, p_body: body, p_audience: aud, p_event: aud === 'event_volunteers' ? eventId : null })) as number,
    onSuccess: (n) => { toast.success(`Posted to ${n} volunteer notification inbox(es)`); setTitle(''); setBody('') }, onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="space-y-4">
      <PageHeader title="Notifications and Announcements" description="Announcements appear in volunteers’ in-app notification centers. Email is not sent by this portal (see docs/EMAIL.md)." />
      <Card title="New announcement">
        <div className="grid max-w-2xl gap-4">
          <TextInput label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextArea label="Message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          <SelectInput label="Audience" value={aud} onChange={(e) => setAud(e.target.value)}><option value="all_volunteers">All active volunteers</option><option value="event_volunteers">Volunteers who applied or are assigned to an examination</option></SelectInput>
          {aud === 'event_volunteers' && <SelectInput label="Examination" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Select…</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</SelectInput>}
          <div><Button disabled={!title.trim() || (aud === 'event_volunteers' && !eventId)} onClick={() => setConfirm(true)}>Send announcement</Button></div>
        </div>
      </Card>
      <ConfirmDialog open={confirm} title="Send announcement" confirmLabel="Send" message="This posts the message to the selected volunteers’ notification centers. It cannot be recalled." onClose={() => setConfirm(false)} onConfirm={() => send.mutateAsync()} />
    </div>
  )
}

// ------------------------------------------------------------------ users & roles
interface UserRow { id: string; email: string; account_status: string; created_at: string; last_login_at: string | null; roles: string[] }
export function UsersPage() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const [open, setOpen] = useState<UserRow | null>(null)
  const [dlg, setDlg] = useState<null | { role: string; grant: boolean }>(null)
  const [statusDlg, setStatusDlg] = useState(false)
  const cols: Col<UserRow>[] = [
    { key: 'e', header: 'Email', sort: 'email', cell: (r) => <span className="font-medium">{r.email}</span> },
    { key: 'r', header: 'Roles', cell: (r) => <div className="flex flex-wrap gap-1">{r.roles.map((x) => <Badge key={x} tone={x === 'volunteer' ? 'neutral' : 'brand'}>{ROLE_LABEL[x] ?? x}</Badge>)}</div> },
    { key: 's', header: 'Account', sort: 'account_status', cell: (r) => <StatusBadge status={r.account_status} /> },
    { key: 'l', header: 'Last sign-in', sort: 'last_login_at', cell: (r) => fmtDateTime(r.last_login_at) },
    { key: 'c', header: 'Created', sort: 'created_at', cell: (r) => fmtDate(r.created_at) },
  ]
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); setOpen(null) }
  const live = open
  return (
    <div>
      <PageHeader title="User and Role Management" description="Roles are assigned here only — never at registration. You cannot change your own roles. Every change is audited." />
      <Alert tone="info">To create the first administrator, follow docs/ADMIN_SETUP.md (a one-time SQL step run by the project owner).</Alert>
      <div className="mt-4"><DataTable<UserRow> queryKey={['users']} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'email', asc: true }} onRowClick={setOpen} searchPlaceholder="Search email…"
        fetchPage={(p) => runPage(applyPage(supabase.from('user_directory').select('*', { count: 'exact' }), p, ['email']))} /></div>
      {live && (
        <Modal open title={live.email} onClose={() => setOpen(null)} footer={<Button onClick={() => setOpen(null)}>Close</Button>}>
          <div className="space-y-4 text-sm">
            {live.id === session?.user.id && <Alert tone="warning">This is your own account. Role and status changes are blocked.</Alert>}
            <div><p className="mb-2 text-xs font-medium uppercase text-muted">Roles</p>
              <div className="space-y-2">{Object.entries(ROLE_LABEL).filter(([k]) => k !== 'volunteer').map(([k, label]) => {
                const has = live.roles.includes(k)
                return <div key={k} className="flex items-center justify-between rounded border border-line p-2"><span>{label}</span>{has ? <Button size="sm" variant="danger" disabled={live.id === session?.user.id} onClick={() => setDlg({ role: k, grant: false })}>Revoke…</Button> : <Button size="sm" variant="secondary" disabled={live.id === session?.user.id} onClick={() => setDlg({ role: k, grant: true })}>Grant…</Button>}</div>
              })}</div></div>
            <div className="flex items-center justify-between"><span>Account status: <StatusBadge status={live.account_status} /></span><Button size="sm" variant="secondary" disabled={live.id === session?.user.id} onClick={() => setStatusDlg(true)}>Change status…</Button></div>
          </div>
        </Modal>)}
      {dlg && live && <DecisionModal title={`${dlg.grant ? 'Grant' : 'Revoke'} ${ROLE_LABEL[dlg.role]}`} onClose={() => setDlg(null)} options={[{ value: 'go', label: dlg.grant ? 'Grant role' : 'Revoke role', reasonRequired: true }]}
        onSubmit={async (_d, reason) => { unwrap(await supabase.rpc(dlg.grant ? 'grant_role' : 'revoke_role', { p_user: live.id, p_role: dlg.role, p_reason: reason })); toast.success('Role updated'); refresh() }} />}
      {statusDlg && live && <DecisionModal title="Change account status" onClose={() => setStatusDlg(false)} options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended', reasonRequired: true }, { value: 'rejected', label: 'Rejected', reasonRequired: true }, { value: 'pending', label: 'Pending' }]}
        onSubmit={async (d, reason) => { unwrap(await supabase.rpc('set_account_status', { p_user: live.id, p_status: d, p_reason: reason || null })); toast.success('Status updated'); refresh() }} />}
    </div>
  )
}

// ------------------------------------------------------------------ audit logs
interface AuditRow { id: string; created_at: string; actor_id: string | null; actor_email?: string; action: string; record_type: string; record_id: string | null; before_values: any; after_values: any; reason: string | null }
const TABLES = ['profiles', 'user_roles', 'system_settings', 'volunteer_profiles', 'professional_credentials', 'volunteer_documents', 'volunteer_financial', 'examination_events', 'staffing_requirements', 'assignments', 'attendance_records', 'attendance_adjustments', 'allowance_rules', 'allowance_records', 'allowance_payments', 'cpd_rules', 'cpd_records', 'external_personnel', 'import_batches', 'report', 'notifications']
export function AuditLogs() {
  const [type, setType] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<AuditRow | null>(null)
  const cols: Col<AuditRow>[] = [
    { key: 't', header: 'Time', sort: 'created_at', cell: (r) => fmtDateTime(r.created_at) },
    { key: 'a', header: 'Actor', cell: (r) => r.actor_email ?? (r.actor_id ? r.actor_id.slice(0, 8) : 'system') },
    { key: 'ac', header: 'Action', sort: 'action', cell: (r) => <Badge tone={r.action === 'delete' ? 'danger' : r.action === 'sensitive_read' || r.action === 'export' ? 'warning' : 'neutral'}>{r.action}</Badge> },
    { key: 'ty', header: 'Record type', sort: 'record_type', cell: (r) => r.record_type },
    { key: 'id', header: 'Record ID', cell: (r) => <span className="font-mono text-xs">{r.record_id?.slice(0, 13)}</span> },
    { key: 'r', header: 'Reason', cell: (r) => r.reason },
  ]
  return (
    <div>
      <PageHeader title="Audit Logs" description="Append-only record of privileged and business actions. Passwords, full TINs and bank account numbers are never recorded." />
      <DataTable<AuditRow> queryKey={['audit', type, action, from, to]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'created_at', asc: false }} onRowClick={setOpen} searchPlaceholder="Search record ID or reason…"
        filters={<>
          <FilterSelect label="Record type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{TABLES.map((t) => <option key={t}>{t}</option>)}</FilterSelect>
          <FilterSelect label="Action" value={action} onChange={(e) => setAction(e.target.value)}><option value="">All</option>{['insert', 'update', 'delete', 'sensitive_read', 'export', 'import', 'announcement'].map((t) => <option key={t}>{t}</option>)}</FilterSelect>
          <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
        fetchPage={async (p) => {
          let q = supabase.from('audit_logs').select('*', { count: 'exact' }); if (type) q = q.eq('record_type', type); if (action) q = q.eq('action', action); if (from) q = q.gte('created_at', `${from}T00:00:00+08:00`); if (to) q = q.lte('created_at', `${to}T23:59:59+08:00`)
          const res = await runPage<AuditRow>(applyPage(q, p, ['record_id', 'reason']))
          const ids = [...new Set(res.rows.map((r) => r.actor_id).filter(Boolean))]
          if (ids.length) { const emails = unwrap(await supabase.rpc('actor_emails', { p_ids: ids })) as { id: string; email: string }[]; res.rows.forEach((r) => { r.actor_email = emails.find((e) => e.id === r.actor_id)?.email }) }
          return res
        }}
        exportAs={{ name: 'audit-log', columns: [{ header: 'Time', value: (r) => r.created_at }, { header: 'Actor', value: (r) => r.actor_email ?? r.actor_id }, { header: 'Action', value: (r) => r.action }, { header: 'Record type', value: (r) => r.record_type }, { header: 'Record ID', value: (r) => r.record_id }, { header: 'Reason', value: (r) => r.reason }] }} />
      {open && <Modal open wide title={`${open.action} · ${open.record_type}`} onClose={() => setOpen(null)} footer={<Button onClick={() => setOpen(null)}>Close</Button>}>
        <div className="grid gap-3 text-xs sm:grid-cols-2"><div><p className="mb-1 font-medium">Before</p><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(open.before_values, null, 2) ?? '—'}</pre></div><div><p className="mb-1 font-medium">After</p><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(open.after_values, null, 2) ?? '—'}</pre></div></div>
        {open.reason && <p className="mt-3 text-sm"><strong>Reason:</strong> {open.reason}</p>}</Modal>}
    </div>
  )
}

// ------------------------------------------------------------------ settings
export function SettingsPage() {
  const { can } = useAuth()
  const tabs = [
    can('settings.manage') && { id: 'general', label: 'General & branding', content: <GeneralSettings /> },
    can('settings.manage') && { id: 'professions', label: 'Professions', content: <ProfessionsTab /> },
    can('settings.manage') && { id: 'docs', label: 'Document requirements', content: <DocReqTab /> },
    can('settings.manage') && { id: 'elig', label: 'Position eligibility', content: <EligibilityTab /> },
    can('allowance.rules.manage') && { id: 'allowance', label: 'Allowance rules', content: <AllowanceRules /> },
    can('cpd.rules.manage') && { id: 'cpd', label: 'CPD rules', content: <CpdRules /> },
  ].filter(Boolean) as { id: string; label: string; content: React.ReactNode }[]
  return (<div><PageHeader title="System Settings" description="Changes to rules and settings require a documented reason and are audited. Rules are versioned: historical records keep the version that applied to them." /><Tabs tabs={tabs} /></div>)
}

function GeneralSettings() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: async () => unwrap(await supabase.from('system_settings').select('*').order('key')) as { key: string; value: any; description: string | null; updated_at: string }[] })
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null)
  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorState error={q.error} />
  return (
    <Card padded={false}>
      <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-muted"><tr><th className="px-3 py-2">Setting</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">Description</th><th /></tr></thead>
        <tbody className="divide-y divide-line">{q.data?.map((s) => <tr key={s.key}><td className="px-3 py-2 font-mono text-xs">{s.key}</td><td className="max-w-xs break-words px-3 py-2">{JSON.stringify(s.value)}</td><td className="px-3 py-2 text-muted">{s.description}</td><td className="px-3 py-2"><Button size="sm" variant="secondary" onClick={() => setEdit({ key: s.key, value: JSON.stringify(s.value) })}>Edit</Button></td></tr>)}</tbody></table>
      {edit && <DecisionModal title={`Edit ${edit.key}`} onClose={() => setEdit(null)} options={[{ value: 'save', label: 'Save change', reasonRequired: true }]}
        onSubmit={async (_d, reason) => { let parsed: unknown; try { parsed = JSON.parse(edit.value) } catch { throw new Error('Value must be valid JSON (e.g. 5, true, "text")') } unwrap(await supabase.rpc('update_setting', { p_key: edit.key, p_value: parsed, p_reason: reason })); toast.success('Setting updated'); qc.invalidateQueries({ queryKey: ['settings'] }) }}>
        <TextArea label="Value (JSON)" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} /></DecisionModal>}
    </Card>
  )
}

function ProfessionsTab() {
  return <CrudCard title="Examination professions / boards" table="professions" orderBy="name" canEdit canDelete={false} fields={[{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Profession / board name', required: true }, { name: 'active', label: 'Active', type: 'checkbox', default: true }]}
    columns={[{ header: 'Code', cell: (r) => r.code }, { header: 'Name', cell: (r) => r.name }, { header: 'Status', cell: (r) => activeBadge(r.active) }]} />
}

function DocReqTab() {
  const fields: FieldDef[] = [
    { name: 'code', label: 'Code', required: true, createOnly: true }, { name: 'name', label: 'Document name', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'required_for_assignment', label: 'Required before an assignment can be approved', type: 'checkbox' }, { name: 'required_for_allowance', label: 'Required before an allowance can be processed', type: 'checkbox' },
    { name: 'registered_professional_only', label: 'Only for registered professionals', type: 'checkbox' }, { name: 'allowed_mime_types', label: 'Allowed file types (MIME, comma-separated)', type: 'list', default: ['application/pdf', 'image/jpeg', 'image/png'] },
    { name: 'max_size_mb', label: 'Max size (MB, up to 5 for the private bucket)', type: 'number', default: 5 }, { name: 'valid_for_days', label: 'Valid for (days; blank = no expiry)', type: 'number' }, { name: 'sort_order', label: 'Sort order', type: 'number', default: 0 }, { name: 'active', label: 'Active', type: 'checkbox', default: true }]
  return <CrudCard title="Supporting document requirements" description="Slots shown to volunteers. Storage enforces PDF/JPEG/PNG and 5 MB at the bucket level." table="document_requirements" orderBy="sort_order" canEdit canDelete={false} fields={fields}
    columns={[{ header: 'Document', cell: (r) => <span className="font-medium">{r.name}</span> }, { header: 'Assignment', cell: (r) => yesNo(r.required_for_assignment) }, { header: 'Allowance', cell: (r) => yesNo(r.required_for_allowance) }, { header: 'Registered only', cell: (r) => yesNo(r.registered_professional_only) }, { header: 'Status', cell: (r) => activeBadge(r.active) }]} />
}

function EligibilityTab() {
  const positions = usePositions()
  const fields: FieldDef[] = [
    { name: 'position_id', label: 'Position', type: 'select', required: true, options: (positions.data as Position[] | undefined)?.map((p) => ({ value: p.id, label: p.name })) },
    { name: 'rule_type', label: 'Criterion', type: 'select', required: true, options: [{ value: 'profession', label: 'Profession' }, { value: 'min_prior_assignments', label: 'Minimum prior assignments' }, { value: 'training', label: 'Training' }, { value: 'other', label: 'Other' }] },
    { name: 'rule_value', label: 'Value', required: true }, { name: 'description', label: 'Description', type: 'textarea' }]
  return <CrudCard title="Position eligibility criteria" description="Documented criteria used by coordinators when selecting candidates. Hard checks (registered professional, verified license) are set on the position itself." table="position_eligibility_rules" select="*, assignment_positions(name)" orderBy="id" canEdit canDelete fields={fields}
    columns={[{ header: 'Position', cell: (r) => r.assignment_positions?.name }, { header: 'Criterion', cell: (r) => r.rule_type }, { header: 'Value', cell: (r) => r.rule_value }, { header: 'Description', cell: (r) => r.description }]} />
}

function RulesCard({ title, table, fields, columns, note }: { title: string; table: string; fields: FieldDef[]; columns: { header: string; cell: (r: any) => React.ReactNode }[]; note: string }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [end, setEnd] = useState<any>(null)
  const q = useQuery({ queryKey: ['rules', table], queryFn: async () => unwrap(await supabase.from(table).select('*').order('version', { ascending: false })) as any[] })
  const refresh = () => qc.invalidateQueries({ queryKey: ['rules', table] })
  return (
    <Card title={title} padded={false} actions={<Button size="sm" onClick={() => setAdding(true)}>New version</Button>}>
      <p className="border-b border-line px-4 py-2 text-xs text-muted">{note}</p>
      {q.isLoading ? <Spinner /> : q.isError ? <div className="p-4"><ErrorState error={q.error} /></div> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-muted"><tr><th className="px-3 py-2">Version</th>{columns.map((c) => <th key={c.header} className="px-3 py-2">{c.header}</th>)}<th className="px-3 py-2">Effective</th><th className="px-3 py-2">Reason</th><th /></tr></thead>
          <tbody className="divide-y divide-line">{q.data?.map((r) => <tr key={r.id}><td className="px-3 py-2 font-semibold">v{r.version}</td>{columns.map((c) => <td key={c.header} className="px-3 py-2">{c.cell(r)}</td>)}<td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.effective_from)} – {r.effective_to ? fmtDate(r.effective_to) : 'open'} {activeBadge(r.active)}</td><td className="px-3 py-2 text-xs text-muted">{r.reason}</td>
            <td className="px-3 py-2">{r.active && <Button size="sm" variant="ghost" onClick={() => setEnd(r)}>Deactivate…</Button>}</td></tr>)}</tbody></table></div>)}
      {adding && <RuleForm title={`New ${title} version`} table={table} fields={fields} onClose={() => setAdding(false)} onDone={refresh} />}
      {end && <DecisionModal title={`Deactivate v${end.version}`} onClose={() => setEnd(null)} options={[{ value: 'end', label: 'Deactivate from today', reasonRequired: true }]}
        onSubmit={async (_d, reason) => { unwrap(await supabase.rpc('deactivate_rule', { p_kind: table === 'cpd_rules' ? 'cpd' : 'allowance', p_id: end.id, p_reason: reason })); toast.success('Rule deactivated; historical records keep this version'); refresh() }} />}
    </Card>
  )
}

function RuleForm({ title, table, fields, onClose, onDone }: { title: string; table: string; fields: FieldDef[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>(() => Object.fromEntries(fields.map((f) => [f.name, f.default ?? (f.type === 'checkbox' ? false : '')])))
  const save = useMutation({
    mutationFn: async () => {
      const row: any = {}
      for (const f of fields) { const x = v[f.name]; row[f.name] = f.type === 'number' ? (x === '' ? null : Number(x)) : f.type === 'checkbox' ? !!x : f.type === 'list' ? String(x).split(',').map((s) => s.trim()).filter(Boolean) : x === '' ? null : x }
      if (!row.reason) throw new Error('A documented reason is required')
      unwrap(await supabase.from(table).insert(row).select('id').single())
    },
    onSuccess: () => { toast.success('New rule version created'); onDone(); onClose() }, onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Modal open wide title={title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Create version</Button></>}>
      <Alert tone="warning">Rules are immutable once created. Creating a new version does not change historical records; they keep the version that applied.</Alert>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => f.type === 'checkbox' ? <Checkbox key={f.name} className="sm:col-span-2" label={f.label} hint={f.hint} checked={!!v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} />
          : f.type === 'select' ? <SelectInput key={f.name} label={f.label} required={f.required} value={v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}><option value="">Any / not restricted</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectInput>
          : f.type === 'textarea' ? <TextArea key={f.name} label={f.label} required={f.required} wrapperClassName="sm:col-span-2" value={v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
          : <TextInput key={f.name} label={f.label} hint={f.hint} required={f.required} type={f.type === 'list' ? 'text' : f.type ?? 'text'} step={f.type === 'number' ? '0.01' : undefined} value={Array.isArray(v[f.name]) ? v[f.name].join(', ') : v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />)}
      </div>
    </Modal>
  )
}

function AllowanceRules() {
  const positions = usePositions()
  const events = useEvents()
  const fields: FieldDef[] = [
    { name: 'name', label: 'Rule name', required: true },
    { name: 'amount', label: 'Approved amount per duty day (PHP)', type: 'number', required: true, hint: 'Enter only amounts approved under PRC policy' },
    { name: 'position_id', label: 'Position (optional)', type: 'select', options: (positions.data as Position[] | undefined)?.map((p) => ({ value: p.id, label: p.name })) },
    { name: 'personnel_category', label: 'Personnel category (optional)', type: 'select', options: ['volunteer', 'prc_staff', 'pnp', 'other_external'].map((v) => ({ value: v, label: v })) },
    { name: 'event_id', label: 'Examination (optional)', type: 'select', options: events.data?.map((e) => ({ value: e.id, label: e.name })) },
    { name: 'effective_from', label: 'Effective from', type: 'date', required: true }, { name: 'effective_to', label: 'Effective to (optional)', type: 'date' },
    { name: 'requires_tin', label: 'Requires TIN', type: 'checkbox', default: true }, { name: 'requires_bank_account', label: 'Requires verified bank account', type: 'checkbox', default: true },
    { name: 'reason', label: 'Documented reason / authority (required)', type: 'textarea', required: true }]
  return <RulesCard title="Allowance rule" table="allowance_rules" fields={fields} note="The most specific active rule (examination > position > category) effective on the duty date is applied. No amount is assumed from a job title." columns={[{ header: 'Name', cell: (r) => r.name }, { header: 'Amount', cell: (r) => peso(r.amount) }, { header: 'Scope', cell: (r) => [r.position_id && positions.data?.find((p) => p.id === r.position_id)?.name, r.personnel_category, r.event_id && 'event'].filter(Boolean).join(' · ') || 'All' }]} />
}

function CpdRules() {
  const positions = usePositions()
  const fields: FieldDef[] = [
    { name: 'name', label: 'Rule name', required: true }, { name: 'units_per_day', label: 'CPD units per qualifying service day', type: 'number', required: true, default: 2 },
    { name: 'partial_day_qualifies', label: 'Partial-day participation qualifies', type: 'checkbox' }, { name: 'late_qualifies', label: 'Late arrival still qualifies', type: 'checkbox', default: true },
    { name: 'count_once_per_date', label: 'Count a calendar date once per volunteer (prevents double counting)', type: 'checkbox', default: true },
    { name: 'requires_two_step_approval', label: 'Require review and a different approver', type: 'checkbox', default: true },
    { name: 'effective_from', label: 'Effective from', type: 'date', required: true }, { name: 'effective_to', label: 'Effective to (optional)', type: 'date' },
    { name: 'reason', label: 'Documented reason / authority (required)', type: 'textarea', required: true }]
  return <RulesCard title="CPD rule" table="cpd_rules" fields={fields} note={`Proposed operational rule: 1 verified eligible service day = 2 units for a registered professional, subject to PRC / Professional Regulatory Board validation. Eligible positions: positions flagged CPD-eligible (${(positions.data as Position[] | undefined)?.filter((p) => p.cpd_eligible).map((p) => p.name).join(', ') ?? '…'}).`}
    columns={[{ header: 'Units / day', cell: (r) => Number(r.units_per_day) }, { header: 'Partial day', cell: (r) => yesNo(r.partial_day_qualifies) }, { header: 'Once per date', cell: (r) => yesNo(r.count_once_per_date) }, { header: 'Two-step', cell: (r) => yesNo(r.requires_two_step_approval) }]} />
}

