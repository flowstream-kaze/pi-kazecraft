/**
 * Builds Word documents from Markdown with the `docx` library: headings, paragraphs, bold, italic,
 * strikethrough, code, links, bullet and numbered lists, tables, block quotes and rules.
 *
 * `embedded` mode produces paragraphs meant to be inserted into an existing document: it uses no
 * numbering definitions or hyperlink relationships (which the target would not have), so lists get
 * text bullets and links show their address.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { BlockContent, DefinitionContent, PhrasingContent, Root, RootContent } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

type Block = Paragraph | Table
type Run = TextRun | ExternalHyperlink

interface Style {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
}

interface Context {
  embedded: boolean
  /** Each numbered list gets its own numbering instance so it starts at 1. */
  nextListInstance: number
}

const headingLevels = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const

const codeFont = 'Consolas'
const numberedList = 'pi-numbered-list'
const bulletGlyphs = ['•', '◦', '▪']

export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

function runs(nodes: PhrasingContent[], style: Style, context: Context): Run[] {
  return nodes.flatMap((node): Run[] => {
    switch (node.type) {
      case 'text':
        return [textRun(node.value, style)]
      case 'strong':
        return runs(node.children, { ...style, bold: true }, context)
      case 'emphasis':
        return runs(node.children, { ...style, italics: true }, context)
      case 'delete':
        return runs(node.children, { ...style, strike: true }, context)
      case 'inlineCode':
        return [textRun(node.value, { ...style, code: true })]
      case 'break':
        return [new TextRun({ break: 1 })]
      case 'link': {
        const label = runs(node.children, style, context)
        if (context.embedded) return [...label, textRun(` (${node.url})`, style)]
        return [
          new ExternalHyperlink({
            link: node.url,
            children: runs(node.children, style, context).map((run) =>
              run instanceof TextRun ? run : textRun('', style)
            ),
          }),
        ]
      }
      case 'image':
        return [textRun(`[Image: ${node.alt || node.url}]`, { ...style, italics: true })]
      case 'html':
        return [textRun(node.value, style)]
      default:
        return 'children' in node ? runs(node.children as PhrasingContent[], style, context) : []
    }
  })
}

function textRun(text: string, style: Style): TextRun {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    ...(style.code
      ? { font: codeFont, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } }
      : {}),
  })
}

function blocks(
  nodes: (RootContent | BlockContent | DefinitionContent)[],
  context: Context,
  indent = 0,
): Block[] {
  return nodes.flatMap((node): Block[] => {
    switch (node.type) {
      case 'heading':
        return [
          new Paragraph({
            heading: headingLevels[Math.min(node.depth, 6) - 1],
            children: runs(node.children, {}, context),
          }),
        ]
      case 'paragraph':
        return [
          new Paragraph({
            children: runs(node.children, {}, context),
            ...(indent ? { indent: { left: indent } } : {}),
          }),
        ]
      case 'list':
        return listBlocks(node.children, Boolean(node.ordered), node.start ?? 1, context, 0)
      case 'table':
        return [tableBlock(node.children, context)]
      case 'code':
        return node.value.split('\n').map((line) =>
          new Paragraph({
            spacing: { after: 0 },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' },
            children: [new TextRun({ text: line || ' ', font: codeFont })],
          })
        )
      case 'blockquote':
        return node.children.flatMap((child) =>
          child.type === 'paragraph'
            ? [
              new Paragraph({
                indent: { left: 567 },
                border: {
                  left: { style: BorderStyle.SINGLE, size: 12, color: 'BFBFBF', space: 8 },
                },
                children: runs(child.children, { italics: true }, context),
              }),
            ]
            : blocks([child], context, 567)
        )
      case 'thematicBreak':
        return [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } },
            children: [],
          }),
        ]
      case 'html':
        return [new Paragraph({ children: [textRun(node.value, {})] })]
      default:
        return []
    }
  })
}

function listBlocks(
  items: import('mdast').ListItem[],
  ordered: boolean,
  start: number,
  context: Context,
  level: number,
): Block[] {
  const instance = context.nextListInstance++
  return items.flatMap((item, index) => {
    const [first, ...rest] = item.children
    const firstRuns = first?.type === 'paragraph' ? runs(first.children, {}, context) : []
    const checkbox = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : ''
    let paragraph: Paragraph
    if (context.embedded || (!ordered && level > 2)) {
      const marker = ordered ? `${start + index}.` : bulletGlyphs[level % bulletGlyphs.length]
      paragraph = new Paragraph({
        indent: { left: 360 * (level + 1), hanging: 360 },
        children: [new TextRun(`${marker}\t${checkbox}`), ...firstRuns],
      })
    } else if (ordered) {
      paragraph = new Paragraph({
        numbering: { reference: numberedList, level: Math.min(level, 8), instance },
        children: [...(checkbox ? [new TextRun(checkbox)] : []), ...firstRuns],
      })
    } else {
      paragraph = new Paragraph({
        bullet: { level: Math.min(level, 8) },
        children: [...(checkbox ? [new TextRun(checkbox)] : []), ...firstRuns],
      })
    }
    const nested = (first?.type === 'paragraph' ? rest : item.children).flatMap((child) =>
      child.type === 'list'
        ? listBlocks(child.children, Boolean(child.ordered), child.start ?? 1, context, level + 1)
        : blocks([child], context, 360 * (level + 1))
    )
    return [paragraph, ...nested]
  })
}

function tableBlock(rows: import('mdast').TableRow[], context: Context): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: rows.map((row, rowIndex) =>
      new TableRow({
        tableHeader: rowIndex === 0,
        children: row.children.map((cell) =>
          new TableCell({
            ...(rowIndex === 0
              ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } }
              : {}),
            children: [
              new Paragraph({ children: runs(cell.children, { bold: rowIndex === 0 }, context) }),
            ],
          })
        ),
      })
    ),
  })
}

/** The document blocks for some Markdown. */
export function markdownBlocks(markdown: string, embedded = false): Block[] {
  return blocks(parseMarkdown(markdown).children, { embedded, nextListInstance: 1 })
}

/** Builds a complete .docx from Markdown. */
export async function markdownToDocx(markdown: string, title?: string): Promise<Buffer> {
  const children = markdownBlocks(markdown)
  if (children.length === 0) throw new Error('The Markdown has no content to write.')
  const document = new Document({
    creator: 'Pi',
    title: title ?? firstHeading(markdown) ?? 'Document',
    numbering: {
      config: [
        {
          reference: numberedList,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [
              LevelFormat.DECIMAL,
              LevelFormat.LOWER_LETTER,
              LevelFormat.LOWER_ROMAN,
            ][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  })
  return Packer.toBuffer(document)
}

function firstHeading(markdown: string): string | undefined {
  return markdown.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim()
}

/**
 * A `word/document.xml` whose body holds the Markdown as embedded-mode paragraphs and tables,
 * ready to be copied into another document. Built by packing a document and reading it back.
 */
export async function markdownDocumentXml(markdown: string): Promise<string> {
  const children = markdownBlocks(markdown, true)
  if (children.length === 0) throw new Error('The Markdown has no content to insert.')
  const packed = await Packer.toBuffer(new Document({ sections: [{ children }] }))
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(packed)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('Could not build the content to insert.')
  return xml
}
