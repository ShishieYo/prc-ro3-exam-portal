import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, Spinner } from '@/components/ui/ui'
import { Checkbox, SelectInput, TextArea, TextInput } from '@/components/ui/form'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { errorMessage, supabase, unwrap } from '@/lib/supabase'

export type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FieldDef {
  name: string
  label: string
  type?: 'text' | 'number' | 'checkbox' | 'select' | 'textarea' | 'date' | 'time' | 'list'
  options?: { value: string; label: string }[]
  required?: boolean
  hint?: string
  default?: unknown
  /** hide in the edit form when editing an existing row (e.g. parent keys) */
  createOnly?: boolean
}

export interface CrudColumn { header: string; cell: (r: Row) => ReactNode }

/** Generic list + modal editor for simple reference tables. Authorisation is enforced by RLS; `canEdit` only hides controls. */
export function CrudCard({ title, table, select = '*', fields, columns, filter, orderBy = 'created_at', ascending = true, canEdit, canDelete, onSelect, selectedId, emptyHint, fixed, description, queryKey }: {
  title: string; table: string; select?: string; fields: FieldDef[]; columns: CrudColumn[]
  filter?: { column: string; value: string | null }
  orderBy?: string; ascending?: boolean; canEdit: boolean; canDelete?: boolean
  onSelect?: (r: Row) => void; selectedId?: string | null; emptyHint?: string
  /** values always merged into inserts (parent keys) */
  fixed?: Row; description?: string; queryKey?: unknown[]
}) {
  const qc = useQueryClient()
  const key = queryKey ?? ['crud', table, filter?.column, filter?.value]
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const disabled = filter !== undefined && !filter.value
  const list = useQuery({
    queryKey: key, enabled: !disabled,
    queryFn: async () => {
      let q = supabase.from(table).select(select)
      if (filter?.value) q = q.eq(filter.column, filter.value)
      return unwrap(await q.order(orderBy, { ascending })) as unknown as Row[]
    },
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: [key[0]] })
  const save = useMutation({
    mutationFn: async (v: Row) => {
      if (editing === 'new') unwrap(await supabase.from(table).insert({ ...fixed, ...v }).select('id').single())
      else unwrap(await supabase.from(table).update(v).eq('id', (editing as Row).id).select('id').single())
    },
    onSuccess: () => { toast.success('Saved'); invalidate(); setEditing(null) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from(table).delete().eq('id', id); if (error) throw new Error(error.message) },
    onSuccess: () => { toast.success('Deleted'); invalidate() }, onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Card title={title} padded={false} actions={canEdit && !disabled ? <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden /> Add</Button> : undefined}>
      {description && <p className="border-b border-line px-4 py-2 text-xs text-muted">{description}</p>}
      {disabled ? <EmptyState title={emptyHint ?? 'Select an item above'} /> : list.isLoading ? <Spinner /> : list.isError ? <div className="p-4"><ErrorState error={list.error} /></div> : list.data?.length === 0 ? <EmptyState title="Nothing here yet" /> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-muted"><tr>{columns.map((c) => <th key={c.header} className="px-3 py-2 font-medium">{c.header}</th>)}<th className="w-24" /></tr></thead>
          <tbody className="divide-y divide-line">{list.data?.map((r) => (
            <tr key={r.id} className={`${onSelect ? 'cursor-pointer hover:bg-prc-50' : ''} ${selectedId === r.id ? 'bg-prc-50' : ''}`} onClick={() => onSelect?.(r)}>
              {columns.map((c) => <td key={c.header} className="px-3 py-2">{c.cell(r)}</td>)}
              <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>{canEdit && <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                {canDelete && <Button size="sm" variant="ghost" onClick={() => setDeleting(r)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5 text-red-700" /></Button>}</>}</td>
            </tr>))}</tbody></table></div>)}
      {editing && <EditModal title={editing === 'new' ? `Add — ${title}` : `Edit — ${title}`} fields={fields.filter((f) => editing === 'new' || !f.createOnly)} initial={editing === 'new' ? null : editing} busy={save.isPending} onClose={() => setEditing(null)} onSave={(v) => save.mutate(v)} />}
      <ConfirmDialog open={!!deleting} danger title="Delete record" confirmLabel="Delete" message="This cannot be undone. Records already used elsewhere cannot be deleted — deactivate them instead." onClose={() => setDeleting(null)} onConfirm={() => del.mutateAsync(deleting!.id)} />
    </Card>
  )
}

function EditModal({ title, fields, initial, busy, onClose, onSave }: { title: string; fields: FieldDef[]; initial: Row | null; busy: boolean; onClose: () => void; onSave: (v: Row) => void }) {
  const [v, setV] = useState<Row>(() => Object.fromEntries(fields.map((f) => [f.name, initial ? (f.type === 'list' ? (initial[f.name] ?? []).join(', ') : initial[f.name] ?? (f.type === 'checkbox' ? false : '')) : (f.default ?? (f.type === 'checkbox' ? false : ''))])))
  const set = (name: string, val: unknown) => setV((o) => ({ ...o, [name]: val }))
  const submit = () => {
    const out: Row = {}
    for (const f of fields) {
      const x = v[f.name]
      if (f.type === 'number') out[f.name] = x === '' || x === null ? null : Number(x)
      else if (f.type === 'checkbox') out[f.name] = !!x
      else if (f.type === 'list') out[f.name] = String(x).split(',').map((s) => s.trim()).filter(Boolean)
      else out[f.name] = typeof x === 'string' && x.trim() === '' ? null : typeof x === 'string' ? x.trim() : x
    }
    const missing = fields.filter((f) => f.required && (out[f.name] === null || out[f.name] === undefined || out[f.name] === ''))
    if (missing.length) { toast.error(`Required: ${missing.map((m) => m.label).join(', ')}`); return }
    onSave(out)
  }
  return (
    <Modal open title={title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const common = { label: f.label, hint: f.hint, required: f.required }
          if (f.type === 'checkbox') return <Checkbox key={f.name} className="sm:col-span-2" label={f.label} hint={f.hint} checked={!!v[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
          if (f.type === 'select') return <SelectInput key={f.name} {...common} value={v[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)}><option value="">Select…</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectInput>
          if (f.type === 'textarea') return <TextArea key={f.name} {...common} wrapperClassName="sm:col-span-2" value={v[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
          return <TextInput key={f.name} {...common} type={f.type === 'list' ? 'text' : f.type ?? 'text'} value={v[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
        })}
      </div>
    </Modal>
  )
}

export const yesNo = (b: boolean) => (b ? <Badge tone="success">Yes</Badge> : <Badge>No</Badge>)
export const activeBadge = (b: boolean) => (b ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>)
