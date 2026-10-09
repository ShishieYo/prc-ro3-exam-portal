import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { DataTable, type Col } from '@/components/ui/DataTable'
import { Checkbox, FilterSelect, SelectInput, TextArea, TextInput } from '@/components/ui/form'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui/ui'
import { downloadBlob, downloadCsv, toCsv } from '@/lib/csv'
import { fmtDate, fmtDateTime, titleCase } from '@/lib/format'
import { applyPage, runPage } from '@/lib/query'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import { readTabularFile, type RawRow } from '@/lib/xlsx'
import type { ExamDate, ExamEvent, ExternalPerson, Position } from '@/types/db'
import { useCenters, usePositions } from './events'

const BLANK = { full_name: '', category: 'pnp', rank_position: '', agency_unit: '', contact_info: '', allowance_eligible: false, remarks: '' }

export function ExternalPersonnel() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState<(typeof BLANK & { id?: string }) | null>(null)
  const [assign, setAssign] = useState<ExternalPerson | null>(null)
  const manage = can('external.manage')
  const save = useMutation({
    mutationFn: async (v: typeof BLANK & { id?: string }) => {
      const row = { full_name: v.full_name.trim(), category: v.category, rank_position: v.rank_position || null, agency_unit: v.agency_unit || null, contact_info: v.contact_info || null, allowance_eligible: v.allowance_eligible, remarks: v.remarks || null }
      if (!row.full_name) throw new Error('Full name is required')
      if (v.id) unwrap(await supabase.from('external_personnel').update(row).eq('id', v.id).select('id').single())
      else unwrap(await supabase.from('external_personnel').insert(row).select('id').single())
    },
    onSuccess: () => { toast.success('Saved'); setEdit(null); qc.invalidateQueries({ queryKey: ['external'] }) }, onError: (e) => toast.error(errorMessage(e)),
  })
  const cols: Col<ExternalPerson>[] = [
    { key: 'no', header: 'ID', sort: 'ext_no', cell: (r) => <span className="font-mono text-xs">{r.ext_no}</span> },
    { key: 'n', header: 'Name', sort: 'full_name', cell: (r) => <span className="font-medium">{r.full_name}</span> },
    { key: 'c', header: 'Category', sort: 'category', cell: (r) => <Badge tone="brand">{r.category === 'pnp' ? 'PNP' : 'Other external'}</Badge> },
    { key: 'r', header: 'Rank / position', cell: (r) => r.rank_position },
    { key: 'u', header: 'Agency / unit', sort: 'agency_unit', cell: (r) => r.agency_unit },
    { key: 'ct', header: 'Contact', cell: (r) => r.contact_info, defaultHidden: true },
    { key: 'al', header: 'Allowance', cell: (r) => (r.allowance_eligible ? 'Eligible' : 'No') },
    { key: 'a', header: '', cell: (r) => manage && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setAssign(r)}>Assign</Button><Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, full_name: r.full_name, category: r.category, rank_position: r.rank_position ?? '', agency_unit: r.agency_unit ?? '', contact_info: r.contact_info ?? '', allowance_eligible: r.allowance_eligible, remarks: r.remarks ?? '' })}>Edit</Button></div> },
  ]
  return (
    <div>
      <PageHeader title="PNP and External Personnel Registry" description="Personnel supplied by other agencies. They have no portal accounts and cannot sign in."
        actions={manage ? <><Button variant="secondary" onClick={() => (window.location.href = `${import.meta.env.BASE_URL}admin/imports`)}>Import list</Button><Button onClick={() => setEdit({ ...BLANK })}>Add personnel</Button></> : undefined} />
      <DataTable<ExternalPerson> queryKey={['external', cat]} rowKey={(r) => r.id} columns={cols} defaultSort={{ column: 'full_name', asc: true }} searchPlaceholder="Search name, unit, rank…"
        filters={<FilterSelect label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option><option value="pnp">PNP</option><option value="other_external">Other external</option></FilterSelect>}
        fetchPage={(p) => { let q = supabase.from('external_personnel').select('*', { count: 'exact' }).eq('active', true); if (cat) q = q.eq('category', cat); return runPage(applyPage(q, p, ['full_name', 'agency_unit', 'rank_position', 'ext_no'])) }}
        exportAs={{ name: 'external-personnel', columns: [{ header: 'ID', value: (r) => r.ext_no }, { header: 'Name', value: (r) => r.full_name }, { header: 'Category', value: (r) => r.category }, { header: 'Rank / position', value: (r) => r.rank_position }, { header: 'Agency / unit', value: (r) => r.agency_unit }] }} />
      {edit && (
        <Modal open title={edit.id ? 'Edit personnel' : 'Add personnel'} onClose={() => setEdit(null)} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate(edit)}>Save</Button></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Full name" required wrapperClassName="sm:col-span-2" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
            <SelectInput label="Category" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}><option value="pnp">PNP</option><option value="other_external">Other external</option></SelectInput>
            <TextInput label="Rank / position" value={edit.rank_position} onChange={(e) => setEdit({ ...edit, rank_position: e.target.value })} />
            <TextInput label="Agency / unit" value={edit.agency_unit} onChange={(e) => setEdit({ ...edit, agency_unit: e.target.value })} />
            <TextInput label="Contact information (if necessary)" value={edit.contact_info} onChange={(e) => setEdit({ ...edit, contact_info: e.target.value })} />
            <Checkbox className="sm:col-span-2" label="Allowance-eligible (subject to position and approved rules)" checked={edit.allowance_eligible} onChange={(e) => setEdit({ ...edit, allowance_eligible: e.target.checked })} />
            <TextArea label="Administrative remarks" wrapperClassName="sm:col-span-2" value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} />
          </div>
        </Modal>)}
      {assign && <AssignExternal person={assign} onClose={() => setAssign(null)} />}
    </div>
  )
}

