/* eslint-disable @typescript-eslint/no-explicit-any */
// PostgREST builders are deeply generic; this thin helper keeps paging/search logic in one place.
export type Builder = any

export interface PageParams {
  page: number
  pageSize: number
  search: string
  sort: { column: string; asc: boolean } | null
}

export interface PageResult<T> { rows: T[]; total: number }

/** Remove characters that have meaning inside a PostgREST `or=(...)` filter. */
export function sanitizeSearch(s: string): string {
  return s.replace(/[,()%*\\]/g, ' ').trim()
}

export function applyPage(q: Builder, p: PageParams, searchCols: string[], fallbackSort?: { column: string; asc: boolean }): Builder {
  const term = sanitizeSearch(p.search)
  if (term && searchCols.length) q = q.or(searchCols.map((c) => `${c}.ilike.%${term}%`).join(','))
  const sort = p.sort ?? fallbackSort
  if (sort) q = q.order(sort.column, { ascending: sort.asc })
  const from = p.page * p.pageSize
  return q.range(from, from + p.pageSize - 1)
}

export async function runPage<T>(q: Builder): Promise<PageResult<T>> {
  const { data, error, count } = await q
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as T[], total: count ?? 0 }
}
