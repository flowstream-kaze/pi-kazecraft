/**
 * Creates and edits .xlsx workbooks with ExcelJS, which keeps cell styling when it saves a workbook
 * it opened. It cannot keep charts, pivot tables, slicers or macros; `lossyFeatures` finds them
 * first so the caller can refuse to overwrite a workbook that has them.
 */
import { readFile, writeFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { type RowChange, shiftFormula } from './formula-shift.ts'

/** A cell value from the model: text, a number, true/false, or empty. */
export type CellInput = string | number | boolean | null

export interface SheetInput {
  name: string
  rows: CellInput[][]
  /** Bold the first row and keep it visible while scrolling. */
  header?: boolean
}

export interface SpreadsheetOperation {
  op:
    | 'set_cells'
    | 'set_rows'
    | 'insert_rows'
    | 'delete_rows'
    | 'add_sheet'
    | 'rename_sheet'
    | 'delete_sheet'
  sheet?: string
  /** set_cells: cell address to value, such as { "B2": 42, "C2": "=B2*2" }. */
  cells?: Record<string, CellInput>
  /** set_rows: top-left cell the rows start at (default A1). */
  start?: string
  /** set_rows, insert_rows, add_sheet: the rows to write. */
  rows?: CellInput[][]
  /** insert_rows, delete_rows: 1-based row number. */
  at?: number
  /** delete_rows: how many rows. */
  count?: number
  /** add_sheet, rename_sheet: the new sheet name. */
  name?: string
}

const isoDate =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Turns a model value into an ExcelJS value: "=…" is a formula, an ISO date ("2026-01-31",
 * optionally with a time) is a real date, everything else is stored as given.
 */
export function cellValue(value: CellInput): ExcelJS.CellValue {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return value
  if (value.startsWith('=') && value.length > 1)
    return { formula: value.slice(1) } as ExcelJS.CellFormulaValue
  if (isoDate.test(value)) {
    const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return value
}

/** Stores a value in a cell; a date also gets a date format, or Excel would show a serial number. */
function setCell(cell: ExcelJS.Cell, value: CellInput): void {
  cell.value = cellValue(value)
  if (cell.value instanceof Date) {
    const text = typeof value === 'string' ? value : ''
    cell.numFmt = text.length > 10 ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd'
  }
}

function fillSheet(
  sheet: ExcelJS.Worksheet,
  rows: CellInput[][],
  startRow = 1,
  startColumn = 1,
): void {
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      setCell(sheet.getCell(startRow + rowIndex, startColumn + columnIndex), value)
    })
  })
}

/** Widens each column to its longest value (within reason), since new sheets have no widths. */
function fitColumns(sheet: ExcelJS.Worksheet, rows: CellInput[][]): void {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((value, index) => {
      const text = value === null ? '' : String(value)
      const length = text.startsWith('=') ? 10 : text.length
      widths[index] = Math.max(widths[index] ?? 8, Math.min(60, length + 2))
    })
  }
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width
  })
}

function checkSheetName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A sheet needs a name.')
  if (trimmed.length > 31) throw new Error(`Sheet names are at most 31 characters: "${trimmed}".`)
  if (/[\\/?*[\]:]/.test(trimmed))
    throw new Error(`Sheet names cannot contain \\ / ? * [ ] or : ("${trimmed}").`)
  return trimmed
}

export async function writeSpreadsheet(target: string, sheets: SheetInput[]): Promise<string> {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Pi'
  workbook.created = new Date()
  // Formulas are stored without results; Excel computes them when the file opens.
  workbook.calcProperties = { fullCalcOnLoad: true }
  for (const input of sheets) {
    const sheet = workbook.addWorksheet(checkSheetName(input.name))
    fillSheet(sheet, input.rows)
    fitColumns(sheet, input.rows)
    if (input.header && input.rows.length > 0) {
      sheet.getRow(1).font = { bold: true }
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
    }
  }
  await writeFile(target, Buffer.from(await workbook.xlsx.writeBuffer()))
  const cells = sheets.reduce(
    (total, sheet) => total + sheet.rows.reduce((sum, row) => sum + row.length, 0),
    0,
  )
  return `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}, ${cells} cells`
}

