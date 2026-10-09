import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { Badge, Button, Card, DescriptionList, ErrorState, PageHeader, Spinner, StatusBadge } from '@/components/ui/ui'
import { FilterSelect } from '@/components/ui/form'
import { DecisionModal } from '@/components/DecisionModal'
import { TextInput } from '@/components/ui/form'
import { toast } from '@/components/ui/Toast'
import { fmtDate, fullName, fmtDateTime } from '@/lib/format'
import { applyPage, runPage } from '@/lib/query'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { Credential, Employment, Preference, RosterRow, VolunteerDoc, VolunteerProfile } from '@/types/db'

type Vol = VolunteerProfile & { profiles: { email: string; account_status: string; email_verified_at: string | null } }

export function VolunteerDirectory() {
  const nav = useNavigate()
  const [ver, setVer] = useState('')
  const [acct, setAcct] = useState('')
  const [reg, setReg] = useState('')
  const cols: Col<Vol>[] = [
    { key: 'no', header: 'Volunteer ID', sort: 'volunteer_no', cell: (r) => <span className="font-mono text-xs">{r.volunteer_no}</span> },
    { key: 'name', header: 'Name', sort: 'last_name', cell: (r) => <span className="font-medium">{fullName(r)}</span> },
    { key: 'email', header: 'Email', cell: (r) => r.profiles.email },
    { key: 'mobile', header: 'Mobile', cell: (r) => r.mobile_no },
    { key: 'city', header: 'City / municipality', sort: 'city_municipality', cell: (r) => r.city_municipality },
    { key: 'reg', header: 'Registered professional', cell: (r) => (r.is_registered_professional === null ? '—' : r.is_registered_professional ? 'Yes' : 'No') },
    { key: 'acct', header: 'Account', cell: (r) => <StatusBadge status={r.profiles.account_status} /> },
    { key: 'ver', header: 'Profile', sort: 'verification_status', cell: (r) => <StatusBadge status={r.verification_status} /> },
    { key: 'since', header: 'Registered', sort: 'created_at', cell: (r) => fmtDate(r.created_at), defaultHidden: true },
  ]
  return (
    <div>
      <PageHeader title="Volunteer Directory" description="All registered volunteers. Open a record to review the profile, credentials and documents." />
      <DataTable<Vol>
        queryKey={['vol-dir', ver, acct, reg]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'last_name', asc: true }} onRowClick={(r) => nav(`/admin/volunteers/${r.id}`)}
        searchPlaceholder="Search name, volunteer ID, mobile, city…"
        filters={<>
          <FilterSelect label="Profile" value={ver} onChange={(e) => setVer(e.target.value)}><option value="">All</option>{['unverified', 'pending', 'verified', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}</FilterSelect>
          <FilterSelect label="Account" value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">All</option>{['pending', 'active', 'suspended', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}</FilterSelect>
          <FilterSelect label="Registered pro" value={reg} onChange={(e) => setReg(e.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></FilterSelect>
        </>}
        fetchPage={(p) => {
          let q = supabase.from('volunteer_profiles').select('*, profiles!inner(email,account_status,email_verified_at)', { count: 'exact' }).not('last_name', 'is', null)
          if (ver) q = q.eq('verification_status', ver)
          if (acct) q = q.eq('profiles.account_status', acct)
          if (reg) q = q.eq('is_registered_professional', reg === 'true')
          return runPage(applyPage(q, p, ['last_name', 'first_name', 'volunteer_no', 'mobile_no', 'city_municipality']))
        }}
        exportAs={{ name: 'volunteer-directory', columns: [
          { header: 'Volunteer ID', value: (r) => r.volunteer_no }, { header: 'Last name', value: (r) => r.last_name }, { header: 'First name', value: (r) => r.first_name },
          { header: 'Email', value: (r) => r.profiles.email }, { header: 'Mobile', value: (r) => r.mobile_no }, { header: 'City / municipality', value: (r) => r.city_municipality },
          { header: 'Province', value: (r) => r.province }, { header: 'Registered professional', value: (r) => r.is_registered_professional }, { header: 'Account', value: (r) => r.profiles.account_status },
          { header: 'Profile verification', value: (r) => r.verification_status }] }}
      />
    </div>
  )
}

async function openDoc(path: string) {
  const { data, error } = await supabase.storage.from('volunteer-documents').createSignedUrl(path, 60)
  if (error) toast.error(error.message); else window.open(data.signedUrl, '_blank', 'noopener')
}

export function DocDecision({ doc, onClose }: { doc: { id: string; file_name: string; storage_path: string }; onClose: () => void }) {
  const qc = useQueryClient()
  return (
    <DecisionModal title={`Review: ${doc.file_name}`} onClose={onClose}
      options={[{ value: 'verified', label: 'Verified' }, { value: 'under_review', label: 'Mark as under review' }, { value: 'rejected', label: 'Rejected', reasonRequired: true }, { value: 'requires_resubmission', label: 'Requires resubmission', reasonRequired: true }]}
      onSubmit={async (decision, reason) => { unwrap(await supabase.rpc('review_document', { p_document: doc.id, p_status: decision, p_reason: reason || null })); toast.success('Document reviewed'); qc.invalidateQueries() }}>
      <Button variant="secondary" size="sm" onClick={() => openDoc(doc.storage_path)}><Eye className="h-4 w-4" aria-hidden /> Open document (secure link, 60 s)</Button>
    </DecisionModal>
  )
}

export function CredentialDecision({ cred, onClose }: { cred: Credential; onClose: () => void }) {
  const qc = useQueryClient()
  const [regStatus, setRegStatus] = useState(cred.registration_status ?? '')
  return (
    <DecisionModal title={`Verify license ${cred.license_no}`} onClose={onClose}
      options={[{ value: 'verified', label: 'Verified against PRC records' }, { value: 'rejected', label: 'Rejected', reasonRequired: true }, { value: 'pending', label: 'Keep pending' }]}
      onSubmit={async (decision, reason) => { unwrap(await supabase.rpc('verify_credential', { p_credential: cred.id, p_status: decision, p_registration_status: regStatus || null, p_remarks: reason || null })); toast.success('Credential updated'); qc.invalidateQueries() }}>
      <p className="text-sm text-muted">{cred.professions?.name} · {cred.license_no} · expires {fmtDate(cred.expiry_date)}. Check the number and name against official PRC records before verifying.</p>
      <TextInput label="PRC registration status (as found)" value={regStatus} onChange={(e) => setRegStatus(e.target.value)} placeholder="e.g. Active" />
    </DecisionModal>
  )
}

export function VolunteerReview() {
  const { id } = useParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [dlg, setDlg] = useState<'account' | 'profile' | null>(null)
  const [doc, setDoc] = useState<VolunteerDoc | null>(null)
  const [cred, setCred] = useState<Credential | null>(null)
  const v = useQuery({ queryKey: ['vol', id], queryFn: async () => unwrap(await supabase.from('volunteer_profiles').select('*, profiles(email,account_status,email_verified_at)').eq('id', id!).single()) as Vol })
  const creds = useQuery({ queryKey: ['vol-creds', id], queryFn: async () => unwrap(await supabase.from('professional_credentials').select('*, professions(name)').eq('volunteer_id', id!)) as Credential[] })
  const emp = useQuery({ queryKey: ['vol-emp', id], queryFn: async () => unwrap(await supabase.from('employment_records').select('*').eq('volunteer_id', id!).maybeSingle()) as Employment | null })
  const docs = useQuery({ queryKey: ['vol-docs', id], enabled: can('documents.review'), queryFn: async () => unwrap(await supabase.from('volunteer_documents_current').select('*, document_requirements(name)').eq('volunteer_id', id!)) as unknown as (VolunteerDoc & { document_requirements: { name: string } })[] })
  const blockers = useQuery({ queryKey: ['vol-blockers', id], queryFn: async () => ({ assignment: unwrap(await supabase.rpc('volunteer_blockers', { p_volunteer: id, p_stage: 'assignment' })) as string[], allowance: unwrap(await supabase.rpc('volunteer_blockers', { p_volunteer: id, p_stage: 'allowance' })) as string[] }) })
  const fin = useQuery({ queryKey: ['vol-fin', id], enabled: can('financial.view_masked'), queryFn: async () => unwrap(await supabase.rpc('get_financial_masked', { p_volunteer: id })) as { has_tin: boolean; tin_masked?: string; has_account: boolean; account_masked?: string; bank_verification_status: string } })
  const prefs = useQuery({ queryKey: ['vol-prefs', id], enabled: can('preferences.view'), queryFn: async () => unwrap(await supabase.from('examination_preferences').select('*, examination_events(name)').eq('volunteer_id', id!)) as unknown as Preference[] })
  const hist = useQuery({ queryKey: ['vol-hist', id], enabled: can('assignments.view'), queryFn: async () => unwrap(await supabase.from('assignment_roster').select('*').eq('volunteer_id', id!).order('exam_date', { ascending: false }).limit(20)) as RosterRow[] })
  const refresh = () => qc.invalidateQueries()
  const accountMut = useMutation({ mutationFn: async (a: { status: string; reason: string }) => { unwrap(await supabase.rpc('set_account_status', { p_user: v.data!.user_id, p_status: a.status, p_reason: a.reason || null })) }, onSuccess: () => { toast.success('Account updated'); refresh() }, onError: (e) => toast.error(errorMessage(e)) })

  if (v.isLoading) return <Spinner />
  if (v.isError) return <ErrorState error={v.error} />
  const p = v.data!
  return (
    <div className="space-y-4">
      <PageHeader title={fullName(p)} description={`${p.volunteer_no} · ${p.profiles.email}`} actions={<Link to="/admin/volunteers"><Button variant="secondary">Back to directory</Button></Link>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Account & verification" className="lg:col-span-1">
          <div className="space-y-3 text-sm">
            <p className="flex justify-between">Account <StatusBadge status={p.profiles.account_status} /></p>
            <p className="flex justify-between">Email verified <Badge tone={p.profiles.email_verified_at ? 'success' : 'warning'}>{p.profiles.email_verified_at ? fmtDate(p.profiles.email_verified_at) : 'No'}</Badge></p>
            <p className="flex justify-between">Profile <StatusBadge status={p.verification_status} /></p>
            {p.verification_remarks && <p className="text-xs text-muted">Remarks: {p.verification_remarks}</p>}
            {can('volunteers.verify') && <div className="flex flex-wrap gap-2 pt-2">
              {p.profiles.account_status === 'pending' && <Button size="sm" onClick={() => accountMut.mutate({ status: 'active', reason: '' })}>Approve account</Button>}
              {p.profiles.account_status === 'suspended' && <Button size="sm" onClick={() => accountMut.mutate({ status: 'active', reason: '' })}>Reactivate</Button>}
              {['pending', 'active'].includes(p.profiles.account_status) && <Button size="sm" variant="danger" onClick={() => setDlg('account')}>Reject / suspend…</Button>}
              <Button size="sm" variant="secondary" onClick={() => setDlg('profile')}>Verify profile…</Button></div>}
          </div>
        </Card>
        <Card title="Readiness" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <div><p className="mb-1 font-medium">Before an assignment can be approved</p>{blockers.data?.assignment.length === 0 ? <Badge tone="success">Ready</Badge> : <ul className="list-disc pl-5 text-amber-800">{blockers.data?.assignment.map((b) => <li key={b}>{b}</li>)}</ul>}</div>
            <div><p className="mb-1 font-medium">Before an allowance can be processed</p>{blockers.data?.allowance.length === 0 ? <Badge tone="success">Ready</Badge> : <ul className="list-disc pl-5 text-amber-800">{blockers.data?.allowance.map((b) => <li key={b}>{b}</li>)}</ul>}</div>
          </div>
        </Card>
      </div>

      <Card title="Personal information"><DescriptionList items={[['Mobile', p.mobile_no], ['Alternative contact', p.alt_contact_no], ['Address', [p.address, p.city_municipality, p.province].filter(Boolean).join(', ')], ['Date of birth', fmtDate(p.date_of_birth)],
        ['Emergency contact', [p.emergency_name, p.emergency_relationship, p.emergency_contact_no].filter(Boolean).join(' · ')], ['Registered professional', p.is_registered_professional === null ? '—' : p.is_registered_professional ? 'Yes' : 'No'],
        ['Employment', emp.data?.is_employed ? `${emp.data.employer_name} (${emp.data.position ?? 'position n/a'}, ${emp.data.sector ?? 'sector n/a'})` : 'Not employed / not provided'],
        ['Experience', p.experience_notes], ['Previous assignments', p.prior_assignments_notes], ['Skills', p.skills], ['Training & certifications', p.training_certifications]]} /></Card>

      <Card title="Professional credentials" padded={false}>
        {creds.data?.length === 0 ? <p className="p-4 text-sm text-muted">No license declared.</p> : <ul className="divide-y divide-line">{creds.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <div><p className="font-medium">{c.professions?.name} · <span className="font-mono">{c.license_no}</span></p><p className="text-xs text-muted">Registered {fmtDate(c.initial_registration_date)} · expires {fmtDate(c.expiry_date)} · PRC status: {c.registration_status ?? 'not checked'} · self-declared until verified</p></div>
            <div className="flex items-center gap-2"><StatusBadge status={c.verification_status} />{can('credentials.verify') && <Button size="sm" variant="secondary" onClick={() => setCred(c)}>Verify…</Button>}</div></li>))}</ul>}
      </Card>

      {can('documents.review') && <Card title="Supporting documents" padded={false}>
        {docs.data?.length === 0 ? <p className="p-4 text-sm text-muted">No documents submitted.</p> : <ul className="divide-y divide-line">{docs.data?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <div><p className="font-medium">{d.document_requirements.name}</p><p className="text-xs text-muted">{d.file_name} · submitted {fmtDate(d.submitted_at)}{d.review_reason ? ` · ${d.review_reason}` : ''}</p></div>
            <div className="flex items-center gap-2"><StatusBadge status={d.effective_status} /><Button size="sm" variant="secondary" onClick={() => setDoc(d)}>Review…</Button></div></li>))}</ul>}
      </Card>}

      {can('financial.view_masked') && fin.data && <Card title="Allowance information (masked)"><DescriptionList items={[['TIN', fin.data.has_tin ? fin.data.tin_masked : 'Not provided'], ['LandBank account', fin.data.has_account ? fin.data.account_masked : 'Not provided'], ['Bank verification', <StatusBadge key="b" status={fin.data.bank_verification_status} />]]} /></Card>}
      {prefs.data && <Card title="Examination preferences" padded={false}><ul className="divide-y divide-line text-sm">{prefs.data.length === 0 ? <li className="p-4 text-muted">None</li> : prefs.data.map((x) => <li key={x.id} className="flex justify-between p-3"><span>{(x as any).examination_events?.name}</span><StatusBadge status={x.status} /></li>)}</ul></Card>}
      {hist.data && <Card title="Recent assignments" padded={false}><ul className="divide-y divide-line text-sm">{hist.data.length === 0 ? <li className="p-4 text-muted">None</li> : hist.data.map((x) => <li key={x.id} className="flex justify-between p-3"><span>{fmtDate(x.exam_date)} · {x.event_name} · {x.position_name}</span><StatusBadge status={x.status} /></li>)}</ul></Card>}
      <p className="text-xs text-muted">Last updated {fmtDateTime(p.updated_at)}</p>

      {dlg === 'account' && <DecisionModal title="Reject or suspend account" onClose={() => setDlg(null)} options={[{ value: 'rejected', label: 'Reject registration', reasonRequired: true }, { value: 'suspended', label: 'Suspend account', reasonRequired: true }]} onSubmit={(d, r) => accountMut.mutateAsync({ status: d, reason: r })} />}
      {dlg === 'profile' && <DecisionModal title="Verify volunteer profile" onClose={() => setDlg(null)} options={[{ value: 'verified', label: 'Verified (identity and details checked)' }, { value: 'pending', label: 'Under review' }, { value: 'rejected', label: 'Rejected', reasonRequired: true }]}
        onSubmit={async (d, r) => { unwrap(await supabase.rpc('verify_volunteer', { p_volunteer: id, p_status: d, p_remarks: r || null })); toast.success('Profile updated'); refresh() }} />}
      {doc && <DocDecision doc={doc} onClose={() => setDoc(null)} />}
      {cred && <CredentialDecision cred={cred} onClose={() => setCred(null)} />}
    </div>
  )
}

