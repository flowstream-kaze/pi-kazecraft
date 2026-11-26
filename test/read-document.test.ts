import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as XLSX from 'xlsx'
import {
  documentKind,
  documentText,
  maxBytes,
  pageText,
  unsupportedFormatHint,
} from '../pi-extensions/document-text.ts'

const directory = await mkdtemp(join(tmpdir(), 'read-document-'))

test('recognizes document formats and explains the ones it cannot read', () => {
  assert.equal(documentKind('C:\\docs\\Report.PDF'), 'pdf')
  assert.equal(documentKind('notes.docx'), 'word')
  assert.equal(documentKind('budget.xlsx'), 'sheet')
  assert.equal(documentKind('old.xls'), 'sheet')
  assert.equal(documentKind('table.ods'), 'sheet')
  assert.equal(documentKind('readme.md'), null)
  assert.match(unsupportedFormatHint('letter.doc') ?? '', /\.docx/)
  assert.match(unsupportedFormatHint('deck.pptx') ?? '', /PowerPoint/)
  assert.equal(unsupportedFormatHint('notes.docx'), null)
})

test('pages text by lines and continues from an offset', () => {
  const text = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')
  const first = pageText(text, 1, 4)
  assert.equal(first.text, 'line 1\nline 2\nline 3\nline 4')
  assert.deepEqual([first.firstLine, first.lastLine, first.totalLines, first.more], [
    1,
    4,
    10,
    true,
  ])
  const last = pageText(text, 9, 4)
  assert.equal(last.text, 'line 9\nline 10')
  assert.equal(last.more, false)
  assert.equal(pageText(text, 50).firstLine, 10)
})

test('stops a page at the byte limit and always shows at least part of a line', () => {
  const long = 'x'.repeat(maxBytes * 2)
  const page = pageText(`${long}\nnext`)
  assert.ok(Buffer.byteLength(page.text, 'utf8') <= maxBytes)
  assert.match(page.text, /\[line truncated\]$/)
  assert.equal(page.lastLine, 1)
  assert.equal(page.more, true)
})

test('reads every sheet of a workbook as CSV', async () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['Item', 'Cost'], ['GPU', 699], ['RAM', 89.5]]),
    'Budget',
  )
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['note'], ['ok']]), 'Notes')
  const path = join(directory, 'budget.xlsx')
  await writeFile(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  const result = await documentText(path, 'sheet')
  assert.equal(result.summary, '2 sheets, shown as CSV')
  assert.match(result.text, /--- Sheet: Budget \(A1:B3\) ---\nItem,Cost\nGPU,699\nRAM,89.5/)
  assert.match(result.text, /--- Sheet: Notes \(A1:A2\) ---\nnote\nok/)
})

test('reads the paragraphs of a Word document', async () => {
  const path = join(directory, 'notes.docx')
  await writeFile(path, minimalDocx(['First paragraph.', 'Second paragraph with more words.']))
  const result = await documentText(path, 'word')
  assert.equal(result.text, 'First paragraph.\n\nSecond paragraph with more words.')
  assert.equal(result.summary, '7 words')
  assert.equal(result.warning, undefined)
})

test('reads a PDF page by page', async () => {
  const path = join(directory, 'two-pages.pdf')
  await writeFile(path, minimalPdf(['Hello from page one', 'And page two']))
  const result = await documentText(path, 'pdf')
  assert.equal(result.summary, '2 pages')
  assert.match(result.text, /--- Page 1 of 2 ---\nHello from page one/)
  assert.match(result.text, /--- Page 2 of 2 ---\nAnd page two/)
  assert.equal(result.warning, undefined)
})

test('warns about a PDF without a text layer', async () => {
  const path = join(directory, 'scanned.pdf')
  await writeFile(path, minimalPdf(['']))
  const result = await documentText(path, 'pdf')
  assert.match(result.warning ?? '', /scanned/)
})

test('reports a damaged file instead of returning noise', async () => {
  const path = join(directory, 'broken.docx')
  await writeFile(path, 'not a zip file')
  await assert.rejects(documentText(path, 'word'), /could not be read/)
})

/** Builds the smallest .docx Word and mammoth accept: content types, a relationship and a body. */
function minimalDocx(paragraphs: string[]): Buffer {
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
        paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
      }</w:body></w:document>`,
  }
  const zip = XLSX.CFB.utils.cfb_new()
  for (const [name, content] of Object.entries(files)) {
    XLSX.CFB.utils.cfb_add(zip, name, Buffer.from(content, 'utf8'))
  }
  return Buffer.from(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }) as Uint8Array)
}

/** Builds a valid PDF with one line of Helvetica text per page, and a correct cross-reference table. */
function minimalPdf(pages: string[]): Buffer {
  const objects: string[] = []
  const pageIds = pages.map((_, index) => 4 + index * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${
    pageIds.map((id) => `${id} 0 R`).join(' ')
  }] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  pages.forEach((text, index) => {
    const pageId = pageIds[index]
    const stream = text ? `BT /F1 18 Tf 72 720 Td (${text}) Tj ET` : ''
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${
        pageId + 1
      } 0 R >>`
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
