import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { documentText } from '../pi-extensions/document-text.ts'
import { shiftFormula } from '../pi-extensions/formula-shift.ts'
import { assertInsideFolder, checkTarget, editTarget } from '../pi-extensions/office-paths.ts'
import {
  editSpreadsheet,
  lossyFeatures,
  writeSpreadsheet,
} from '../pi-extensions/spreadsheet-write.ts'
import { editDocx } from '../pi-extensions/word-edit.ts'
import { markdownToDocx } from '../pi-extensions/word-write.ts'

const folder = await mkdtemp(join(tmpdir(), 'write-office-'))

test('shifts formula references the way Excel does when rows move', () => {
  const insert = { sheet: 'S', at: 3, delta: 2 }
  assert.equal(shiftFormula('SUM(A2:A3)', 'S', insert), 'SUM(A2:A5)')
  assert.equal(shiftFormula('A1+$B$4', 'S', insert), 'A1+$B$6')
  assert.equal(shiftFormula('S!A3*2', 'T', insert), 'S!A5*2')
  assert.equal(
    shiftFormula('A3', 'T', insert),
    'A3',
    'an unqualified reference on another sheet stays',
  )
  assert.equal(shiftFormula('"A3"&A3', 'S', insert), '"A3"&A5', 'text in quotes stays')
  assert.equal(
    shiftFormula('SUM(\'My Sheet\'!B5:B9)', 'X', { sheet: 'My Sheet', at: 4, delta: -2 }),
    'SUM(\'My Sheet\'!B4:B7)',
  )
  assert.equal(shiftFormula('A5+B6', 'S', { sheet: 'S', at: 5, delta: -1 }), '#REF!+B5')
  assert.equal(shiftFormula('SUM(A5:A6)', 'S', { sheet: 'S', at: 5, delta: -2 }), 'SUM(#REF!)')
  assert.equal(shiftFormula('LOG10(A3)', 'S', insert), 'LOG10(A5)', 'a function name is not a cell')
})

test('creates a workbook with formulas, dates and a header row', async () => {
  const path = join(folder, 'budget.xlsx')
  const summary = await writeSpreadsheet(path, [{
    name: 'Budget',
    header: true,
    rows: [['Item', 'Cost', 'Bought'], ['GPU', 699, '2026-11-25'], ['RAM', 89.5, null], [
      'Total',
      '=SUM(B2:B3)',
      null,
    ]],
  }])
  assert.equal(summary, '1 sheet, 12 cells')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const sheet = workbook.getWorksheet('Budget')
  assert.ok(sheet)
  assert.deepEqual(sheet.getCell('B4').value, { formula: 'SUM(B2:B3)' })
  assert.ok(sheet.getCell('C2').value instanceof Date)
  assert.equal(sheet.getRow(1).font?.bold, true)
  // read_document shows the formula, since no result is stored until Excel opens the file.
  assert.match((await documentText(path, 'sheet')).text, /Total,=SUM\(B2:B3\)/)
})

test('edits a workbook in order and updates formulas when rows are inserted', async () => {
  const source = join(folder, 'edit-source.xlsx')
  const target = join(folder, 'edit-target.xlsx')
  await writeSpreadsheet(source, [{ name: 'S', rows: [['x'], [1], [2], ['=SUM(A2:A3)']] }])
  const report = await editSpreadsheet(source, target, [
    { op: 'insert_rows', sheet: 'S', at: 3, rows: [[5]] },
    { op: 'set_cells', sheet: 'S', cells: { B1: 'note' } },
    { op: 'add_sheet', name: 'Extra', rows: [['hi']] },
    { op: 'rename_sheet', sheet: 'Extra', name: 'Info' },
  ])
  assert.equal(report.length, 4)
  assert.match(report[0], /updated 1 formula/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(target)
  assert.deepEqual(workbook.getWorksheet('S')?.getCell('A5').value, { formula: 'SUM(A2:A4)' })
  assert.equal(workbook.getWorksheet('S')?.getCell('B1').value, 'note')
  assert.ok(workbook.getWorksheet('Info'))
  await assert.rejects(
    editSpreadsheet(source, target, [{ op: 'set_cells', sheet: 'Nope', cells: { A1: 1 } }]),
    /no sheet "Nope"/,
  )
})

test('finds the workbook parts that editing would lose', async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('S').getCell('A1').value = 1
  const zip = await JSZip.loadAsync(Buffer.from(await workbook.xlsx.writeBuffer()))
  zip.file('xl/charts/chart1.xml', '<chartSpace/>')
  zip.file('xl/vbaProject.bin', 'macro')
  const data = await zip.generateAsync({ type: 'nodebuffer' })
  assert.deepEqual(await lossyFeatures(data), ['charts', 'macros'])
})

