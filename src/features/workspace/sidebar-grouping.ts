import type { RecentSession } from '../../../shared/types.ts'
import type { WorkspaceGroup } from './workspace-groups.ts'

/** How the session sidebar arranges its rows. */
export type SidebarGroupBy = 'folder' | 'date' | 'none'

export const SIDEBAR_GROUP_BY_OPTIONS: readonly { id: SidebarGroupBy; label: string }[] = [
  { id: 'folder', label: 'Folder' },
  { id: 'date', label: 'Date' },
  { id: 'none', label: 'None' },
]

export const SIDEBAR_GROUP_BY_KEY = 'pi-kazecraft.sidebar-group-by'

/** One rendered sidebar section: a project folder, a date range, or the single flat list. */
export interface SidebarSection {
  /** Stable key: the folder path for projects, `date:<range>` or `all` otherwise. */
  key: string
  name: string
  sessions: RecentSession[]
  archivedSessions: RecentSession[]
  /** The project behind a folder section; date and flat sections have none. */
  project?: WorkspaceGroup
}

export function parseSidebarGroupBy(value: string | null): SidebarGroupBy {
  return value === 'date' || value === 'none' ? value : 'folder'
}

const DAY = 24 * 60 * 60 * 1000

const DATE_RANGES = [
  { key: 'date:today', name: 'Today' },
  { key: 'date:yesterday', name: 'Yesterday' },
  { key: 'date:week', name: 'Previous 7 days' },
  { key: 'date:older', name: 'Older' },
] as const

/**
 * Names the date range of a row. A live session that Pi has not persisted yet carries
 * `updatedAt` 0; it was just started, so it belongs to today.
 */
export function dateRangeKey(updatedAt: number, now: Date): string {
  if (updatedAt === 0) return 'date:today'
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (updatedAt >= startOfToday) return 'date:today'
  if (updatedAt >= startOfToday - DAY) return 'date:yesterday'
  if (updatedAt >= startOfToday - 7 * DAY) return 'date:week'
  return 'date:older'
}

/** Builds the sections for the chosen grouping from the folder-based project groups. */
export function sidebarSections(
  groups: readonly WorkspaceGroup[],
  groupBy: SidebarGroupBy,
  now: Date = new Date(),
): SidebarSection[] {
  if (groupBy === 'folder') {
    return groups.map((group) => ({
      key: group.path,
      name: group.name,
      sessions: group.sessions,
      archivedSessions: group.archivedSessions,
      project: group,
    }))
  }
  const sessions = groups.flatMap((group) => group.sessions).sort(newestFirst)
  const archivedSessions = groups.flatMap((group) => group.archivedSessions).sort(newestFirst)
  if (groupBy === 'none') {
    return sessions.length + archivedSessions.length === 0
      ? []
      : [{ key: 'all', name: 'All sessions', sessions, archivedSessions }]
  }
  return DATE_RANGES
    .map(({ key, name }) => ({
      key,
      name,
      sessions: sessions.filter((row) => dateRangeKey(row.updatedAt, now) === key),
      archivedSessions: archivedSessions.filter((row) => dateRangeKey(row.updatedAt, now) === key),
    }))
    .filter((section) => section.sessions.length + section.archivedSessions.length > 0)
}

/** The project name each row belongs to, for rows shown outside their folder section. */
export function projectNamesByPath(groups: readonly WorkspaceGroup[]): ReadonlyMap<string, string> {
  return new Map(groups.map((group) => [group.path, group.name]))
}

/** Newest first; an unpersisted live row (activity 0) counts as the newest. */
function newestFirst(left: RecentSession, right: RecentSession): number {
  if (left.updatedAt === 0 || right.updatedAt === 0) {
    if (left.updatedAt === right.updatedAt) return 0
    return left.updatedAt === 0 ? -1 : 1
  }
  return right.updatedAt - left.updatedAt
}