/** Workbook parts ExcelJS drops when it saves, found by looking inside the .xlsx package. */
export async function lossyFeatures(data: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(data)
  const names = Object.keys(zip.files)
  const found: string[] = []
  const has = (pattern: RegExp) => names.some((name) => pattern.test(name))
  if (has(/^xl\/charts\//)) found.push('charts')
  if (has(/^xl\/pivotTables\//) || has(/^xl\/pivotCache\//)) found.push('pivot tables')
  if (has(/^xl\/slicers?\//) || has(/^xl\/slicerCaches\//)) found.push('slicers')
  if (has(/^xl\/vbaProject\.bin$/)) found.push('macros')
  if (has(/^xl\/ctrlProps\//)) found.push('form controls')
  return found
}

function findSheet(workbook: ExcelJS.Workbook, name: string | undefined): ExcelJS.Worksheet {
  if (!name) throw new Error('This operation needs a sheet name.')
  const sheet = workbook.getWorksheet(name)
  if (!sheet) {
    const names = workbook.worksheets.map((candidate) => `"${candidate.name}"`).join(', ')
    throw new Error(`There is no sheet "${name}". Sheets: ${names}.`)
  }
  return sheet
}

/** Updates every formula in the workbook after rows moved on one sheet, as Excel would. */
function shiftWorkbookFormulas(workbook: ExcelJS.Workbook, change: RowChange): number {
  let changed = 0
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value
        if (
          !value || typeof value !== 'object' || !('formula' in value)
          || typeof value.formula !== 'string'
        ) {
          return
        }
        const formula = shiftFormula(value.formula, sheet.name, change)
        if (formula === value.formula) return
        // The cached result is stale now; Excel recalculates on open.
        cell.value = { formula } as ExcelJS.CellFormulaValue
        changed += 1
      })
    })
  }
  return changed
}

function positiveInteger(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a whole number of at least 1.`)
  }
  return value
}

/** Applies the operations in order and saves to `target`. Returns one line per operation. */
export async function editSpreadsheet(
  source: string,
  target: string,
  operations: SpreadsheetOperation[],
): Promise<string[]> {
  if (operations.length === 0) throw new Error('Give at least one operation.')
  const workbook = new ExcelJS.Workbook()
  // ExcelJS's types predate Node's newer Buffer type; the bytes are what it reads.
  await workbook.xlsx.load((await readFile(source)) as unknown as ExcelJS.Buffer)
  const report: string[] = []
  for (const operation of operations) {
    switch (operation.op) {
      case 'set_cells': {
        const sheet = findSheet(workbook, operation.sheet)
        const entries = Object.entries(operation.cells ?? {})
        if (entries.length === 0) throw new Error('set_cells needs cells, such as { "B2": 42 }.')
        for (const [address, value] of entries) {
          if (!/^[A-Z]{1,3}[1-9]\d*$/i.test(address))
            throw new Error(`"${address}" is not a cell address like B2.`)
          setCell(sheet.getCell(address.toUpperCase()), value)
        }
        report.push(
          `Set ${entries.length} cell${entries.length === 1 ? '' : 's'} on "${sheet.name}".`,
        )
        break
      }
      case 'set_rows': {
        const sheet = findSheet(workbook, operation.sheet)
        const rows = operation.rows ?? []
        if (rows.length === 0) throw new Error('set_rows needs rows.')
        const start = sheet.getCell((operation.start ?? 'A1').toUpperCase())
        fillSheet(sheet, rows, Number(start.row), Number(start.col))
        report.push(
          `Wrote ${rows.length} row${
            rows.length === 1
              ? ''
              : 's'
          } on "${sheet.name}" from ${start.address}.`,
        )
        break
      }
      case 'insert_rows': {
        const sheet = findSheet(workbook, operation.sheet)
        const at = positiveInteger(operation.at, 'at')
        const rows = operation.rows ?? []
        if (rows.length === 0) throw new Error('insert_rows needs rows.')
        // Shift formulas first: the rows they point at are still where the formulas expect them.
        const shifted = shiftWorkbookFormulas(workbook, {
          sheet: sheet.name,
          at,
          delta: rows.length,
        })
        // Open up empty rows, then fill them like set_rows so dates get their format.
        sheet.spliceRows(at, 0, ...rows.map(() => []))
        fillSheet(sheet, rows, at, 1)
        report.push(
          `Inserted ${rows.length} row${
            rows.length === 1 ? '' : 's'
          } at row ${at} on "${sheet.name}"${
            shifted ? `; updated ${shifted} formula${shifted === 1 ? '' : 's'}` : ''
          }.`,
        )
        break
      }
      case 'delete_rows': {
        const sheet = findSheet(workbook, operation.sheet)
        const at = positiveInteger(operation.at, 'at')
        const count = positiveInteger(operation.count ?? 1, 'count')
        const shifted = shiftWorkbookFormulas(workbook, { sheet: sheet.name, at, delta: -count })
        sheet.spliceRows(at, count)
        report.push(
          `Deleted ${count} row${count === 1 ? '' : 's'} from row ${at} on "${sheet.name}"${
            shifted ? `; updated ${shifted} formula${shifted === 1 ? '' : 's'}` : ''
          }.`,
        )
        break
      }
      case 'add_sheet': {
        const name = checkSheetName(operation.name ?? '')
        if (workbook.getWorksheet(name)) throw new Error(`A sheet named "${name}" already exists.`)
        const sheet = workbook.addWorksheet(name)
        fillSheet(sheet, operation.rows ?? [])
        fitColumns(sheet, operation.rows ?? [])
        report.push(`Added sheet "${name}".`)
        break
      }
      case 'rename_sheet': {
        const sheet = findSheet(workbook, operation.sheet)
        const name = checkSheetName(operation.name ?? '')
        const previous = sheet.name
        sheet.name = name
        report.push(`Renamed "${previous}" to "${name}".`)
        break
      }
      case 'delete_sheet': {
        const sheet = findSheet(workbook, operation.sheet)
        if (workbook.worksheets.length === 1)
          throw new Error('A workbook must keep at least one sheet.')
        workbook.removeWorksheet(sheet.id)
        report.push(`Deleted sheet "${sheet.name}".`)
        break
      }
      default:
        throw new Error(`Unknown operation "${String((operation as { op: unknown }).op)}".`)
    }
  }
  // Edited formulas lost their cached results; Excel recalculates every formula when it opens the file.
  workbook.calcProperties = { ...workbook.calcProperties, fullCalcOnLoad: true }
  await writeFile(target, Buffer.from(await workbook.xlsx.writeBuffer()))
  return report
}
