/** Neutralise spreadsheet formula injection: values that start with = + - @ TAB CR are prefixed with an apostrophe. */
export function safeCell(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return v
  const s = String(v)
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

export interface Column<T> {
  header: string
  value: (row: T) => unknown
}

function quote(v: string | number | boolean): string {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const lines = [columns.map((c) => quote(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => quote(safeCell(c.value(r)))).join(','))
  return '﻿' + lines.join('\r\n')
}

/** RFC 4180 parser (quoted fields, embedded commas/newlines, escaped quotes). Returns rows of strings. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cur); cur = ''
      rows.push(row); row = []
    } else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Only letters, digits, dash and underscore in the base name; always has the given extension. */
export function safeFilename(name: string, ext: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'export'
  return `${base}.${ext}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadCsv<T>(rows: T[], columns: Column<T>[], name: string) {
  downloadBlob(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), safeFilename(`${name}-${new Date().toISOString().slice(0, 10)}`, 'csv'))
}
