import { open, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { RecentSession } from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

const sessionDirectory = resolvePiSessionDirectory(process.env, homedir())

/** Resolves Pi's session storage using its configured profile before the default profile. */
export function resolvePiSessionDirectory(
  environment: { PI_CODING_AGENT_SESSION_DIR?: string; PI_CODING_AGENT_DIR?: string },
  homeDirectory: string,
): string {
  return environment.PI_CODING_AGENT_SESSION_DIR
    ?? (environment.PI_CODING_AGENT_DIR
      ? join(environment.PI_CODING_AGENT_DIR, 'sessions')
      : join(homeDirectory, '.pi', 'agent', 'sessions'))
}

interface PiSessionHeader {
  type: 'session'
  id: string
  timestamp: string
  cwd: string
}

interface PiSessionFile {
  canonicalPath: string
  cwd: string
  header: PiSessionHeader
}

const MAX_SESSIONS_PER_WORKSPACE = 30
const SESSION_SCAN_BATCH_SIZE = 100
const HEAD_CHUNK_BYTES = 64 * 1024
const TAIL_CHUNK_BYTES = 64 * 1024
const TAIL_SCAN_BUDGET = 2 * 1024 * 1024

/**
 * Lists resumable Pi sessions across every workspace, capped per working directory.
 * The sidebar groups the result by each session's canonical `cwd`.
 */
export async function listRecentPiSessions(
  directory = sessionDirectory,
): Promise<RecentSession[]> {
  const paths = await listSessionFiles(directory)

  const withMtime = await Promise.all(
    paths.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })),
  )
  withMtime.sort((left, right) => right.mtime - left.mtime)
  const indexed: Array<{ mtime: number; sessionFile: PiSessionFile }> = []
  for (let index = 0; index < withMtime.length; index += SESSION_SCAN_BATCH_SIZE) {
    const batch = withMtime.slice(index, index + SESSION_SCAN_BATCH_SIZE)
    const entries = await Promise.all(batch.map(async ({ path, mtime }) => ({
      mtime,
      sessionFile: await readPiSessionFile(path),
    })))
    indexed.push(
      ...entries.filter((entry): entry is { mtime: number; sessionFile: PiSessionFile } =>
        entry.sessionFile !== null
      ),
    )
  }

  // Read the full summaries only until each workspace has enough visible sessions.
  const perWorkspace = new Map<string, number>()
  const recent: RecentSession[] = []
  for (const { mtime, sessionFile } of indexed) {
    const count = perWorkspace.get(sessionFile.cwd) ?? 0
    if (count >= MAX_SESSIONS_PER_WORKSPACE) continue
    const session = await readPiSession(sessionFile.canonicalPath, mtime, sessionFile)
    if (!session) continue
    perWorkspace.set(sessionFile.cwd, count + 1)
    recent.push(session)
  }
  return recent.sort(byUpdatedAt)
}

function byUpdatedAt(left: RecentSession | null, right: RecentSession | null): number {
  return (right?.updatedAt ?? 0) - (left?.updatedAt ?? 0)
}

/** Verifies that a file belongs to the Pi session directory before loading its metadata. */
export async function loadPiSession(path: string): Promise<RecentSession> {
  const [canonicalPath, canonicalDirectory] = await Promise.all([
    realpath(path),
    realpath(sessionDirectory),
  ])
  const relativePath = relative(canonicalDirectory, canonicalPath)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new Error('Pi session file must be stored in the Pi session directory')
  const session = await readPiSession(canonicalPath, (await stat(canonicalPath)).mtimeMs)
  if (!session) throw new Error('Invalid Pi session file')
  return session
}

/**
 * Permanently removes a session file. Pi documents deleting the `.jsonl` file as the way to
 * remove a session; the containment check of `loadPiSession` keeps the deletion inside Pi storage.
 */
export async function deletePiSession(path: string): Promise<void> {
  const session = await loadPiSession(path)
  await rm(session.sessionPath)
}

/** Recursively scans Pi storage while retaining only session JSONL files. */
async function listSessionFiles(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }

  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSessionFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