function AssignExternal({ person, onClose }: { person: ExternalPerson; onClose: () => void }) {
  const qc = useQueryClient()
  const centers = useCenters()
  const positions = usePositions()
  const [eventId, setEventId] = useState('')
  const [dateId, setDateId] = useState('')
  const [posId, setPosId] = useState('')
  const [centerId, setCenterId] = useState('')
  const [release, setRelease] = useState(true)
  const events = useQuery({ queryKey: ['events-pick'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').in('status', ['open_for_registration', 'under_staffing', 'assignments_released', 'ready_for_deployment', 'ongoing']).order('created_at', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
  const dates = useQuery({ queryKey: ['event-dates', eventId], enabled: !!eventId, queryFn: async () => unwrap(await supabase.from('examination_dates').select('*').eq('event_id', eventId).order('exam_date')) as ExamDate[] })
  const go = useMutation({
    mutationFn: async () => {
      if (!eventId || !dateId || !posId || !centerId) throw new Error('Select the examination, date, position and center')
      const row = unwrap(await supabase.from('assignments').insert({ event_id: eventId, exam_date_id: dateId, external_id: person.id, position_id: posId, center_id: centerId }).select('id').single()) as { id: string }
      if (release) unwrap(await supabase.rpc('release_assignments', { p_ids: [row.id] }))
    },
    onSuccess: () => { toast.success(release ? 'Assigned and confirmed' : 'Draft assignment created'); qc.invalidateQueries(); onClose() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const eligible = (positions.data as Position[] | undefined)?.filter((p) => p.active && (p.personnel_type === person.category || p.personnel_type === 'prc_staff'))
  return (
    <Modal open title={`Assign ${person.full_name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={go.isPending} onClick={() => go.mutate()}>Assign</Button></>}>
      <div className="grid gap-4">
        <SelectInput label="Examination" value={eventId} onChange={(e) => { setEventId(e.target.value); setDateId('') }}><option value="">Select…</option>{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</SelectInput>
        <SelectInput label="Duty date" value={dateId} onChange={(e) => setDateId(e.target.value)}><option value="">Select…</option>{dates.data?.map((d) => <option key={d.id} value={d.id}>{fmtDate(d.exam_date)}</option>)}</SelectInput>
        <SelectInput label="Operational assignment" value={posId} onChange={(e) => setPosId(e.target.value)}><option value="">Select…</option>{eligible?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput>
        <SelectInput label="Examination center" value={centerId} onChange={(e) => setCenterId(e.target.value)}><option value="">Select…</option>{centers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectInput>
        <Checkbox label="Confirm immediately (no volunteer response needed)" checked={release} onChange={(e) => setRelease(e.target.checked)} />
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ import
interface Preview { line: number; data: { full_name: string; category: string; rank_position: string; agency_unit: string; contact_info: string; allowance_eligible: string; remarks: string }; status: 'ok' | 'error' | 'duplicate' | 'possible'; note: string }
const TEMPLATE_HEADERS = ['full_name', 'category', 'rank_position', 'agency_unit', 'contact_info', 'allowance_eligible', 'remarks']
const key = (n: string, u: string, r: string) => `${n.trim().toLowerCase()}|${u.trim().toLowerCase()}|${r.trim().toLowerCase()}`

export function ImportsPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<Preview[] | null>(null)
  const [includePossible, setIncludePossible] = useState(false)
  const [result, setResult] = useState<{ total: number; imported: number; rejected: number; errors: { row: number; name: string; error: string }[] } | null>(null)
  const existing = useQuery({ queryKey: ['external-keys'], queryFn: async () => unwrap(await supabase.from('external_personnel').select('full_name,agency_unit,rank_position')) as { full_name: string; agency_unit: string | null; rank_position: string | null }[] })
  const history = useQuery({ queryKey: ['import-history'], queryFn: async () => unwrap(await supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(20)) as { id: string; kind: string; file_name: string | null; total_rows: number; imported_rows: number; rejected_rows: number; created_at: string }[] })

  const template = () => downloadBlob(new Blob([toCsv([{ full_name: 'PO1 Juan Dela Cruz', category: 'pnp', rank_position: 'PO1', agency_unit: 'Pampanga PPO', contact_info: '', allowance_eligible: 'false', remarks: 'Sample row — delete before uploading' }], TEMPLATE_HEADERS.map((h) => ({ header: h, value: (r: Record<string, string>) => r[h] }))) ], { type: 'text/csv' }), 'external-personnel-template.csv')

  const onFile = async (f: File) => {
    setResult(null); setFileName(f.name)
    try {
      const rows: RawRow[] = await readTabularFile(f)
      const missing = ['full_name'].filter((h) => !(h in rows[0]))
      if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}. Download the template for the expected structure.`)
      const exist = new Set((existing.data ?? []).map((e) => key(e.full_name, e.agency_unit ?? '', e.rank_position ?? '')))
      const existNames = new Set((existing.data ?? []).map((e) => e.full_name.trim().toLowerCase()))
      const seen = new Set<string>()
      setPreview(rows.map((r, i) => {
        const d = { full_name: r.full_name ?? '', category: (r.category || 'pnp').toLowerCase(), rank_position: r.rank_position ?? '', agency_unit: r.agency_unit ?? '', contact_info: r.contact_info ?? '', allowance_eligible: r.allowance_eligible ?? '', remarks: r.remarks ?? '' }
        const k = key(d.full_name, d.agency_unit, d.rank_position)
        let status: Preview['status'] = 'ok'; let note = ''
        if (!d.full_name.trim()) { status = 'error'; note = 'Full name is required' }
        else if (!['pnp', 'other_external'].includes(d.category)) { status = 'error'; note = 'Category must be pnp or other_external' }
        else if (d.allowance_eligible && !/^(true|false|yes|no|1|0)$/i.test(d.allowance_eligible)) { status = 'error'; note = 'allowance_eligible must be true/false' }
        else if (exist.has(k)) { status = 'duplicate'; note = 'Already in the registry' }
        else if (seen.has(k)) { status = 'duplicate'; note = 'Repeated in this file' }
        else if (existNames.has(d.full_name.trim().toLowerCase())) { status = 'possible'; note = 'Same name exists with a different unit/rank — review; not merged automatically' }
        seen.add(k)
        return { line: i + 2, data: d, status, note }
      }))
    } catch (e) { setPreview(null); toast.error(errorMessage(e)) }
  }

  const run = useMutation({
    mutationFn: async () => {
      const rows = preview!.filter((p) => p.status === 'ok' || (includePossible && p.status === 'possible'))
      const payload = rows.map((p) => ({ ...p.data, allowance_eligible: /^(true|yes|1)$/i.test(p.data.allowance_eligible) }))
      return unwrap(await supabase.rpc('import_external_personnel', { p_file: fileName, p_rows: payload })) as { total: number; imported: number; rejected: number; errors: { row: number; name: string; error: string }[] }
    },
    onSuccess: (r) => { setResult(r); setPreview(null); qc.invalidateQueries({ queryKey: ['external'] }); qc.invalidateQueries({ queryKey: ['external-keys'] }); qc.invalidateQueries({ queryKey: ['import-history'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const counts = preview ? { ok: preview.filter((p) => p.status === 'ok').length, error: preview.filter((p) => p.status === 'error').length, dup: preview.filter((p) => p.status === 'duplicate').length, poss: preview.filter((p) => p.status === 'possible').length } : null
  const errorReport = () => preview && downloadCsv(preview.filter((p) => p.status === 'error' || p.status === 'duplicate'), [{ header: 'Line', value: (r) => r.line }, { header: 'Name', value: (r) => r.data.full_name }, { header: 'Problem', value: (r) => r.note }], 'import-errors')

  if (!can('imports.manage')) return null
  return (
    <div className="space-y-4">
      <PageHeader title="Imports" description="Import approved lists of PNP / external personnel from CSV or Excel. Nothing is saved until you confirm the preview." />
      <Card title="1. Template and file">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={template}>Download CSV template</Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} aria-label="Upload CSV or Excel file" />
        </div>
        <p className="mt-2 text-xs text-muted">Required: full_name. category: pnp (default) or other_external. Max 5 MB. Imported records are tagged with their import batch.</p>
      </Card>
      {preview && counts && (
        <Card title={`2. Preview — ${preview.length} row(s)`} padded={false} actions={<><Badge tone="success">{counts.ok} ready</Badge><Badge tone="warning">{counts.poss} possible match</Badge><Badge tone="neutral">{counts.dup} duplicate</Badge><Badge tone="danger">{counts.error} error</Badge></>}>
          <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted"><tr>{['Line', 'Name', 'Category', 'Rank', 'Unit', 'Result'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{preview.map((p) => <tr key={p.line}><td className="px-3 py-1.5">{p.line}</td><td className="px-3 py-1.5">{p.data.full_name}</td><td className="px-3 py-1.5">{p.data.category}</td><td className="px-3 py-1.5">{p.data.rank_position}</td><td className="px-3 py-1.5">{p.data.agency_unit}</td>
              <td className="px-3 py-1.5"><Badge tone={p.status === 'ok' ? 'success' : p.status === 'possible' ? 'warning' : p.status === 'duplicate' ? 'neutral' : 'danger'}>{p.status === 'ok' ? 'Ready' : p.status}</Badge> <span className="text-xs text-muted">{p.note}</span></td></tr>)}</tbody></table></div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3">
            <div className="flex items-center gap-4">{counts.poss > 0 && <Checkbox label="Also import possible matches" checked={includePossible} onChange={(e) => setIncludePossible(e.target.checked)} />}{(counts.error > 0 || counts.dup > 0) && <Button size="sm" variant="ghost" onClick={errorReport}>Download problem report</Button>}</div>
            <div className="flex gap-2"><Button variant="secondary" onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = '' }}>Discard</Button><Button loading={run.isPending} disabled={counts.ok + (includePossible ? counts.poss : 0) === 0} onClick={() => run.mutate()}>Import {counts.ok + (includePossible ? counts.poss : 0)} row(s)</Button></div>
          </div>
        </Card>)}
      {result && (
        <Alert tone={result.rejected ? 'warning' : 'success'} title="Import complete">
          Imported {result.imported} of {result.total}. {result.rejected > 0 && <>Rejected {result.rejected}: <ul className="mt-1 list-disc pl-5">{result.errors.map((e) => <li key={e.row}>Row {e.row} ({e.name}): {e.error}</li>)}</ul>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => downloadCsv(result.errors, [{ header: 'Row', value: (r) => r.row }, { header: 'Name', value: (r) => r.name }, { header: 'Error', value: (r) => r.error }], 'import-errors')}>Download error report</Button></>}
        </Alert>)}
      <Card title="Import history" padded={false}>
        {history.data?.length === 0 ? <EmptyState title="No imports yet" /> : <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-muted"><tr>{['When', 'Type', 'File', 'Rows', 'Imported', 'Rejected'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{history.data?.map((h) => <tr key={h.id}><td className="px-3 py-2">{fmtDateTime(h.created_at)}</td><td className="px-3 py-2">{titleCase(h.kind)}</td><td className="px-3 py-2">{h.file_name}</td><td className="px-3 py-2">{h.total_rows}</td><td className="px-3 py-2">{h.imported_rows}</td><td className="px-3 py-2">{h.rejected_rows}</td></tr>)}</tbody></table>}
      </Card>
      <p className="text-xs text-muted">Not yet supported: bulk import of volunteer accounts (requires a server-side function with the service-role key) and historical assignment, attendance and payment imports. See docs/KNOWN_LIMITATIONS.md.</p>
    </div>
  )
}