interface DocRow { id: string; file_name: string; storage_path: string; status: string; submitted_at: string; review_reason: string | null; volunteer_profiles: { last_name: string | null; first_name: string | null; volunteer_no: string }; document_requirements: { name: string } }

export function DocumentQueue() {
  const [status, setStatus] = useState('submitted')
  const [doc, setDoc] = useState<DocRow | null>(null)
  const cols: Col<DocRow>[] = [
    { key: 'v', header: 'Volunteer', cell: (r) => <Link className="text-navy-800 hover:underline" to={`/admin/volunteers/${(r as any).volunteer_id}`}>{fullName(r.volunteer_profiles)}</Link> },
    { key: 'no', header: 'ID', cell: (r) => <span className="font-mono text-xs">{r.volunteer_profiles.volunteer_no}</span> },
    { key: 'd', header: 'Document', cell: (r) => r.document_requirements.name },
    { key: 'f', header: 'File', cell: (r) => r.file_name },
    { key: 's', header: 'Status', sort: 'status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'at', header: 'Submitted', sort: 'submitted_at', cell: (r) => fmtDate(r.submitted_at) },
    { key: 'a', header: '', cell: (r) => <Button size="sm" variant="secondary" onClick={() => setDoc(r)}>Review</Button> },
  ]
  return (
    <div>
      <PageHeader title="Document Review Queue" description="Review supporting documents. Rejections and resubmission requests require a reason, which the volunteer sees." />
      <DataTable<DocRow> queryKey={['doc-queue', status]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'submitted_at', asc: true }} hideSearch
        filters={<FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['submitted', 'under_review', 'verified', 'rejected', 'requires_resubmission'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</FilterSelect>}
        fetchPage={(p) => { let q = supabase.from('volunteer_documents').select('*, volunteer_profiles(last_name,first_name,volunteer_no), document_requirements(name)', { count: 'exact' }); if (status) q = q.eq('status', status); return runPage(applyPage(q, p, [])) }}
        emptyTitle="Nothing to review" />
      {doc && <DocDecision doc={doc} onClose={() => setDoc(null)} />}
    </div>
  )
}

export function CredentialQueue() {
  const { can } = useAuth()
  const [status, setStatus] = useState('pending')
  const [cred, setCred] = useState<Credential | null>(null)
  const cols: Col<Credential>[] = [
    { key: 'v', header: 'Volunteer', cell: (r) => <Link className="text-navy-800 hover:underline" to={`/admin/volunteers/${r.volunteer_id}`}>{r.volunteer_profiles ? fullName(r.volunteer_profiles) : '—'}</Link> },
    { key: 'p', header: 'Profession', cell: (r) => r.professions?.name },
    { key: 'l', header: 'License no.', sort: 'license_no', cell: (r) => <span className="font-mono">{r.license_no}</span> },
    { key: 'e', header: 'Expires', sort: 'expiry_date', cell: (r) => fmtDate(r.expiry_date) },
    { key: 'r', header: 'PRC status', cell: (r) => r.registration_status ?? '—' },
    { key: 's', header: 'Verification', sort: 'verification_status', cell: (r) => <StatusBadge status={r.verification_status} /> },
    { key: 'a', header: '', cell: (r) => can('credentials.verify') && <Button size="sm" variant="secondary" onClick={() => setCred(r)}>Verify</Button> },
  ]
  return (
    <div>
      <PageHeader title="Professional Credential Verification" description="Self-declared license numbers are not trusted until verified against official PRC records." />
      <DataTable<Credential> queryKey={['cred-queue', status]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'created_at', asc: true }} searchPlaceholder="Search license number…"
        filters={<FilterSelect label="Verification" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['pending', 'verified', 'rejected', 'unverified'].map((s) => <option key={s}>{s}</option>)}</FilterSelect>}
        fetchPage={(p) => { let q = supabase.from('professional_credentials').select('*, professions(name), volunteer_profiles(last_name,first_name,volunteer_no)', { count: 'exact' }); if (status) q = q.eq('verification_status', status); return runPage(applyPage(q, p, ['license_no'])) }} />
      {cred && <CredentialDecision cred={cred} onClose={() => setCred(null)} />}
    </div>
  )
}

