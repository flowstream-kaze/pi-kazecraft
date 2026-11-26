/**
 * File names a reply mentions (as inline code) that exist on disk, so the page can make them
 * clickable. A name is looked up relative to the chat's folder; an absolute path is used as is.
 * Network paths are left out, so a link in a reply never makes Windows contact another machine.
 */
import { isAbsolute } from 'node:path'
import { resolveWorkspaceFilePath } from '../../workspace-file.ts'
import { expandHomePath } from '../../home-path.ts'

export const maxMentions = 50
const maxMentionLength = 400

/** Whether text looks like a file name or path: something with an extension, on one line. */
export function looksLikeFile(text: string): boolean {
  const value = text.trim()
  if (!value || value.length > maxMentionLength || /[\r\n<>"|?*]/.test(value)) return false
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false // a URL
  return /\.[a-z\d]{1,10}$/i.test(value)
}

export function isNetworkPath(path: string): boolean {
  return /^(\\\\|\/\/)/.test(path)
}

/** The mentions that are existing files, each with its full path. */
export async function findMentionedFiles(
  cwd: string,
  mentions: readonly string[],
): Promise<{ text: string; path: string }[]> {
  const unique = [...new Set(mentions.map((mention) => mention.trim()))]
    .filter(looksLikeFile)
    .slice(0, maxMentions)
  const found = await Promise.all(unique.map(async (text) => {
    if (isNetworkPath(text)) return null
    try {
      const requested = expandHomePath(text)
      const path = await resolveWorkspaceFilePath(cwd, requested, true)
      if (isNetworkPath(path)) return null
      return { text, path }
    } catch {
      return null
    }
  }))
  return found.filter((entry): entry is { text: string; path: string } => entry !== null)
}

/** An existing local file for Open and Show in folder; throws for anything else. */
export async function existingLocalFile(cwd: string, path: string): Promise<string> {
  if (isNetworkPath(path)) throw new Error('Network paths are not opened from replies')
  const resolved = await resolveWorkspaceFilePath(
    cwd,
    isAbsolute(path) ? path : expandHomePath(path),
    true,
  )
  if (isNetworkPath(resolved)) throw new Error('Network paths are not opened from replies')
  return resolved
}