test('creates a Word document from Markdown', async () => {
  const path = join(folder, 'plan.docx')
  await writeFile(
    path,
    await markdownToDocx(
      '# Plan\n\nIntro with **bold** text.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |',
    ),
  )
  const text = (await documentText(path, 'word')).text
  assert.match(text, /^Plan\n\nIntro with bold text\.\n\none\n\ntwo\n\nA\n\nB\n\n1\n\n2$/)
})

test('edits a Word document: replace across runs, append, and add to a section', async () => {
  const original = await markdownToDocx(
    '# Plan\n\nThe **season** starts in March.\n\n## Roster\n\n- Alice\n\n## Budget\n\nTBD.',
  )
  const { data, report } = await editDocx(original, [
    { op: 'replace', find: 'season starts', replace: 'tournament begins' },
    { op: 'append_to_section', heading: 'roster', markdown: '- Bob' },
    { op: 'append', markdown: 'The end.' },
  ])
  assert.deepEqual(report, [
    'Replaced 1 occurrence of "season starts".',
    'Added 1 block to the end of "roster".',
    'Added 1 block at the end of the document.',
  ])
  const path = join(folder, 'edited.docx')
  await writeFile(path, data)
  assert.equal(
    (await documentText(path, 'word')).text,
    'Plan\n\nThe tournament begins in March.\n\nRoster\n\nAlice\n\n•\tBob\n\nBudget\n\nTBD.\n\nThe end.',
  )
  const xml = await (await JSZip.loadAsync(data)).file('word/document.xml')?.async('string') ?? ''
  assert.match(
    xml,
    /<w:b\/>[\s\S]{0,200}tournament begins/,
    'the replaced text keeps the bold of the run it started in',
  )
  await assert.rejects(
    editDocx(original, [{ op: 'replace', find: 'missing', replace: 'x' }]),
    /was not found/,
  )
  await assert.rejects(
    editDocx(original, [{ op: 'append_to_section', heading: 'Nope', markdown: 'x' }]),
    /Headings: "Plan", "Roster", "Budget"/,
  )
})

test('writes only inside the session folder and never overwrites unasked', async () => {
  const inside = join(folder, 'sub', 'new.xlsx')
  await mkdir(join(folder, 'sub'), { recursive: true })
  await assertInsideFolder(inside, folder)
  await assert.rejects(assertInsideFolder(join(folder, '..', 'escape.xlsx'), folder), /outside it/)
  const existing = join(folder, 'exists.docx')
  await writeFile(existing, 'x')
  await assert.rejects(checkTarget(existing, folder, ['.docx'], false), /already exists/)
  await checkTarget(existing, folder, ['.docx'], true)
  await assert.rejects(
    checkTarget(join(folder, 'wrong.txt'), folder, ['.docx'], false),
    /must end in \.docx/,
  )
  assert.equal(
    editTarget(join(folder, 'a.xlsx'), undefined, false, folder),
    join(folder, 'a.edited.xlsx'),
  )
  assert.equal(editTarget(join(folder, 'a.xlsx'), undefined, true, folder), join(folder, 'a.xlsx'))
  assert.equal(
    editTarget(join(folder, 'a.xlsx'), 'out.xlsx', false, folder),
    join(folder, 'out.xlsx'),
  )
  assert.equal(await readFile(existing, 'utf8'), 'x')
})
