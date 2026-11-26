/**
 * Edits an existing .docx in place, touching only what each operation needs so the rest of the
 * document (styles, images, numbering, headers) stays byte-for-byte the same.
 *
 * - `replace` finds text inside a paragraph even when Word split it across runs, and keeps the
 *   formatting of the run where the match starts.
 * - `append` adds Markdown content at the end of the body.
 * - `append_to_section` adds Markdown content at the end of a heading's section (before the next
 *   heading of the same or a higher level).
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { markdownDocumentXml } from './word-write.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

export interface WordOperation {
  op: 'replace' | 'append' | 'append_to_section'
  /** replace: the exact text to find (within one paragraph). */
  find?: string
  /** replace: the new text. */
  replace?: string
  /** replace: change every occurrence (default) or only the first. */
  all?: boolean
  /** replace: ignore letter case when finding. */
  ignoreCase?: boolean
  /** append, append_to_section: the content to add, as Markdown. */
  markdown?: string
  /** append_to_section: the heading text of the section to add to. */
  heading?: string
}

type XmlDocument = ReturnType<DOMParser['parseFromString']>
type XmlElement = ReturnType<XmlDocument['createElementNS']>
type XmlNode = XmlElement['firstChild'] & object

function parse(xml: string): XmlDocument {
  const errors: string[] = []
  const document = new DOMParser({
    onError: (level: string, message: string) => {
      if (level !== 'warning') errors.push(message)
    },
  })
    .parseFromString(xml, 'text/xml')
  if (errors.length > 0) throw new Error(`The document's XML could not be read: ${errors[0]}`)
  return document
}

