import { mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Named projects use one portable directory segment beneath the configured project root. */
export function validProjectName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && name === name.trim()
    && !/[<>:"/\\|?*\p{Cc}]/u.test(name) && !name.endsWith('.')
    && !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)
}

/** Where named projects are created: Documents\AI Projects, or PI_PROJECTS_DIR. */
export function projectsRoot(): string {
  return process.env.PI_PROJECTS_DIR ?? join(homedir(), 'Documents', 'AI Projects')
}

export async function projectDirectory(name: string, root = projectsRoot()): Promise<string> {
  if (!validProjectName(name)) throw new Error('Choose a valid project folder name')
  const path = join(root, name)
  await mkdir(path, { recursive: true })
  return realpath(path)
}

/**
 * Whether `path` is a project folder inside the projects root (not the root itself). Only these
 * folders may be moved to the Recycle Bin from the sidebar, so a project added from elsewhere,
 * such as a code repository, can never lose its folder that way.
 */
export async function isProjectFolder(path: string, root = projectsRoot()): Promise<boolean> {
  let canonicalRoot: string
  let canonicalPath: string
  try {
    ;[canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(path)])
  } catch {
    return false
  }
  const inside = relative(canonicalRoot, canonicalPath)
  return inside !== '' && !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside)
}
