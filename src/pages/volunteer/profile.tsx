import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { NavLink, Outlet } from 'react-router-dom'
import { z } from 'zod'
import clsx from 'clsx'
import { CheckCircle2, Circle, Eye, Upload } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Spinner, StatusBadge } from '@/components/ui/ui'
import { Checkbox, SelectInput, TextArea, TextInput } from '@/components/ui/form'
import { ConfirmDialog } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { useMyVolunteer } from '@/hooks/useMyVolunteer'
import { profileCompleteness } from '@/lib/completeness'
import { fmtDate } from '@/lib/format'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { Credential, DocRequirement, Employment, Profession, VolunteerDoc } from '@/types/db'

interface MyFinancial { has_tin: boolean; tin_masked?: string; has_account: boolean; account_masked?: string; account_holder?: string; bank_name?: string; bank_verification_status: string }

/** Loads everything needed for the completeness indicator and the "missing items" list. */
export function useCompleteness() {
  const { data: vol } = useMyVolunteer()
  return useQuery({
    queryKey: ['completeness', vol?.id, vol?.updated_at],
    enabled: !!vol,
    queryFn: async () => {
      const v = vol!
      const [creds, emp, fin, reqs, docs] = await Promise.all([
        supabase.from('professional_credentials').select('id', { count: 'exact', head: true }).eq('volunteer_id', v.id),
        supabase.from('employment_records').select('volunteer_id').eq('volunteer_id', v.id).maybeSingle(),
        supabase.rpc('get_my_financial'),
        supabase.from('document_requirements').select('id,name,registered_professional_only,required_for_assignment,required_for_allowance').eq('active', true),
        supabase.from('volunteer_documents_current').select('requirement_id').eq('volunteer_id', v.id),
      ])
      const f = unwrap(fin) as MyFinancial
      const requirements = (unwrap(reqs) as { id: string; name: string; registered_professional_only: boolean; required_for_assignment: boolean; required_for_allowance: boolean }[])
        .filter((r) => r.required_for_assignment || r.required_for_allowance)
      return profileCompleteness({
        profile: v,
        credentialCount: creds.count ?? 0,
        hasEmploymentRecord: !!unwrap(emp),
        hasTin: f.has_tin,
        hasBankAccount: f.has_account,
        requiredDocs: requirements.map((r) => ({ id: r.id, name: r.name, registeredOnly: r.registered_professional_only })),
        submittedDocIds: new Set((unwrap(docs) as { requirement_id: string }[]).map((d) => d.requirement_id)),
      })
    },
  })
}

const STEPS = [
  { to: '/profile', label: 'Personal', end: true },
  { to: '/profile/professional', label: 'Professional' },
  { to: '/profile/employment', label: 'Employment' },
  { to: '/profile/allowance', label: 'Allowance info' },
  { to: '/profile/documents', label: 'Documents' },
]

