import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { Type } from 'typebox'
import {
  cachedDocumentText,
  documentKind,
  maxBytes,
  maxLines,
  pageText,
  unsupportedFormatHint,
} from './document-text.ts'

const toolName = 'read_document'

/**
 * Registers `read_document`, which reads PDF, Word (.docx) and spreadsheet files as text. Pi's own
 * `read` tool handles text and images only; these formats are binary and read as gibberish there.
 */
export default function registerReadDocument(pi: ExtensionAPI): void {
  pi.registerTool({
    name: toolName,
    label: 'Read Document',
    description:
      `Read a PDF, Word (.docx) or spreadsheet (.xlsx, .xlsm, .xls, .ods, .csv, .tsv) file as text. PDFs are split into pages, spreadsheets into sheets shown as CSV. Output is limited to ${maxLines} lines or ${
        maxBytes / 1024
      }KB per call; continue with offset until complete.`,
    promptSnippet: 'Read PDF, Word (.docx) and spreadsheet files as text',
    promptGuidelines: [
      'Use read_document, not read, for .pdf, .docx, .xlsx, .xlsm, .xls and .ods files; read shows them as binary noise.',
    ],
    parameters: Type.Object({
      path: Type.String({
        description: 'Path to the document, absolute or relative to the working folder',
      }),
      offset: Type.Optional(
        Type.Number({ description: 'Line number to start reading from (1-based)', minimum: 1 }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: `Maximum number of lines to read (at most ${maxLines})`,
          minimum: 1,
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const path = resolvePath(params.path, ctx.cwd)
      const hint = unsupportedFormatHint(path)
      if (hint) throw new Error(hint)
      const kind = documentKind(path)
      if (!kind) {
        throw new Error(
          `${params.path} is not a PDF, Word (.docx) or spreadsheet file. Use read for text files and images.`,
        )
      }
      try {
        await access(path)
      } catch {
        throw new Error(`File not found: ${path}`)
      }

      const document = await cachedDocumentText(path, kind)
      const page = pageText(document.text, params.offset, params.limit)
      const header = `${path} (${document.summary})`
      const position = page.more
        ? `[Lines ${page.firstLine}-${page.lastLine} of ${page.totalLines}. Use offset=${
          page.lastLine + 1
        } to continue.]`
        : page.firstLine > 1
        ? `[Lines ${page.firstLine}-${page.lastLine} of ${page.totalLines}; end of document.]`
        : ''
      const text = [
        header,
        document.warning ? `Note: ${document.warning}` : '',
        page.text,
        position,
      ]
        .filter(Boolean)
        .join('\n\n')
      return {
        content: [{ type: 'text', text }],
        details: {
          kind: document.kind,
          summary: document.summary,
          firstLine: page.firstLine,
          lastLine: page.lastLine,
          totalLines: page.totalLines,
        },
      }
    },
  })
}

/** Resolves `~`, relative and absolute paths the way Pi's file tools do. */
function resolvePath(path: string, cwd: string): string {
  const trimmed = path.trim().replace(/^@/, '')
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\'))
    return resolve(
      homedir(),
      trimmed.slice(2),
    )
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed)
}
