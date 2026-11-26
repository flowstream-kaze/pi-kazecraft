import { type FileHandle, mkdir, open, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  attachmentFolderName,
  fileExtension,
  isDocumentAttachment,
  maxAttachmentBytes,
  safeAttachmentName,
} from '../../../shared/attachments.ts'

export class AttachmentError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Saves an uploaded document into `<workspace>/.pi-attachments/` and returns its full path.
 * `workspace` must already be a canonical, existing directory. An existing file is never replaced:
 * a second "report.pdf" is saved as "report (2).pdf". The folder carries its own .gitignore so
 * attachments never show up as changes in the project's Git panel.
 */
export async function saveAttachment(
  workspace: string,
  originalName: string,
  body: Readable,
  declaredLength?: number,
): Promise<string> {
  if (!isDocumentAttachment(originalName)) {
    throw new AttachmentError(415, `${originalName} is not a file type Pi can read.`)
  }
  if (declaredLength !== undefined && declaredLength > maxAttachmentBytes) {
    throw new AttachmentError(413, `Files are limited to ${maxAttachmentBytes / 1024 / 1024} MB.`)
  }
  const folder = join(workspace, attachmentFolderName)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => undefined)

  const { handle, path } = await reserveName(folder, safeAttachmentName(originalName))
  let size = 0
  const limit = async function*(source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      size += chunk.length
      if (size > maxAttachmentBytes) {
        throw new AttachmentError(
          413,
          `Files are limited to ${maxAttachmentBytes / 1024 / 1024} MB.`,
        )
      }
      yield chunk
    }
  }
  try {
    // The stream owns the handle and closes it once, whether the copy finishes or fails.
    await pipeline(body, limit, handle.createWriteStream())
    if ((await stat(path)).size === 0) throw new AttachmentError(400, `${originalName} is empty.`)
    return path
  } catch (error) {
    await rm(path, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Creates the file exclusively ('wx'), trying "name (2).ext" and so on when the name is taken, so
 * the upload stream is read only once and two uploads with the same name never overwrite each other.
 */
async function reserveName(
  folder: string,
  name: string,
): Promise<{ handle: FileHandle; path: string }> {
  const extension = fileExtension(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const path = join(folder, attempt === 1 ? name : `${stem} (${attempt})${extension}`)
    try {
      return { handle: await open(path, 'wx'), path }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new AttachmentError(409, 'Too many files with this name; rename the file and try again.')
}
