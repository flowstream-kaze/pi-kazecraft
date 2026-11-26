/**
 * Turns PDF, Word and spreadsheet files into plain text, and pages that text the way Pi's own
 * `read` tool pages a text file. Kept free of Pi's extension API so it can be tested on its own.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

/** File extensions the document reader handles, by the converter that reads them. */
export const documentKinds = {
  pdf: ['.pdf'],
  word: ['.docx'],
  sheet: ['.xlsx', '.xlsm', '.xls', '.ods', '.csv', '.tsv'],
} as const

export type DocumentKind = keyof typeof documentKinds

/** Same limits as Pi's read tool, so a document page is as large as a text-file page. */
export const maxLines = 2000
export const maxBytes = 50 * 1024

export function documentKind(path: string): DocumentKind | null {
  const extension = extname(path).toLowerCase()
  for (const [kind, extensions] of Object.entries(documentKinds)) {
    if ((extensions as readonly string[]).includes(extension)) return kind as DocumentKind
  }
  return null
}

/** Explains formats that look like documents but this reader cannot open. */
export function unsupportedFormatHint(path: string): string | null {
  const extension = extname(path).toLowerCase()
  if (extension === '.doc') {
    return 'Old Word .doc files are not supported; only .docx. Save the file as .docx and try again.'
  }
  if (extension === '.ppt' || extension === '.pptx') {
    return 'PowerPoint files are not supported yet; only PDF, Word (.docx) and spreadsheets.'
  }
  return null
}

export interface DocumentText {
  kind: DocumentKind
  /** The whole document as text, with page or sheet headings. */
  text: string
  /** A short description such as "12 pages" or "3 sheets". */
  summary: string
  /** A warning to show with the text, such as a PDF without a text layer. */
  warning?: string
}

/** Converts a document to text. Throws an Error whose message is meant for the model. */
export async function documentText(path: string, kind: DocumentKind): Promise<DocumentText> {
  const data = await readFile(path)
  if (kind === 'pdf') return pdfText(data)
  if (kind === 'word') return wordText(data)
  return sheetText(data, extname(path).toLowerCase())
}

async function pdfText(data: Buffer): Promise<DocumentText> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  let pages: string[]
  let totalPages: number
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data))
    ;({ totalPages, text: pages } = await extractText(pdf, { mergePages: false }))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (/password/i.test(message))
      throw new Error('This PDF is password-protected and cannot be read.')
    throw new Error(`This PDF could not be read: ${message}`)
  }
  const text = pages
    .map((page, index) => `--- Page ${index + 1} of ${totalPages} ---\n${page.trim()}`)
    .join('\n\n')
  const hasText = pages.some((page) => page.trim().length > 0)
  return {
    kind: 'pdf',
    text,
    summary: `${totalPages} page${totalPages === 1 ? '' : 's'}`,
    warning: hasText
      ? undefined
      : 'No text was found. The PDF is probably scanned images; its pages would need OCR to be read.',
  }
}

async function wordText(data: Buffer): Promise<DocumentText> {
  const mammoth = await import('mammoth')
  const extractRawText = mammoth.extractRawText ?? mammoth.default.extractRawText
  let value: string
  try {
    ;({ value } = await extractRawText({ buffer: data }))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`This Word document could not be read: ${message}`)
  }
  // Word separates paragraphs with blank lines; collapse longer runs so pages hold more content.
  const text = value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const words = text ? text.split(/\s+/).length : 0
  return {
    kind: 'word',
    text,
    summary: `${words.toLocaleString('en-US')} words`,
    warning: text ? undefined : 'The document has no text (it may contain only images).',
  }
}