function serialize(document: XmlDocument): string {
  const xml = new XMLSerializer().serializeToString(document)
  return xml.startsWith('<?xml')
    ? xml
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`
}

function elements(node: XmlNode | XmlDocument, localName: string): XmlElement[] {
  return Array.from((node as XmlElement).getElementsByTagNameNS(W, localName)) as XmlElement[]
}

function children(node: XmlNode): XmlElement[] {
  return Array.from(node.childNodes).filter((child) => child.nodeType === 1) as XmlElement[]
}

/** One piece of a paragraph's text: editable text, or a tab or break that a match cannot cross. */
type Segment = { node: XmlElement; text: string } | { node: null; text: string }

function paragraphSegments(paragraph: XmlElement): Segment[] {
  const segments: Segment[] = []
  const walk = (node: XmlNode): void => {
    for (const child of Array.from(node.childNodes) as XmlNode[]) {
      if (child.nodeType !== 1) continue
      if (child.namespaceURI === W) {
        if (child.localName === 'p') continue
        if (child.localName === 't') {
          segments.push({ node: child as XmlElement, text: child.textContent ?? '' })
          continue
        }
        if (child.localName === 'tab') {
          segments.push({ node: null, text: '\t' })
          continue
        }
        if (child.localName === 'br' || child.localName === 'cr') {
          segments.push({ node: null, text: '\n' })
          continue
        }
        // Deleted text in tracked changes is not part of what the reader sees.
        if (child.localName === 'del' || child.localName === 'delText') continue
      }
      walk(child)
    }
  }
  walk(paragraph)
  return segments
}

function setText(node: XmlElement, text: string): void {
  while (node.firstChild) node.removeChild(node.firstChild)
  const document = node.ownerDocument
  if (!document) throw new Error('A text node is not attached to the document.')
  node.appendChild(document.createTextNode(text))
  node.setAttributeNS(XML_NS, 'xml:space', 'preserve')
}

/** Replaces matches in one paragraph; returns how many it replaced. */
function replaceInParagraph(
  paragraph: XmlElement,
  find: string,
  replacement: string,
  ignoreCase: boolean,
  limit: number,
): number {
  const segments = paragraphSegments(paragraph)
  const text = segments.map((segment) => segment.text).join('')
  const haystack = ignoreCase ? text.toLowerCase() : text
  const needle = ignoreCase ? find.toLowerCase() : find
  const starts: number[] = []
  for (let index = haystack.indexOf(needle); index !== -1 && starts.length < limit;) {
    starts.push(index)
    index = haystack.indexOf(needle, index + needle.length)
  }
  // Offsets of each segment in the paragraph text.
  const offsets: number[] = []
  segments.reduce((offset, segment, index) => {
    offsets[index] = offset
    return offset + segment.text.length
  }, 0)
  let replaced = 0
  // Last match first, so earlier offsets stay valid.
  for (const start of starts.reverse()) {
    const end = start + needle.length
    const touched = segments
      .map((segment, index) => ({
        segment,
        index,
        from: offsets[index],
        to: offsets[index] + segment.text.length,
      }))
      .filter(({ from, to }) => to > start && from < end)
    if (touched.some(({ segment }) => segment.node === null)) continue
    touched.forEach(({ segment, from }, position) => {
      const node = segment.node as XmlElement
      const current = node.textContent ?? ''
      const before = position === 0 ? current.slice(0, start - from) : ''
      const after = position === touched.length - 1 ? current.slice(end - from) : ''
      setText(node, `${before}${position === 0 ? replacement : ''}${after}`)
    })
    replaced += 1
  }
  return replaced
}

function paragraphText(paragraph: XmlElement): string {
  return paragraphSegments(paragraph).map((segment) => segment.text).join('')
}

/** The heading level of a body paragraph (1-9), 0 for Title, or null when it is not a heading. */
function headingLevel(paragraph: XmlElement): number | null {
  if (paragraph.localName !== 'p') return null
  const style = elements(paragraph, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? ''
  if (/^title$/i.test(style)) return 0
  const fromStyle = style.match(/^heading\s?(\d)$/i)
  if (fromStyle) return Number(fromStyle[1])
  const outline = elements(paragraph, 'outlineLvl')[0]?.getAttributeNS(W, 'val')
  return outline !== undefined && outline !== '' ? Number(outline) + 1 : null
}

/** Copies the Markdown's paragraphs and tables into `document` before `reference` (or at the end). */
async function insertMarkdown(
  document: XmlDocument,
  body: XmlElement,
  markdown: string,
  reference: XmlNode | null,
) {
  const source = parse(await markdownDocumentXml(markdown))
  const sourceBody = elements(source, 'body')[0]
  const blocks = children(sourceBody as XmlNode).filter((child) => child.localName !== 'sectPr')
  for (const block of blocks) body.insertBefore(document.importNode(block, true), reference)
  return blocks.length
}

const textParts = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/

/** Applies the operations in order and returns the new .docx and one line per operation. */
export async function editDocx(
  data: Buffer,
  operations: WordOperation[],
): Promise<{ data: Buffer; report: string[] }> {
  if (operations.length === 0) throw new Error('Give at least one operation.')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('This is not a Word .docx file (it could not be opened as one).')
  }
  const mainXml = await zip.file('word/document.xml')?.async('string')
  if (!mainXml) throw new Error('This is not a Word .docx file (word/document.xml is missing).')

  // Parse each part once; every operation works on the same trees.
  const parts = new Map<string, XmlDocument>()
  for (const name of Object.keys(zip.files).filter((name) => textParts.test(name))) {
    parts.set(name, parse((await zip.file(name)?.async('string')) ?? ''))
  }
  const main = parts.get('word/document.xml') as XmlDocument
  const body = elements(main, 'body')[0]
  if (!body) throw new Error('The document has no body.')
  const changed = new Set<string>()
  const report: string[] = []

  for (const operation of operations) {
    if (operation.op === 'replace') {
      const find = operation.find ?? ''
      if (!find) throw new Error('replace needs the text to find.')
      if (/[\n\t]/.test(find)) {
        throw new Error(
          'replace works within one paragraph; the text to find cannot contain line breaks or tabs.',
        )
      }
      const replacement = operation.replace ?? ''
      let remaining = operation.all === false ? 1 : Number.POSITIVE_INFINITY
      let count = 0
      for (const [name, document] of parts) {
        for (const paragraph of elements(document, 'p')) {
          if (remaining <= 0) break
          const done = replaceInParagraph(
            paragraph,
            find,
            replacement,
            operation.ignoreCase === true,
            remaining,
          )
          if (done > 0) changed.add(name)
          count += done
          remaining -= done
        }
      }
      if (count === 0) {
        throw new Error(
          `"${find}" was not found. replace only matches text inside a single paragraph, exactly as written${
            operation.ignoreCase ? '' : ' (letter case counts; pass ignoreCase: true to ignore it)'
          }.`,
        )
      }
      report.push(`Replaced ${count} occurrence${count === 1 ? '' : 's'} of "${find}".`)
      continue
    }

    const markdown = operation.markdown ?? ''
    if (!markdown.trim()) throw new Error(`${operation.op} needs markdown content.`)
    const topLevel = children(body as XmlNode)
    const sectPr = topLevel.find((child) => child.localName === 'sectPr') ?? null

    if (operation.op === 'append') {
      const added = await insertMarkdown(main, body, markdown, sectPr)
      changed.add('word/document.xml')
      report.push(`Added ${added} block${added === 1 ? '' : 's'} at the end of the document.`)
      continue
    }

    if (operation.op === 'append_to_section') {
      const wanted = (operation.heading ?? '').trim().toLowerCase()
      if (!wanted) throw new Error('append_to_section needs the heading text.')
      const headingIndex = topLevel.findIndex((child) =>
        headingLevel(child) !== null && paragraphText(child).trim().toLowerCase() === wanted
      )
      if (headingIndex === -1) {
        const headings = topLevel
          .filter((child) => headingLevel(child) !== null)
          .map((child) => `"${paragraphText(child).trim()}"`)
          .filter((text) => text !== '""')
          .slice(0, 25)
        throw new Error(
          `No heading "${operation.heading}" was found.${
            headings.length
              ? ` Headings: ${headings.join(', ')}.`
              : ' The document has no headings.'
          }`,
        )
      }
      const level = headingLevel(topLevel[headingIndex]) as number
      const next = topLevel.slice(headingIndex + 1).find((child) => {
        if (child.localName === 'sectPr') return true
        const childLevel = headingLevel(child)
        return childLevel !== null && childLevel <= level
      }) ?? null
      const added = await insertMarkdown(main, body, markdown, next)
      changed.add('word/document.xml')
      report.push(
        `Added ${added} block${added === 1 ? '' : 's'} to the end of "${operation.heading}".`,
      )
      continue
    }

    throw new Error(`Unknown operation "${String((operation as { op: unknown }).op)}".`)
  }

  for (const name of changed) zip.file(name, serialize(parts.get(name) as XmlDocument))
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { data: output, report }
}
