import { parseCsv, safeCell, safeFilename, type Column } from './csv'

export async function downloadXlsx<T>(rows: T[], columns: Column<T>[], name: string) {
  const data = [
    columns.map((c) => ({ value: c.header, fontWeight: 'bold' as const })),
    ...rows.map((r) => columns.map((c) => {
      const v = safeCell(c.value(r))
      return v === '' ? null : v
    })),
  ]
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  await writeXlsxFile(data).toFile(safeFilename(`${name}-${new Date().toISOString().slice(0, 10)}`, 'xlsx'))
}

export type RawRow = Record<string, string>

/** Reads the first sheet of a CSV or XLSX file into header-keyed rows. Headers are lowercased and trimmed. */
export async function readTabularFile(file: File): Promise<RawRow[]> {
  const isCsv = /\.csv$/i.test(file.name)
  const isXlsx = /\.xlsx$/i.test(file.name)
  if (!isCsv && !isXlsx) throw new Error('Unsupported file type. Upload a .csv or .xlsx file.')
  if (file.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.')
  const grid: unknown[][] = isCsv ? parseCsv(await file.text()) : ((await (await import('read-excel-file/browser')).readSheet(file)) as unknown as unknown[][])
  if (grid.length < 2) throw new Error('The file has no data rows.')
  const headers = grid[0].map((h) => String(h ?? '').trim().toLowerCase())
  return grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] === null || r[i] === undefined ? '' : String(r[i]).trim()])))
}