export function ProfileLayout() {
  const c = useCompleteness()
  const { data: vol } = useMyVolunteer()
  return (
    <div>
      <PageHeader title="My Profile" description="Complete each section. You can save and return at any time — your progress is kept." />
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Profile completeness">
          {c.data ? (
            <>
              <ProgressBar percent={c.data.percent} />
              {c.data.missing.length > 0 ? (
                <details className="mt-3 text-sm"><summary className="cursor-pointer text-prc-600">{c.data.missing.length} item(s) still needed</summary>
                  <ul className="mt-2 list-disc pl-5 text-muted">{c.data.missing.map((m) => <li key={m}>{m}</li>)}</ul></details>
              ) : <p className="mt-3 text-sm text-emerald-700">All required information is on file.</p>}
            </>
          ) : <Spinner />}
        </Card>
        <Card title="Verification">
          <div className="space-y-2 text-sm">
            <p className="flex items-center justify-between">Volunteer ID <span className="font-mono">{vol?.volunteer_no}</span></p>
            <p className="flex items-center justify-between">Profile <StatusBadge status={vol?.verification_status} /></p>
            {vol?.verification_remarks && vol.verification_status === 'rejected' && <Alert tone="danger">{vol.verification_remarks}</Alert>}
          </div>
        </Card>
      </div>
      <nav aria-label="Profile sections" className="mb-4 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => clsx('rounded-full border px-3 py-1.5 text-sm', isActive ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-ink hover:bg-prc-50')}>
            {i + 1}. {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}

// ----------------------------------------------------------------- personal
const mobile = z.string().trim().regex(/^(09|\+639)\d{9}$/, 'Use a Philippine mobile number, e.g. 09171234567')
const personalSchema = z.object({
  last_name: z.string().trim().min(1, 'Required'),
  first_name: z.string().trim().min(1, 'Required'),
  middle_name: z.string().trim().optional(),
  name_extension: z.string().trim().optional(),
  preferred_name: z.string().trim().optional(),
  date_of_birth: z.string().optional(),
  mobile_no: mobile,
  alt_contact_no: z.string().trim().optional(),
  address: z.string().trim().min(1, 'Required'),
  city_municipality: z.string().trim().min(1, 'Required'),
  province: z.string().trim().min(1, 'Required'),
  emergency_name: z.string().trim().min(1, 'Required'),
  emergency_relationship: z.string().trim().min(1, 'Required'),
  emergency_contact_no: mobile,
})
type Personal = z.infer<typeof personalSchema>

const nullify = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]))

export function PersonalStep() {
  const { data: vol, isLoading, error } = useMyVolunteer()
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<Personal>({ resolver: zodResolver(personalSchema) })
  useEffect(() => { if (vol) reset({ ...vol, middle_name: vol.middle_name ?? '', name_extension: vol.name_extension ?? '', preferred_name: vol.preferred_name ?? '', date_of_birth: vol.date_of_birth ?? '', alt_contact_no: vol.alt_contact_no ?? '', address: vol.address ?? '', city_municipality: vol.city_municipality ?? '', province: vol.province ?? '', emergency_name: vol.emergency_name ?? '', emergency_relationship: vol.emergency_relationship ?? '', emergency_contact_no: vol.emergency_contact_no ?? '', mobile_no: vol.mobile_no ?? '', last_name: vol.last_name ?? '', first_name: vol.first_name ?? '' }) }, [vol, reset])
  const save = useMutation({
    mutationFn: async (v: Personal) => { unwrap(await supabase.from('volunteer_profiles').update(nullify(v)).eq('id', vol!.id).select('id').single()) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['completeness'] }); toast.success('Personal information saved') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (isLoading) return <Spinner />
  if (error) return <ErrorState error={error} />
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
      <Card title="Personal information">
        <p className="mb-4 text-xs text-muted">Only information with an operational purpose is requested. Date of birth is optional.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput label="Last name" required error={errors.last_name?.message} {...register('last_name')} />
          <TextInput label="First name" required error={errors.first_name?.message} {...register('first_name')} />
          <TextInput label="Middle name" {...register('middle_name')} />
          <TextInput label="Extension (Jr., III…)" {...register('name_extension')} />
          <TextInput label="Preferred name" {...register('preferred_name')} />
          <TextInput label="Date of birth" type="date" {...register('date_of_birth')} />
          <TextInput label="Mobile number" required error={errors.mobile_no?.message} {...register('mobile_no')} />
          <TextInput label="Alternative contact (optional)" {...register('alt_contact_no')} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <TextInput label="Residential address" required wrapperClassName="sm:col-span-3" error={errors.address?.message} {...register('address')} />
          <TextInput label="City / municipality" required error={errors.city_municipality?.message} {...register('city_municipality')} />
          <TextInput label="Province" required error={errors.province?.message} {...register('province')} />
        </div>
      </Card>
      <Card title="Emergency contact">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput label="Name" required error={errors.emergency_name?.message} {...register('emergency_name')} />
          <TextInput label="Relationship" required error={errors.emergency_relationship?.message} {...register('emergency_relationship')} />
          <TextInput label="Contact number" required error={errors.emergency_contact_no?.message} {...register('emergency_contact_no')} />
        </div>
      </Card>
      <div className="flex justify-end"><Button type="submit" loading={save.isPending} disabled={!isDirty}>Save personal information</Button></div>
    </form>
  )
}

