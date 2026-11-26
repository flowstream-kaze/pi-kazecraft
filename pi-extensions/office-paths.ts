/**
 * Where the Word and Excel writing tools may write: only inside the session's working folder, and
 * never over an existing file unless the caller passes `overwrite: true`.
 */
import { access, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

/** Resolves `~`, `@`-prefixed, relative and absolute paths the way Pi's file tools do. */
export function resolvePath(path: string, cwd: string): string {
  const trimmed = path.trim().replace(/^@/, '')
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\'))
    return resolve(
      homedir(),
      trimmed.slice(2),
    )
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed)
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Throws unless `target` lies inside `cwd`. Links are resolved, so a link inside the folder that
 * points elsewhere cannot be used to write outside it. The target itself may not exist yet.
 */
export async function assertInsideFolder(target: string, cwd: string): Promise<void> {
  const root = await realpath(cwd)
  let existing = target
  const missing: string[] = []
  while (!(await exists(existing))) {
    const parent = dirname(existing)
    if (parent === existing) break
    missing.unshift(basename(existing))
    existing = parent
  }
  const real = join(await realpath(existing), ...missing)
  const fromRoot = relative(root, real)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(
      `Writing is limited to the session folder (${root}); ${target} is outside it.`,
    )
  }
}

/** Checks a file the tool is about to create: right extension, inside the folder, no silent overwrite. */
export async function checkTarget(
  target: string,
  cwd: string,
  extensions: readonly string[],
  overwrite: boolean,
): Promise<void> {
  if (!extensions.includes(extname(target).toLowerCase())) {
    throw new Error(`The file name must end in ${extensions.join(' or ')}: ${target}`)
  }
  await assertInsideFolder(target, cwd)
  if (!overwrite && (await exists(target))) {
    throw new Error(
      `${target} already exists. Pass overwrite: true to replace it, or choose another name.`,
    )
  }
}

/**
 * Picks where an edit is saved. `output` wins; with no output, `overwrite: true` edits in place and
 * otherwise the edit goes to a copy named `<name>.edited<ext>` beside the original.
 */
export function editTarget(
  source: string,
  output: string | undefined,
  overwrite: boolean,
  cwd: string,
): string {
  if (output) return resolvePath(output, cwd)
  if (overwrite) return source
  const extension = extname(source)
  return join(dirname(source), `${basename(source, extension)}.edited${extension}`)
}
