import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Search } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { downloadCsv, type Column } from '@/lib/csv'
import { downloadXlsx } from '@/lib/xlsx'
import type { PageParams, PageResult } from '@/lib/query'
import { supabase } from '@/lib/supabase'
import { Button, EmptyState, ErrorState, Spinner } from './ui'
import { toast } from './Toast'

export interface Col<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** database column to sort by; omit for non-sortable columns */
  sort?: string
  className?: string
  defaultHidden?: boolean
}

export interface DataTableProps<T> {
  /** include every filter value in the key so changing a filter refetches */
  queryKey: unknown[]
  fetchPage: (p: PageParams) => Promise<PageResult<T>>
  columns: Col<T>[]
  rowKey: (row: T) => string
  searchPlaceholder?: string
  filters?: ReactNode
  toolbar?: ReactNode
  defaultSort?: { column: string; asc: boolean }
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyHint?: string
  /** when set (and the user holds reports.export) the filtered result set can be exported */
  exportAs?: { name: string; columns: Column<T>[] }
  hideSearch?: boolean
}

const PAGE_SIZES = [10, 25, 50, 100]

export function DataTable<T>(props: DataTableProps<T>) {
  const { can } = useAuth()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ column: string; asc: boolean } | null>(props.defaultSort ?? null)
  const [hidden, setHidden] = useState<Set<string>>(new Set(props.columns.filter((c) => c.defaultHidden).map((c) => c.key)))
  const [colsOpen, setColsOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])
  const filterKey = JSON.stringify(props.queryKey)
  useEffect(() => { setPage(0) }, [filterKey])

  const params: PageParams = { page, pageSize, search, sort }
  const q = useQuery({
    queryKey: [...props.queryKey, params],
    queryFn: () => props.fetchPage(params),
    placeholderData: (prev) => prev,
  })

  const visible = props.columns.filter((c) => !hidden.has(c.key))
  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))

  const toggleSort = (col?: string) => {
    if (!col) return
    setSort((s) => (s?.column === col ? { column: col, asc: !s.asc } : { column: col, asc: true }))
  }

  const doExport = async (kind: 'csv' | 'xlsx') => {
    if (!props.exportAs) return
    try {
      const all = await props.fetchPage({ page: 0, pageSize: 5000, search, sort })
      const { error } = await supabase.rpc('log_export', { p_report: props.exportAs.name, p_filters: { search, rows: all.rows.length } })
      if (error) throw new Error(error.message)
      if (kind === 'csv') downloadCsv(all.rows, props.exportAs.columns, props.exportAs.name)
      else await downloadXlsx(all.rows, props.exportAs.columns, props.exportAs.name)
      toast.success(`Exported ${all.rows.length} row(s). Export recorded in the audit log.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <div className="rounded-lg border border-line bg-white shadow-sm">
      <div className="no-print flex flex-wrap items-end gap-3 border-b border-line p-3">
        {!props.hideSearch && (
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={props.searchPlaceholder ?? 'Search…'}
              className="w-full rounded-md border border-line py-2 pl-8 pr-3 text-sm" />
          </label>
        )}
        {props.filters}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {props.toolbar}
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen}><Columns3 className="h-4 w-4" aria-hidden /> Columns</Button>
            {colsOpen && (
              <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-line bg-white p-2 shadow-lg">
                {props.columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-1 py-1 text-sm">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n })} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          {props.exportAs && can('reports.export') && (
            <>
              <Button size="sm" variant="secondary" onClick={() => doExport('csv')}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
              <Button size="sm" variant="secondary" onClick={() => doExport('xlsx')}><Download className="h-4 w-4" aria-hidden /> Excel</Button>
            </>
          )}
        </div>
      </div>

      {q.isError ? (
        <div className="p-4"><ErrorState error={q.error} retry={() => q.refetch()} /></div>
      ) : q.isLoading ? (
        <Spinner />
      ) : q.data && q.data.rows.length === 0 ? (
        <EmptyState title={props.emptyTitle ?? 'No records found'} hint={props.emptyHint ?? (search ? 'Try a different search or clear the filters.' : undefined)} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                {visible.map((c) => (
                  <th key={c.key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium" aria-sort={sort && sort.column === c.sort ? (sort.asc ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink" onClick={() => toggleSort(c.sort)}>
                        {c.header}
                        {sort?.column === c.sort && (sort.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data?.rows.map((r) => (
                <tr key={props.rowKey(r)} className={props.onRowClick ? 'cursor-pointer hover:bg-prc-50' : ''} onClick={() => props.onRowClick?.(r)}>
                  {visible.map((c) => <td key={c.key} className={`px-3 py-2 align-top ${c.className ?? ''}`}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
        <span>{total.toLocaleString()} record(s){q.isFetching ? ' · updating…' : ''}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">Rows
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }} className="rounded border border-line px-1 py-0.5">
              {PAGE_SIZES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
          <span>Page {page + 1} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  )
}
