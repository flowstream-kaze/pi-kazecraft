import type { RecentSession, SessionSummary } from '../../../shared/types.ts'

/** One collapsible workspace section of the session sidebar. */
export interface WorkspaceGroup {
  /** Canonical workspace directory shared by the section's sessions. */
  path: string
  /** The user's sidebar name, else the folder basename qualified by its parent when shared. */
  name: string
  /** Whether `name` comes from the user rather than from the folder. */
  customName: boolean
  /** Visible session rows, most recent activity first. */
  sessions: RecentSession[]
  /** Rows the user archived, most recent activity first; they stay out of navigation. */
  archivedSessions: RecentSession[]
  /** Newest row timestamp, or 0 for a workspace that has no sessions yet. */
  latestActivity: number
}

/** Sidebar-only preferences layered over the sessions Pi persists. */
export interface WorkspaceGroupOptions {
  /** Session files the user archived. */
  archivedSessionPaths?: ReadonlySet<string>
  /** Display names chosen by the user, keyed by canonical workspace path. */
  workspaceNames?: Readonly<Record<string, string>>
}

/**
 * Builds the sidebar sections from every workspace that owns a visible session,
 * plus the workspaces the user added explicitly.
 *
 * Sections are ordered by their newest session activity, archived rows included,
 * so archiving never reshuffles the sidebar. Explicitly added workspaces without
 * sessions keep their insertion order after the active ones.
 */
export function workspaceGroups(
  recentSessions: readonly RecentSession[],
  sentSessions: readonly RecentSession[],
  liveSessions: readonly SessionSummary[],
  workspacePaths: readonly string[],
  { archivedSessionPaths = new Set(), workspaceNames = {} }: WorkspaceGroupOptions = {},
): WorkspaceGroup[] {
  const rows = sidebarSessionRows(recentSessions, sentSessions, liveSessions)
  const paths = uniquePaths([...workspacePaths, ...rows.map((row) => row.cwd)])
  return paths
    .map((path) => {
      const workspaceRows = rows
        .filter((row) => row.cwd === path)
        .sort(newestActivityFirst)
      const customName = workspaceNames[path]?.trim() ?? ''
      return {
        path,
        name: customName || workspaceName(path, paths),
        customName: customName !== '',
        sessions: workspaceRows.filter((row) => !archivedSessionPaths.has(row.sessionPath)),
        archivedSessions: workspaceRows.filter((row) => archivedSessionPaths.has(row.sessionPath)),
        // Unknown activity from an unpersisted live session must not reorder the sections.
        latestActivity: workspaceRows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0),
      }
    })
    .sort((left, right) => right.latestActivity - left.latestActivity)
}

/**
 * Merges persisted and optimistically sent sessions, keeping a sent session
 * visible only while persistence does not return it yet.
 */
export function sidebarSessionRows(
  recentSessions: readonly RecentSession[],
  sentSessions: readonly RecentSession[] = [],
  liveSessions: readonly SessionSummary[] = [],
): RecentSession[] {
  const recentIds = new Set(recentSessions.map((session) => session.id))
  const recentPaths = new Set(recentSessions.map((session) => session.sessionPath))
  const pending = sentSessions.filter((session) =>
    !recentIds.has(session.id) && !recentPaths.has(session.sessionPath)
  )
  const visibleIds = new Set([...recentIds, ...pending.map((session) => session.id)])
  const visiblePaths = new Set([...recentPaths, ...pending.map((session) => session.sessionPath)])
  const liveRows: RecentSession[] = []
  for (const session of liveSessions) {
    if (
      !session.sessionPath
      || session.status === 'exited'
      || visibleIds.has(session.id)
      || visiblePaths.has(session.sessionPath)
    ) continue
    liveRows.push({
      id: session.id,
      cwd: session.cwd,
      name: session.name,
      sessionPath: session.sessionPath,
      // Pi summaries do not expose activity timestamps; persisted rows replace these as soon as
      // their history is available, and ordering treats the unknown timestamp as the newest.
      updatedAt: 0,
    })
    visibleIds.add(session.id)
    visiblePaths.add(session.sessionPath)
  }
  return [...pending, ...liveRows, ...recentSessions]
}

/**
 * Orders a section's rows newest first. A live session carries no activity timestamp
 * until Pi persists its history, and it is the newest row by definition: it was just
 * started, so it must stay inside the visible rows instead of unfolding the section.
 */
function newestActivityFirst(left: RecentSession, right: RecentSession): number {
  if (left.updatedAt === 0 || right.updatedAt === 0) {
    if (left.updatedAt === right.updatedAt) return 0
    return left.updatedAt === 0 ? -1 : 1
  }
  return right.updatedAt - left.updatedAt
}

/**
 * Names a workspace after its folder. When two sections share a basename, the
 * parent folder disambiguates them; a full path remains the last resort.
 */
export function workspaceName(path: string, paths: readonly string[]): string {
  const segments = pathSegments(path)
  const base = segments.at(-1) ?? path
  const sharedBase = paths.filter((candidate) => pathSegments(candidate).at(-1) === base).length > 1
  if (!sharedBase) return base
  const parent = segments.at(-2)
  if (!parent) return path
  const qualified = `${parent}/${base}`
  const qualifiedPaths = paths.filter((candidate) =>
    pathSegments(candidate).slice(-2).join('/') === qualified
  )
  return qualifiedPaths.length > 1 ? path : qualified
}

/** Splits a POSIX or Windows path into its non-empty segments. */
function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    unique.push(path)
  }
  return unique
}