/** Extracts a session's identity, name, and latest activity without loading its full history. */
async function readPiSession(
  path: string,
  updatedAt: number,
  sessionFile?: PiSessionFile,
): Promise<RecentSession | null> {
  const file = sessionFile ?? await readPiSessionFile(path)
  if (!file) return null
  let lines: string[]
  try {
    lines = await readSessionLines(file.canonicalPath)
  } catch {
    return null
  }

  const { header, cwd, canonicalPath } = file
  let hasMessage = false
  let name: string | undefined
  let prompt: string | undefined
  let lastMessageAt: number | undefined
  for (let index = 1; index < lines.length; index += 1) {
    const value = parseLine(lines[index])
    if (!value) continue
    if (value.type === 'session_info' && typeof value.name === 'string' && value.name.trim()) {
      name = value.name.trim()
      continue
    }
    if (value.type !== 'message') continue
    hasMessage = true
    if (typeof value.timestamp === 'string') {
      const timestamp = Date.parse(value.timestamp)
      if (!Number.isNaN(timestamp) && (lastMessageAt === undefined || timestamp > lastMessageAt))
        lastMessageAt = timestamp
    }
    if (prompt === undefined && isObject(value.message) && value.message.role === 'user') {
      const content = textContent(value.message.content)
      if (content && !content.startsWith('/')) prompt = shortenPrompt(content)
    }
  }
  if (!hasMessage) return null
  const createdAt = Date.parse(header.timestamp)
  return {
    id: header.id,
    cwd,
    name: name || prompt || 'New session',
    sessionPath: canonicalPath,
    updatedAt: lastMessageAt ?? (Number.isNaN(createdAt) ? updatedAt : createdAt),
  }
}

/** Reads and resolves the small JSONL header needed to group session files by workspace. */
async function readPiSessionFile(path: string): Promise<PiSessionFile | null> {
  let canonicalPath: string
  try {
    canonicalPath = await realpath(path)
  } catch {
    return null
  }
  let handle: FileHandle | undefined
  try {
    handle = await open(canonicalPath, 'r')
    const head = Buffer.alloc(HEAD_CHUNK_BYTES)
    const { bytesRead } = await handle.read(head, 0, HEAD_CHUNK_BYTES, 0)
    const lineEnd = head.subarray(0, bytesRead).indexOf(0x0a)
    if (lineEnd < 0) return null
    const header = parseHeader(head.toString('utf8', 0, lineEnd))
    if (!header) return null
    let cwd: string
    try {
      cwd = await realpath(header.cwd)
    } catch {
      return null
    }
    return { canonicalPath, cwd, header }
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** Reads only the head and the newest entries of a session file instead of its full history:
 *  the header, name, and first prompt live near the start, and the newest activity at the end.
 *  Gigabytes of middle history never need to be parsed to render the recent-session list.
 *  A single entry may itself be huge (tool outputs), so the end is scanned backward in chunks
 *  until a complete JSON line is found rather than assuming a fixed tail fits. */
async function readSessionLines(path: string): Promise<string[]> {
  const size = (await stat(path)).size
  if (size <= HEAD_CHUNK_BYTES + TAIL_CHUNK_BYTES) return (await readFile(path, 'utf8')).split('\n')
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const head = Buffer.alloc(HEAD_CHUNK_BYTES)
    const { bytesRead: headBytes } = await handle.read(head, 0, HEAD_CHUNK_BYTES, 0)
    let tail = ''
    let position = size
    let scanned = 0
    while (position > HEAD_CHUNK_BYTES && scanned < TAIL_SCAN_BUDGET && !hasParseableLine(tail)) {
      const chunkSize = Math.min(TAIL_CHUNK_BYTES, position - HEAD_CHUNK_BYTES)
      position -= chunkSize
      const chunk = Buffer.alloc(chunkSize)
      const { bytesRead } = await handle.read(chunk, 0, chunkSize, position)
      tail = chunk.subarray(0, bytesRead).toString('utf8') + tail
      scanned += chunkSize
    }
    return (head.subarray(0, headBytes).toString('utf8') + tail).split('\n')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** True when the accumulated text contains at least one complete JSON line. */
function hasParseableLine(text: string): boolean {
  return text.split('\n').some((line) => parseLine(line) !== null)
}

function parseHeader(line: string | undefined): PiSessionHeader | null {
  const value = parseLine(line)
  if (
    !value || value.type !== 'session' || typeof value.id !== 'string'
    || typeof value.timestamp !== 'string' || typeof value.cwd !== 'string'
  ) return null
  return { type: 'session', id: value.id, timestamp: value.timestamp, cwd: value.cwd }
}

function parseLine(line: string | undefined): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line ?? '')
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

function textContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((part): part is Record<string, unknown> =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join(' ')
    .trim()
  return text || undefined
}

function shortenPrompt(prompt: string): string {
  const words = prompt.split(/\s+/)
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : prompt
}
function isNotFound(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT'
}
