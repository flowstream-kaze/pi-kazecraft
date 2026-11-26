import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Type } from 'typebox'
import { checkTarget, editTarget, exists, resolvePath } from './office-paths.ts'
import { editSpreadsheet, lossyFeatures, writeSpreadsheet } from './spreadsheet-write.ts'
import { editDocx } from './word-edit.ts'
import { markdownToDocx } from './word-write.ts'

const cellValue = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
const rows = Type.Array(Type.Array(cellValue), {
  description:
    'Rows of cell values. A string starting with "=" is a formula ("=SUM(B2:B9)"); an ISO date ("2026-01-31") becomes a real date.',
})
const overwrite = Type.Optional(
  Type.Boolean({
    description: 'Replace the file if it exists. Only when the user asked to overwrite.',
  }),
)

function done(text: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], details }
}

/**
 * Registers the Word and Excel writing tools. All of them write only inside the session folder and
 * never replace an existing file unless the call says `overwrite: true`; edits go to a copy
 * (`name.edited.ext`) unless told otherwise.
 */
export default function registerWriteOffice(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'write_spreadsheet',
    label: 'Write Spreadsheet',
    description:
      'Create a new Excel workbook (.xlsx) from sheets of rows. Formulas and dates are stored as real formulas and dates. Fails if the file exists unless overwrite is true.',
    promptSnippet: 'Create Excel (.xlsx) workbooks',
    promptGuidelines: [
      'Use write_spreadsheet to create .xlsx files and edit_spreadsheet to change existing ones; use read_document to read them first.',
    ],
    parameters: Type.Object({
      path: Type.String({
        description: 'Where to save, ending in .xlsx, inside the working folder',
      }),
      sheets: Type.Array(
        Type.Object({
          name: Type.String({ description: 'Sheet name (at most 31 characters)' }),
          rows,
          header: Type.Optional(Type.Boolean({ description: 'Bold the first row and freeze it' })),
        }),
        { minItems: 1 },
      ),
      overwrite,
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const target = resolvePath(params.path, ctx.cwd)
      await checkTarget(target, ctx.cwd, ['.xlsx'], params.overwrite === true)
      const summary = await writeSpreadsheet(target, params.sheets)
      return done(`Saved ${target} (${summary}).`, { path: target, summary })
    },
  })

  pi.registerTool({
    name: 'edit_spreadsheet',
    label: 'Edit Spreadsheet',
    description:
      'Change an existing .xlsx workbook, keeping its cell styling. Operations run in order: set_cells {sheet, cells: {"B2": value}}, set_rows {sheet, start: "A1", rows}, insert_rows {sheet, at, rows}, delete_rows {sheet, at, count}, add_sheet {name, rows?}, rename_sheet {sheet, name}, delete_sheet {sheet}. Formulas are updated when rows move. Saves to a copy named <name>.edited.xlsx unless output is given or overwrite is true. Charts, pivot tables, slicers and macros cannot be kept; a workbook with them is never overwritten in place.',
    promptSnippet: 'Edit existing Excel (.xlsx) workbooks',
    parameters: Type.Object({
      path: Type.String({ description: 'The workbook to edit (.xlsx)' }),
      operations: Type.Array(
        Type.Object({
          op: Type.Union([
            Type.Literal('set_cells'),
            Type.Literal('set_rows'),
            Type.Literal('insert_rows'),
            Type.Literal('delete_rows'),
            Type.Literal('add_sheet'),
            Type.Literal('rename_sheet'),
            Type.Literal('delete_sheet'),
          ]),
          sheet: Type.Optional(Type.String({ description: 'The sheet to change' })),
          cells: Type.Optional(
            Type.Record(Type.String(), cellValue, { description: 'set_cells: {"B2": 42}' }),
          ),
          start: Type.Optional(Type.String({ description: 'set_rows: top-left cell, default A1' })),
          rows: Type.Optional(rows),
          at: Type.Optional(
            Type.Number({ description: 'insert_rows, delete_rows: 1-based row number' }),
          ),
          count: Type.Optional(
            Type.Number({ description: 'delete_rows: how many rows (default 1)' }),
          ),
          name: Type.Optional(
            Type.String({ description: 'add_sheet, rename_sheet: the new sheet name' }),
          ),
        }),
        { minItems: 1 },
      ),
      output: Type.Optional(
        Type.String({ description: 'Where to save the result (.xlsx); default: a copy' }),
      ),
      overwrite,
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const source = resolvePath(params.path, ctx.cwd)
      if (!(await exists(source))) throw new Error(`File not found: ${source}`)
      const extension = extname(source).toLowerCase()
      if (extension !== '.xlsx' && extension !== '.xlsm') {
        throw new Error(
          'edit_spreadsheet edits .xlsx workbooks. For .xls, .ods or .csv, read it with read_document and create a new .xlsx with write_spreadsheet.',
        )
      }
      const overwriteRequested = params.overwrite === true
      const target = editTarget(source, params.output, overwriteRequested, ctx.cwd)
      await checkTarget(target, ctx.cwd, ['.xlsx'], overwriteRequested)
      const lost = await lossyFeatures(await readFile(source))
      if (lost.length > 0 && target === source) {
        throw new Error(
          `This workbook has ${
            lost.join(', ')
          }, which editing cannot keep. It was not changed. Save the edit to a copy instead (leave out overwrite, or give an output path).`,
        )
      }
      const report = await editSpreadsheet(source, target, params.operations)
      const warning = lost.length > 0
        ? `\nNote: the original has ${
          lost.join(', ')
        }; the edited copy does not. The original is unchanged.`
        : ''
      return done(`Saved ${target}.\n${report.join('\n')}${warning}`, {
        path: target,
        report,
        lost,
      })
    },
  })

  pi.registerTool({
    name: 'write_document',
    label: 'Write Document',
    description:
      'Create a new Word document (.docx) from Markdown: headings, paragraphs, bold, italic, strikethrough, code, links, bullet and numbered lists, tables, block quotes and horizontal rules. Fails if the file exists unless overwrite is true.',
    promptSnippet: 'Create Word (.docx) documents from Markdown',
    promptGuidelines: [
      'Use write_document to create .docx files from Markdown and edit_document to change existing ones; use read_document to read them first.',
    ],
    parameters: Type.Object({
      path: Type.String({
        description: 'Where to save, ending in .docx, inside the working folder',
      }),
      markdown: Type.String({ description: 'The document content as Markdown' }),
      title: Type.Optional(
        Type.String({ description: 'Document title property (default: the first heading)' }),
      ),
      overwrite,
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const target = resolvePath(params.path, ctx.cwd)
      await checkTarget(target, ctx.cwd, ['.docx'], params.overwrite === true)
      await writeFile(target, await markdownToDocx(params.markdown, params.title))
      return done(`Saved ${target}.`, { path: target })
    },
  })

  pi.registerTool({
    name: 'edit_document',
    label: 'Edit Document',
    description:
      'Change an existing Word document (.docx) without disturbing the rest of it. Operations run in order: replace {find, replace, all?, ignoreCase?} changes text within paragraphs and keeps its formatting; append {markdown} adds content at the end; append_to_section {heading, markdown} adds content at the end of that heading\'s section. Saves to a copy named <name>.edited.docx unless output is given or overwrite is true.',
    promptSnippet: 'Edit existing Word (.docx) documents',
    parameters: Type.Object({
      path: Type.String({ description: 'The document to edit (.docx)' }),
      operations: Type.Array(
        Type.Object({
          op: Type.Union([
            Type.Literal('replace'),
            Type.Literal('append'),
            Type.Literal('append_to_section'),
          ]),
          find: Type.Optional(
            Type.String({ description: 'replace: exact text to find, within one paragraph' }),
          ),
          replace: Type.Optional(Type.String({ description: 'replace: the new text' })),
          all: Type.Optional(
            Type.Boolean({ description: 'replace: every occurrence (default true)' }),
          ),
          ignoreCase: Type.Optional(Type.Boolean({ description: 'replace: ignore letter case' })),
          markdown: Type.Optional(
            Type.String({ description: 'append, append_to_section: content as Markdown' }),
          ),
          heading: Type.Optional(
            Type.String({ description: 'append_to_section: the heading text' }),
          ),
        }),
        { minItems: 1 },
      ),
      output: Type.Optional(
        Type.String({ description: 'Where to save the result (.docx); default: a copy' }),
      ),
      overwrite,
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const source = resolvePath(params.path, ctx.cwd)
      if (!(await exists(source))) throw new Error(`File not found: ${source}`)
      if (extname(source).toLowerCase() !== '.docx') {
        throw new Error(
          'edit_document edits .docx files only. Old .doc files must be saved as .docx first.',
        )
      }
      const overwriteRequested = params.overwrite === true
      const target = editTarget(source, params.output, overwriteRequested, ctx.cwd)
      await checkTarget(target, ctx.cwd, ['.docx'], overwriteRequested)
      const { data, report } = await editDocx(await readFile(source), params.operations)
      await writeFile(target, data)
      return done(`Saved ${target}.\n${report.join('\n')}`, { path: target, report })
    },
  })
}
