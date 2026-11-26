/**
 * Files the composer's attach button accepts. Images travel with the message itself (Pi's image
 * input); documents are saved into the session folder and the message names their path, because
 * Pi reads them with its tools (`read_document` for Office files and PDF, `read` for text).
 */

/** Image types the model can see, matching what Pi's read tool and the composer accept. */
export const imageAttachmentTypes = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
] as const

/** Document extensions Pi can read once the file is in the session folder. */
export const documentAttachmentExtensions = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.xlsm',
  '.xls',
  '.ods',
  '.csv',
  '.tsv',
  '.txt',
  '.md',
  '.json',
] as const

/** The largest document the backend saves. */
export const maxAttachmentBytes = 25 * 1024 * 1024

/** Folder inside the session folder that holds uploaded documents. */
export const attachmentFolderName = '.pi-attachments'

/** The `accept` list for the file picker. */
export const attachmentAccept = [...imageAttachmentTypes, ...documentAttachmentExtensions].join(',')

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function isImageAttachment(file: { name: string; type: string }): boolean {
  return (imageAttachmentTypes as readonly string[]).includes(file.type)
}

export function isDocumentAttachment(name: string): boolean {
  return (documentAttachmentExtensions as readonly string[]).includes(fileExtension(name))
}

/**
 * A safe file name for the attachment folder: the base name only, no characters Windows or other
 * systems reject, and never empty or a reserved device name.
 */
export function safeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = Array
    .from(base, (character) => character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 150)
  const extension = fileExtension(cleaned)
  const stem = extension ? cleaned.slice(0, -extension.length) : cleaned
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)
  const finalStem = !stem || reserved ? `attachment${stem ? `-${stem}` : ''}` : stem
  return `${finalStem}${extension}`
}

/** The message Pi receives: the user's text, then where each attached document was saved. */
export function messageWithAttachments(message: string, paths: readonly string[]): string {
  if (paths.length === 0) return message
  const list = paths.map((path) => `- ${path}`).join('\n')
  const header = paths.length === 1 ? 'Attached file:' : 'Attached files:'
  return message ? `${message}\n\n${header}\n${list}` : `${header}\n${list}`
}