// ----------------------------------------------------------------- professional
const credSchema = z.object({
  profession_id: z.string().min(1, 'Select a profession'),
  license_no: z.string().trim().min(3, 'Enter your PRC license number'),
  initial_registration_date: z.string().optional(),
  expiry_date: z.string().optional(),
})
type CredForm = z.infer<typeof credSchema>

const expSchema = z.object({ experience_notes: z.string().optional(), prior_assignments_notes: z.string().optional(), skills: z.string().optional(), training_certifications: z.string().optional() })

export function ProfessionalStep() {
  const { data: vol } = useMyVolunteer()
  const qc = useQueryClient()
  const [removing, setRemoving] = useState<Credential | null>(null)
  const professions = useQuery({ queryKey: ['professions'], queryFn: async () => unwrap(await supabase.from('professions').select('*').eq('active', true).order('name')) as Profession[] })
  const creds = useQuery({
    queryKey: ['credentials', vol?.id], enabled: !!vol,
    queryFn: async () => unwrap(await supabase.from('professional_credentials').select('*, professions(name)').eq('volunteer_id', vol!.id).order('created_at')) as Credential[],
  })
  const setReg = useMutation({
    mutationFn: async (val: boolean) => { unwrap(await supabase.from('volunteer_profiles').update({ is_registered_professional: val }).eq('id', vol!.id).select('id').single()) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['completeness'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const addCred = useForm<CredForm>({ resolver: zodResolver(credSchema) })
  const saveCred = useMutation({
    mutationFn: async (v: CredForm) => { unwrap(await supabase.from('professional_credentials').insert({ volunteer_id: vol!.id, profession_id: v.profession_id, license_no: v.license_no, initial_registration_date: v.initial_registration_date || null, expiry_date: v.expiry_date || null }).select('id').single()) },
    onSuccess: () => { addCred.reset(); qc.invalidateQueries({ queryKey: ['credentials'] }); qc.invalidateQueries({ queryKey: ['completeness'] }); toast.success('License submitted for verification by PRC') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('professional_credentials').delete().eq('id', id); if (error) throw new Error(error.message) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credentials'] }); qc.invalidateQueries({ queryKey: ['completeness'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const exp = useForm<z.infer<typeof expSchema>>()
  useEffect(() => { if (vol) exp.reset({ experience_notes: vol.experience_notes ?? '', prior_assignments_notes: vol.prior_assignments_notes ?? '', skills: vol.skills ?? '', training_certifications: vol.training_certifications ?? '' }) }, [vol, exp])
  const saveExp = useMutation({
    mutationFn: async (v: z.infer<typeof expSchema>) => { unwrap(await supabase.from('volunteer_profiles').update(nullify(v)).eq('id', vol!.id).select('id').single()) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); toast.success('Experience saved') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (!vol) return <Spinner />
  return (
    <div className="space-y-4">
      <Card title="Professional registration">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Are you a PRC-registered professional?</legend>
          <div className="flex gap-6 text-sm">
            {[['Yes', true], ['No', false]].map(([l, v]) => (
              <label key={String(l)} className="flex items-center gap-2"><input type="radio" name="reg" checked={vol.is_registered_professional === v} onChange={() => setReg.mutate(v as boolean)} /> {l}</label>
            ))}
          </div>
        </fieldset>
        {vol.is_registered_professional && (
          <div className="mt-5 space-y-4">
            <Alert tone="info">A license number you enter is <strong>self-declared</strong> until PRC verifies it. Editing a verified license sends it back for verification.</Alert>
            {creds.data?.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-3 text-sm">
                <div>
                  <p className="font-medium">{c.professions?.name} · <span className="font-mono">{c.license_no}</span></p>
                  <p className="text-xs text-muted">Registered {fmtDate(c.initial_registration_date)} · Expires {fmtDate(c.expiry_date)} {c.registration_status && `· PRC status: ${c.registration_status}`}</p>
                  {c.verification_status === 'rejected' && <p className="mt-1 text-xs text-red-700">{c.verification_remarks}</p>}
                </div>
                <div className="flex items-center gap-2"><StatusBadge status={c.verification_status} />
                  {c.verification_status !== 'verified' && <Button size="sm" variant="ghost" onClick={() => setRemoving(c)}>Remove</Button>}</div>
              </div>
            ))}
            <form onSubmit={addCred.handleSubmit((v) => saveCred.mutate(v))} noValidate className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
              <SelectInput label="Profession" required error={addCred.formState.errors.profession_id?.message} {...addCred.register('profession_id')}>
                <option value="">Select…</option>{professions.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectInput>
              <TextInput label="PRC license no." required error={addCred.formState.errors.license_no?.message} {...addCred.register('license_no')} />
              <TextInput label="Initial registration" type="date" {...addCred.register('initial_registration_date')} />
              <TextInput label="License expiry" type="date" {...addCred.register('expiry_date')} />
              <div className="sm:col-span-4"><Button type="submit" size="sm" loading={saveCred.isPending}>Add license</Button></div>
            </form>
          </div>
        )}
      </Card>
      <Card title="Experience and qualifications">
        <form onSubmit={exp.handleSubmit((v) => saveExp.mutate(v))} className="space-y-4">
          <TextArea label="Relevant experience in licensure examination operations" {...exp.register('experience_notes')} />
          <TextArea label="Previous examination assignments" hint="Examination, year, role" {...exp.register('prior_assignments_notes')} />
          <TextArea label="Special qualifications or skills" {...exp.register('skills')} />
          <TextArea label="Training and certifications" {...exp.register('training_certifications')} />
          <div className="flex justify-end"><Button type="submit" loading={saveExp.isPending}>Save</Button></div>
        </form>
      </Card>
      <ConfirmDialog open={!!removing} title="Remove license entry" danger confirmLabel="Remove" message="This removes the license entry from your profile." onClose={() => setRemoving(null)} onConfirm={() => del.mutateAsync(removing!.id)} />
    </div>
  )
}

// ----------------------------------------------------------------- employment
const empSchema = z.object({ is_employed: z.boolean(), employer_name: z.string().optional(), employer_address: z.string().optional(), position: z.string().optional(), sector: z.string().optional() })
  .refine((v) => !v.is_employed || !!v.employer_name?.trim(), { path: ['employer_name'], message: 'Enter your employer' })

export function EmploymentStep() {
  const { data: vol } = useMyVolunteer()
  const qc = useQueryClient()
  const emp = useQuery({ queryKey: ['employment', vol?.id], enabled: !!vol, queryFn: async () => unwrap(await supabase.from('employment_records').select('*').eq('volunteer_id', vol!.id).maybeSingle()) as Employment | null })
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<z.infer<typeof empSchema>>({ resolver: zodResolver(empSchema), defaultValues: { is_employed: false } })
  useEffect(() => { if (emp.data) reset({ is_employed: emp.data.is_employed, employer_name: emp.data.employer_name ?? '', employer_address: emp.data.employer_address ?? '', position: emp.data.position ?? '', sector: emp.data.sector ?? '' }) }, [emp.data, reset])
  const employed = watch('is_employed')
  const save = useMutation({
    mutationFn: async (v: z.infer<typeof empSchema>) => {
      const row = v.is_employed ? nullify({ ...v, volunteer_id: vol!.id }) : { volunteer_id: vol!.id, is_employed: false, employer_name: null, employer_address: null, position: null, sector: null }
      unwrap(await supabase.from('employment_records').upsert(row).select('volunteer_id').single())
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employment'] }); qc.invalidateQueries({ queryKey: ['completeness'] }); toast.success('Employment information saved') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (emp.isLoading) return <Spinner />
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <Card title="Current employment">
        <div className="space-y-4">
          <Checkbox label="I am currently employed" {...register('is_employed')} />
          {employed && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Employer name" required error={errors.employer_name?.message} {...register('employer_name')} />
              <TextInput label="Position" {...register('position')} />
              <TextInput label="Employer address / work location" {...register('employer_address')} />
              <SelectInput label="Sector" {...register('sector')}><option value="">Select…</option>{['Government', 'Private', 'Self-employed', 'Other'].map((s) => <option key={s}>{s}</option>)}</SelectInput>
            </div>
          )}
          <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save employment</Button></div>
        </div>
      </Card>
    </form>
  )
}

// ----------------------------------------------------------------- allowance (TIN / bank)
const finSchema = z.object({
  tin: z.string().trim().refine((v) => v === '' || /^\d{9,12}$/.test(v.replace(/[\s-]/g, '')), 'TIN must be 9 to 12 digits'),
  account_no: z.string().trim().refine((v) => v === '' || /^\d{8,20}$/.test(v.replace(/[\s-]/g, '')), 'Account number must be 8 to 20 digits'),
  holder: z.string().trim(),
})

export function AllowanceStep() {
  const qc = useQueryClient()
  const fin = useQuery({ queryKey: ['my-financial'], queryFn: async () => unwrap(await supabase.rpc('get_my_financial')) as MyFinancial })
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof finSchema>>({ resolver: zodResolver(finSchema), defaultValues: { tin: '', account_no: '', holder: '' } })
  const save = useMutation({
    mutationFn: async (v: z.infer<typeof finSchema>) => { unwrap(await supabase.rpc('save_my_financial', { p_tin: v.tin || null, p_account_no: v.account_no || null, p_holder: v.holder || null })) },
    onSuccess: () => { reset({ tin: '', account_no: '', holder: '' }); qc.invalidateQueries({ queryKey: ['my-financial'] }); qc.invalidateQueries({ queryKey: ['completeness'] }); toast.success('Saved. Your details are stored securely and shown masked.') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (fin.isLoading) return <Spinner />
  const f = fin.data
  return (
    <Card title="TIN and LandBank account">
      <Alert tone="info" title="Why we ask">Needed only to process any allowance for which you are eligible. These details are masked after saving and visible only to authorised finance personnel; each access is logged.</Alert>
      <dl className="my-4 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted">TIN on file</dt><dd className="font-mono">{f?.has_tin ? f.tin_masked : 'Not provided'}</dd></div>
        <div><dt className="text-xs text-muted">Account on file</dt><dd className="font-mono">{f?.has_account ? f.account_masked : 'Not provided'}</dd></div>
        <div><dt className="text-xs text-muted">Bank verification</dt><dd><StatusBadge status={f?.bank_verification_status} /></dd></div>
      </dl>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4 sm:grid-cols-3">
        <TextInput label="TIN" autoComplete="off" hint="Leave blank to keep the current value" error={errors.tin?.message} {...register('tin')} />
        <TextInput label="LandBank account number" autoComplete="off" hint="Leave blank to keep the current value" error={errors.account_no?.message} {...register('account_no')} />
        <TextInput label="Account holder name" autoComplete="off" placeholder={f?.account_holder} {...register('holder')} />
        <div className="sm:col-span-3 flex justify-end"><Button type="submit" loading={save.isPending}>Save securely</Button></div>
      </form>
    </Card>
  )
}

// ----------------------------------------------------------------- documents
export function DocumentsStep() {
  const { data: vol } = useMyVolunteer()
  const { session } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const reqs = useQuery({ queryKey: ['doc-reqs'], queryFn: async () => unwrap(await supabase.from('document_requirements').select('*').eq('active', true).order('sort_order')) as DocRequirement[] })
  const docs = useQuery({ queryKey: ['my-docs', vol?.id], enabled: !!vol, queryFn: async () => unwrap(await supabase.from('volunteer_documents_current').select('*').eq('volunteer_id', vol!.id)) as VolunteerDoc[] })

  const upload = async (r: DocRequirement, file: File) => {
    if (!r.allowed_mime_types.includes(file.type)) { toast.error(`Allowed file types: ${r.allowed_mime_types.map((t) => t.split('/')[1].toUpperCase()).join(', ')}`); return }
    if (file.size > r.max_size_mb * 1024 * 1024) { toast.error(`File is larger than ${r.max_size_mb} MB`); return }
    setBusy(r.id)
    try {
      const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
      const path = `${session!.user.id}/${r.code}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('volunteer-documents').upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw new Error(up.error.message)
      const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120)
      unwrap(await supabase.from('volunteer_documents').insert({ volunteer_id: vol!.id, requirement_id: r.id, storage_path: path, file_name: safeName, mime_type: file.type, size_bytes: file.size }).select('id').single())
      toast.success(`${r.name} submitted for review`)
      qc.invalidateQueries({ queryKey: ['my-docs'] }); qc.invalidateQueries({ queryKey: ['completeness'] })
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(null) }
  }
  const view = async (d: VolunteerDoc) => {
    const { data, error } = await supabase.storage.from('volunteer-documents').createSignedUrl(d.storage_path, 60)
    if (error) toast.error(error.message); else window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (reqs.isLoading || docs.isLoading) return <Spinner />
  if (reqs.error || docs.error) return <ErrorState error={reqs.error ?? docs.error} />
  const list = (reqs.data ?? []).filter((r) => !r.registered_professional_only || vol?.is_registered_professional)
  if (!list.length) return <EmptyState title="No documents are required at this time" />
  return (
    <Card title="Supporting documents" padded={false}>
      <ul className="divide-y divide-line">
        {list.map((r) => {
          const d = docs.data?.find((x) => x.requirement_id === r.id)
          const canUpload = !d || ['rejected', 'requires_resubmission', 'expired', 'submitted', 'under_review'].includes(d.effective_status)
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.name} {r.required_for_assignment && <Badge tone="brand">Needed before assignment</Badge>} {r.required_for_allowance && <Badge tone="info">Needed for allowance</Badge>}</p>
                {r.description && <p className="text-xs text-muted">{r.description}</p>}
                <p className="mt-1 text-xs text-muted">{r.allowed_mime_types.map((t) => t.split('/')[1].toUpperCase()).join(' / ')} · max {r.max_size_mb} MB</p>
                {d?.review_reason && <p className="mt-1 text-xs text-red-700">PRC note: {d.review_reason}</p>}
                {d && <p className="mt-1 text-xs text-muted">{d.file_name} · submitted {fmtDate(d.submitted_at)}{d.expires_on ? ` · valid until ${fmtDate(d.expires_on)}` : ''}</p>}
              </div>
              <div className="flex items-center gap-2">
                {d ? <StatusBadge status={d.effective_status} /> : <StatusBadge status="not_submitted" />}
                {d && <Button size="sm" variant="ghost" onClick={() => view(d)} aria-label={`View ${r.name}`}><Eye className="h-4 w-4" /></Button>}
                {canUpload && (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium hover:bg-prc-50">
                    {busy === r.id ? 'Uploading…' : <><Upload className="h-3.5 w-3.5" aria-hidden /> {d ? 'Replace' : 'Upload'}</>}
                    <input type="file" className="sr-only" accept={r.allowed_mime_types.join(',')} disabled={busy === r.id} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(r, f) }} />
                  </label>
                )}
                {d?.effective_status === 'verified' && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Verified" />}
                {!d && <Circle className="h-4 w-4 text-slate-300" aria-hidden />}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
