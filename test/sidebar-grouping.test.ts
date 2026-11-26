import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession } from '../shared/types.ts'
import {
  dateRangeKey,
  parseSidebarGroupBy,
  sidebarSections,
} from '../src/features/workspace/sidebar-grouping.ts'
import type { WorkspaceGroup } from '../src/features/workspace/workspace-groups.ts'

const now = new Date(2026, 10, 25, 15, 0)
const at = (daysAgo: number, hour = 12) => new Date(2026, 10, 25 - daysAgo, hour).getTime()

function row(id: string, cwd: string, updatedAt: number): RecentSession {
  return { id, cwd, name: id, sessionPath: `${cwd}/${id}.jsonl`, updatedAt }
}

function group(path: string, sessions: RecentSession[], archived: RecentSession[] = []) {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    customName: false,
    sessions,
    archivedSessions: archived,
    latestActivity: Math.max(0, ...sessions.map((session) => session.updatedAt)),
  } satisfies WorkspaceGroup
}

const groups = [
  group('/p/app', [row('a-today', '/p/app', at(0)), row('a-old', '/p/app', at(30))]),
  group('/p/site', [row('s-yesterday', '/p/site', at(1)), row('s-live', '/p/site', 0)], [
    row('s-archived', '/p/site', at(3)),
  ]),
]

test('reads the stored grouping and falls back to folder', () => {
  assert.equal(parseSidebarGroupBy('date'), 'date')
  assert.equal(parseSidebarGroupBy('none'), 'none')
  assert.equal(parseSidebarGroupBy('weekday'), 'folder')
  assert.equal(parseSidebarGroupBy(null), 'folder')
})

test('folder grouping keeps one section per project', () => {
  const sections = sidebarSections(groups, 'folder', now)
  assert.deepEqual(sections.map((section) => section.key), ['/p/app', '/p/site'])
  assert.equal(sections[0].project, groups[0])
})

test('date grouping buckets rows by day and drops empty ranges', () => {
  const sections = sidebarSections(groups, 'date', now)
  assert.deepEqual(
    sections.map((section) => [section.name, section.sessions.map((session) => session.id)]),
    [
      ['Today', ['s-live', 'a-today']],
      ['Yesterday', ['s-yesterday']],
      ['Previous 7 days', []],
      ['Older', ['a-old']],
    ],
  )
  assert.deepEqual(sections[2].archivedSessions.map((session) => session.id), ['s-archived'])
  assert.equal(sections[0].project, undefined)
})

test('date ranges start at local midnight', () => {
  assert.equal(dateRangeKey(new Date(2026, 10, 25, 0, 0).getTime(), now), 'date:today')
  assert.equal(dateRangeKey(new Date(2026, 10, 24, 23, 59).getTime(), now), 'date:yesterday')
  assert.equal(dateRangeKey(at(7), now), 'date:week')
  assert.equal(dateRangeKey(at(9), now), 'date:older')
  assert.equal(dateRangeKey(0, now), 'date:today')
})

test('no grouping lists every row newest first in one section', () => {
  const sections = sidebarSections(groups, 'none', now)
  assert.equal(sections.length, 1)
  assert.deepEqual(sections[0].sessions.map((session) => session.id), [
    's-live',
    'a-today',
    's-yesterday',
    'a-old',
  ])
  assert.deepEqual(sidebarSections([], 'none', now), [])
})