async function sheetText(data: Buffer, extension: string): Promise<DocumentText> {
  const XLSX = await import('xlsx')
  let workbook: import('xlsx').WorkBook
  try {
    workbook = XLSX.read(data, {
      type: 'buffer',
      dense: true,
      // Dates read as dates, so CSV shows them the way the sheet formats them.
      cellDates: true,
      // Keep cells that hold a formula but no stored result (files saved by tools that do not
      // calculate), so showUncalculatedFormulas can show them.
      sheetStubs: true,
      ...(extension === '.tsv' ? { FS: '\t' } : {}),
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (/password|encrypt/i.test(message)) {
      throw new Error('This spreadsheet is password-protected and cannot be read.')
    }
    throw new Error(`This spreadsheet could not be read: ${message}`)
  }
  const sections = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    if (sheet) showUncalculatedFormulas(sheet)
    const range = sheet?.['!ref'] ?? 'empty'
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trimEnd() : ''
    return `--- Sheet: ${name} (${range}) ---\n${csv || '(empty)'}`
  })
  const count = workbook.SheetNames.length
  return {
    kind: 'sheet',
    text: sections.join('\n\n'),
    summary: `${count} sheet${count === 1 ? '' : 's'}, shown as CSV`,
  }
}

/**
 * A workbook saved by a program that does not calculate (this tool, scripts) stores formulas with
 * no result; Excel computes them on open. Show the formula itself instead of an empty cell.
 */
function showUncalculatedFormulas(sheet: import('xlsx').WorkSheet): void {
  const rows = (sheet as { '!data'?: (import('xlsx').CellObject | undefined)[][] })['!data']
  for (const row of rows ?? []) {
    for (const cell of row ?? []) {
      // A stub ('z') is a cell with no stored result; SheetJS gives it a placeholder value of 0.
      if (cell?.f && (cell.t === 'z' || cell.v === undefined || cell.v === '')) {
        cell.t = 's'
        cell.v = `=${cell.f}`
        cell.w = `=${cell.f}`
      }
    }
  }
}

export interface TextPage {
  text: string
  /** First and last 1-based line numbers shown, and the total line count. */
  firstLine: number
  lastLine: number
  totalLines: number
  /** Whether lines remain after this page. */
  more: boolean
}

/**
 * Returns the lines from `offset` (1-based), at most `limit` lines and `maxBytes` bytes. A single
 * line longer than the byte limit is cut so a page always makes progress.
 */
export function pageText(text: string, offset = 1, limit = maxLines): TextPage {
  const lines = text.split('\n')
  const totalLines = lines.length
  const start = Math.min(Math.max(1, Math.floor(offset)), Math.max(1, totalLines))
  const lineLimit = Math.min(Math.max(1, Math.floor(limit)), maxLines)
  const kept: string[] = []
  let bytes = 0
  for (let index = start - 1; index < totalLines && kept.length < lineLimit; index += 1) {
    const line = lines[index]
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1
    if (bytes + lineBytes > maxBytes) {
      if (kept.length === 0) kept.push(`${truncateBytes(line, maxBytes - 32)} [line truncated]`)
      break
    }
    kept.push(line)
    bytes += lineBytes
  }
  const lastLine = start + kept.length - 1
  return {
    text: kept.join('\n'),
    firstLine: start,
    lastLine,
    totalLines,
    more: lastLine < totalLines,
  }
}

function truncateBytes(text: string, bytes: number): string {
  let result = text.slice(0, bytes)
  while (Buffer.byteLength(result, 'utf8') > bytes) result = result.slice(0, -1)
  return result
}

/** Converted documents, kept while the file is unchanged so paging does not convert again. */
const cache = new Map<string, { key: string; result: DocumentText }>()
const cacheSize = 8

export async function cachedDocumentText(path: string, kind: DocumentKind): Promise<DocumentText> {
  const info = await stat(path)
  const key = `${info.size}:${info.mtimeMs}`
  const hit = cache.get(path)
  if (hit?.key === key) return hit.result
  const result = await documentText(path, kind)
  cache.delete(path)
  cache.set(path, { key, result })
  while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string)
  return result
}
