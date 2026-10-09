import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { FilterSelect, SelectInput, TextArea, TextInput } from '@/components/ui/form'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '@/components/ui/ui'
import { downloadCsv } from '@/lib/csv'
import { fmtDate, fmtTime, fromManilaInput, toManilaInput } from '@/lib/format'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'
import type { AttendanceRow, ExamDate, ExamEvent } from '@/types/db'

const STATUSES = ['not_yet_recorded', 'present', 'late', 'absent', 'excused', 'partially_completed', 'for_review']
type Edit = { status: string; in: string; out: string; remarks: string }
type Chip = 'all' | 'not_in' | 'late' | 'absent' | 'incomplete' | 'unverified' | 'verified'

export function AttendanceManagement() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [eventId, setEventId] = useState('')
  const [dateId, setDateId] = useState('')
  const [chip, setChip] = useState<Chip>('all')
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [correct, setCorrect] = useState<AttendanceRow | null>(null)

  const events = useQuery({ queryKey: ['events-pick-att'], queryFn: async () => unwrap(await supabase.from('examination_events').select('id,name,status').in('status', ['assignments_released', 'ready_for_deployment', 'ongoing', 'completed', 'under_staffing', 'open_for_registration']).order('start_date', { ascending: false })) as Pick<ExamEvent, 'id' | 'name' | 'status'>[] })
  useEffect(() => { if (!eventId && events.data?.length) setEventId(events.data[0].id) }, [events.data, eventId])
  const dates = useQuery({ queryKey: ['event-dates', eventId], enabled: !!eventId, queryFn: async () => unwrap(await supabase.from('examination_dates').select('*').eq('event_id', eventId).order('exam_date')) as ExamDate[] })
  useEffect(() => { if (dates.data?.length && !dates.data.some((d) => d.id === dateId)) setDateId(dates.data[0].id) }, [dates.data, dateId])
  const rows = useQuery({
    queryKey: ['attendance', eventId, dateId], enabled: !!eventId && !!dateId,
    queryFn: async () => unwrap(await supabase.from('attendance_records').select('*, assignments(person_name,person_no,personnel_category,report_time,status,assignment_positions(name))').eq('event_id', eventId).eq('exam_date_id', dateId).limit(1000)) as unknown as AttendanceRow[],
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['attendance'] }); setEdits({}); setSel(new Set()) }

  const list = useMemo(() => [...(rows.data ?? [])].sort((a, b) => (a.assignments?.person_name ?? '').localeCompare(b.assignments?.person_name ?? '')), [rows.data])
  const flag = {
    not_in: (r: AttendanceRow) => r.status === 'not_yet_recorded',
    late: (r: AttendanceRow) => r.status === 'late',
    absent: (r: AttendanceRow) => r.status === 'absent',
    incomplete: (r: AttendanceRow) => !!r.check_in_at && !r.check_out_at && ['present', 'late'].includes(r.status),
    unverified: (r: AttendanceRow) => r.verification_status !== 'verified' && r.status !== 'not_yet_recorded',
    verified: (r: AttendanceRow) => r.verification_status === 'verified',
  }
  const shown = chip === 'all' ? list : list.filter(flag[chip])
  const count = (c: Exclude<Chip, 'all'>) => list.filter(flag[c]).length
  const cur = (r: AttendanceRow): Edit => edits[r.id] ?? { status: r.status, in: toManilaInput(r.check_in_at), out: toManilaInput(r.check_out_at), remarks: r.remarks ?? '' }
  const setEdit = (r: AttendanceRow, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [r.id]: { ...cur(r), ...patch } }))
  const nowLocal = () => toManilaInput(new Date().toISOString())

  const save = useMutation({
    mutationFn: async (r: AttendanceRow) => { const e = cur(r); unwrap(await supabase.from('attendance_records').update({ status: e.status, check_in_at: fromManilaInput(e.in), check_out_at: fromManilaInput(e.out), remarks: e.remarks || null }).eq('id', r.id).select('id').single()) },
    onSuccess: () => { toast.success('Attendance saved'); refresh() }, onError: (e) => toast.error(errorMessage(e)),
  })
  const bulk = useMutation({
    mutationFn: async (kind: 'present' | 'submit' | 'verify') => {
      const ids = [...sel]
      if (kind === 'present') {
        const { error } = await supabase.from('attendance_records').update({ status: 'present', check_in_at: new Date().toISOString() }).in('id', ids).eq('status', 'not_yet_recorded')
        if (error) throw new Error(error.message)
      } else unwrap(await supabase.rpc(kind === 'submit' ? 'submit_attendance' : 'verify_attendance', { p_ids: ids }))
    },
    onSuccess: (_d, kind) => { toast.success(kind === 'present' ? 'Marked present' : kind === 'submit' ? 'Submitted for verification' : 'Attendance verified'); refresh() }, onError: (e) => toast.error(errorMessage(e)),
  })

  const canRecord = can('attendance.record') || can('attendance.record_scoped')
  const canSubmit = can('attendance.submit') || can('attendance.submit_scoped')
  const allSel = shown.length > 0 && shown.every((r) => sel.has(r.id))
  const chips: [Chip, string, number][] = [['all', 'All', list.length], ['not_in', 'Not yet checked in', count('not_in')], ['late', 'Late', count('late')], ['absent', 'Absent / needs replacement', count('absent')], ['incomplete', 'Incomplete duty', count('incomplete')], ['unverified', 'Unverified', count('unverified')], ['verified', 'Verified', count('verified')]]

  return (
    <div className="space-y-4">
      <PageHeader title="Attendance Monitoring and Verification" description="Recording attendance does not verify it. Only verified attendance feeds allowances and CPD. Changes to verified records require a documented correction."
        actions={can('reports.export') ? <Button variant="secondary" onClick={() => downloadCsv(shown, [
          { header: 'Name', value: (r) => r.assignments?.person_name }, { header: 'Position', value: (r) => r.assignments?.assignment_positions?.name }, { header: 'Check-in', value: (r) => r.check_in_at }, { header: 'Check-out', value: (r) => r.check_out_at }, { header: 'Status', value: (r) => r.status }, { header: 'Verification', value: (r) => r.verification_status }], 'attendance')}>Export CSV</Button> : undefined} />
      <Card><div className="flex flex-wrap items-end gap-3">
        <FilterSelect label="Examination" value={eventId} onChange={(e) => { setEventId(e.target.value); setDateId('') }} className="min-w-64">{events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</FilterSelect>
        <FilterSelect label="Date" value={dateId} onChange={(e) => setDateId(e.target.value)}>{dates.data?.map((d) => <option key={d.id} value={d.id}>{fmtDate(d.exam_date)}</option>)}</FilterSelect>
      </div></Card>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Attendance filters">
        {chips.map(([k, label, n]) => <button key={k} onClick={() => setChip(k)} aria-pressed={chip === k} className={`rounded-full border px-3 py-1 text-xs font-medium ${chip === k ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white hover:bg-prc-50'}`}>{label} <span className="opacity-70">({n})</span></button>)}
      </div>
      <Card padded={false} title="Roster" actions={<>
        {canRecord && <Button size="sm" variant="secondary" disabled={sel.size === 0} loading={bulk.isPending && bulk.variables === 'present'} onClick={() => bulk.mutate('present')}>Mark selected present (now)</Button>}
        {canSubmit && <Button size="sm" variant="secondary" disabled={sel.size === 0} onClick={() => bulk.mutate('submit')}>Submit selected for verification</Button>}
        {can('attendance.verify') && <Button size="sm" disabled={sel.size === 0} onClick={() => bulk.mutate('verify')}>Verify selected</Button>}</>}>
        {rows.isLoading ? <Spinner /> : rows.isError ? <div className="p-4"><ErrorState error={rows.error} /></div> : shown.length === 0 ? <EmptyState title="No attendance records" hint="Attendance rows are created when an assignment is confirmed." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-muted"><tr><th className="px-3 py-2"><input type="checkbox" aria-label="Select all" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(shown.map((r) => r.id)))} /></th>{['Name', 'Position', 'Report', 'Check-in', 'Check-out', 'Status', 'Verification', 'Remarks', ''].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{shown.map((r) => {
              const locked = r.verification_status === 'verified'
              const e = cur(r)
              const dirty = !!edits[r.id]
              return (
                <tr key={r.id} className={dirty ? 'bg-amber-50/50' : ''}>
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${r.assignments?.person_name}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} /></td>
                  <td className="px-3 py-2 font-medium">{r.assignments?.person_name}<br /><span className="font-mono text-xs text-muted">{r.assignments?.person_no}</span></td>
                  <td className="px-3 py-2">{r.assignments?.assignment_positions?.name}</td>
                  <td className="px-3 py-2">{fmtTime(r.assignments?.report_time)}</td>
                  <td className="px-3 py-2"><div className="flex gap-1"><input aria-label="Check-in" type="datetime-local" disabled={locked || !canRecord} value={e.in} onChange={(ev) => setEdit(r, { in: ev.target.value, status: e.status === 'not_yet_recorded' ? 'present' : e.status })} className="w-44 rounded border border-line px-1 py-1 text-xs disabled:bg-slate-100" />
                    {!locked && canRecord && <Button size="sm" variant="ghost" onClick={() => setEdit(r, { in: nowLocal(), status: e.status === 'not_yet_recorded' ? 'present' : e.status })}>Now</Button>}</div></td>
                  <td className="px-3 py-2"><div className="flex gap-1"><input aria-label="Check-out" type="datetime-local" disabled={locked || !canRecord} value={e.out} onChange={(ev) => setEdit(r, { out: ev.target.value })} className="w-44 rounded border border-line px-1 py-1 text-xs disabled:bg-slate-100" />
                    {!locked && canRecord && <Button size="sm" variant="ghost" onClick={() => setEdit(r, { out: nowLocal() })}>Now</Button>}</div></td>
                  <td className="px-3 py-2"><select aria-label="Attendance status" disabled={locked || !canRecord} value={e.status} onChange={(ev) => setEdit(r, { status: ev.target.value })} className="rounded border border-line px-1 py-1 text-xs disabled:bg-slate-100">{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}{r.status === 'voided' && <option value="voided">voided</option>}</select></td>
                  <td className="px-3 py-2"><StatusBadge status={r.verification_status} /></td>
                  <td className="px-3 py-2"><input aria-label="Remarks" disabled={locked || !canRecord} value={e.remarks} onChange={(ev) => setEdit(r, { remarks: ev.target.value })} className="w-36 rounded border border-line px-1 py-1 text-xs disabled:bg-slate-100" /></td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {dirty && <Button size="sm" loading={save.isPending && save.variables?.id === r.id} onClick={() => save.mutate(r)}>Save</Button>}
                    {locked && can('attendance.correct') && <Button size="sm" variant="secondary" onClick={() => setCorrect(r)}>Correct…</Button>}
                    {r.discrepancy_reason && <Badge tone="warning">Corrected</Badge>}</td>
                </tr>)
            })}</tbody></table></div>)}
      </Card>
      {correct && <CorrectDialog row={correct} onClose={() => setCorrect(null)} onDone={refresh} />}
      {!canRecord && <Alert tone="info">You have read-only access to attendance.</Alert>}
    </div>
  )
}

function CorrectDialog({ row, onClose, onDone }: { row: AttendanceRow; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState(row.status)
  const [cin, setCin] = useState(toManilaInput(row.check_in_at))
  const [cout, setCout] = useState(toManilaInput(row.check_out_at))
  const [reason, setReason] = useState('')
  const go = useMutation({
    mutationFn: async () => { unwrap(await supabase.rpc('correct_attendance', { p_id: row.id, p_status: status, p_check_in: fromManilaInput(cin), p_check_out: fromManilaInput(cout), p_reason: reason })) },
    onSuccess: () => { toast.success('Correction recorded. Linked allowance and CPD records were flagged for review.'); onDone(); onClose() }, onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Modal open title={`Correct verified attendance — ${row.assignments?.person_name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={go.isPending} disabled={!reason.trim()} onClick={() => go.mutate()}>Record correction</Button></>}>
      <div className="space-y-4">
        <Alert tone="warning">Corrections are permanent audit entries. Approved CPD credit and processed allowances linked to this record are flagged for review, never silently changed.</Alert>
        <SelectInput label="Attendance status" value={status} onChange={(e) => setStatus(e.target.value)}>{[...STATUSES.filter((s) => s !== 'not_yet_recorded'), 'voided'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</SelectInput>
        <div className="grid grid-cols-2 gap-3"><TextInput label="Check-in" type="datetime-local" value={cin} onChange={(e) => setCin(e.target.value)} /><TextInput label="Check-out" type="datetime-local" value={cout} onChange={(e) => setCout(e.target.value)} /></div>
        <TextArea label="Reason for correction (required)" value={reason} onChange={(e) => setReason(e.target.value)} required />
      </div>
    </Modal>
  )
}
