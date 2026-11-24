import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecentSession, SessionSummary } from '../shared/types.ts'
import {
  sidebarSessionRows,
  workspaceGroups,
  workspaceName,
} from '../src/features/workspace/workspace-groups.ts'
import { visibleWorkspaceSessionCount } from '../src/features/workspace/workspace-sidebar.ts'

function session(cwd: string, id: string, updatedAt: number): RecentSession {
  return {
    id,
    cwd,
    name: `Session ${id}`,
    sessionPath: `/sessions/${id}.jsonl`,
    updatedAt,
  }
}

function liveSession(
  id: string,
  cwd: string,
  sessionPath: string,
  status: SessionSummary['status'] = 'idle',
): SessionSummary {
  return {
    id,
    cwd,
    name: id,
    sessionPath,
    status,
    pendingUi: [],
  }
}

test('groups sessions by workspace with the newest activity first', () => {
  const groups = workspaceGroups(
    [
      session('/old', 'old', 100),
      session('/recent', 'recent', 500),
      session('/old', 'old-2', 300),
    ],
    [],
    [],
    [],
  )

  assert.deepEqual(groups.map(({ path, latestActivity }) => ({ path, latestActivity })), [
    { path: '/recent', latestActivity: 500 },
    { path: '/old', latestActivity: 300 },
  ])
  assert.deepEqual(groups[1].sessions.map(({ id }) => id), ['old-2', 'old'])
})

test('keeps explicitly added workspaces without sessions after active ones', () => {
  const groups = workspaceGroups(
    [session('/active', 'active', 100)],
    [],
    [],
    ['/empty', '/active'],
  )

  assert.deepEqual(groups.map(({ path }) => path), ['/active', '/empty'])
  assert.deepEqual(groups[1].sessions, [])
  assert.equal(groups[1].latestActivity, 0)
})

test('keeps a sent session visible until persistence returns it', () => {
  const pending = session('/active', 'pending', 200)
  const persisted = session('/active', 'persisted', 100)

  assert.deepEqual(
    workspaceGroups([persisted], [pending], [], []).map(({ sessions }) =>
      sessions.map(({ id }) => id)
    ),
    [['pending', 'persisted']],
  )
  assert.deepEqual(
    workspaceGroups([persisted, pending], [pending], [], []).flatMap(({ sessions }) =>
      sessions.map(({ id }) => id)
    ),
    ['pending', 'persisted'],
  )
})

test('keeps a freshly started live session inside its section visible rows', () => {
  const persisted = [
    session('/active', 'a', 500),
    session('/active', 'b', 400),
    session('/active', 'c', 300),
    session('/active', 'd', 200),
    session('/active', 'e', 100),
  ]
  const groups = workspaceGroups(
    persisted,
    [],
    [liveSession('fresh', '/active', '/sessions/fresh.jsonl')],
    [],
  )

  // The section reveals its hidden history for a selected session below that window.
  assert.deepEqual(
    groups[0].sessions.slice(0, visibleWorkspaceSessionCount).map(({ id }) => id),
    ['fresh', 'a', 'b', 'c'],
  )
  assert.equal(groups[0].latestActivity, 500)
})

test('names sections after their folder and qualifies shared basenames', () => {
  const paths = ['/home/ana/dev/app', '/home/ana/tools/app', '/home/ana/dev/pi']
  assert.equal(workspaceName('/home/ana/dev/pi', paths), 'pi')
  assert.equal(workspaceName('/home/ana/dev/app', paths), 'dev/app')
  assert.equal(workspaceName('/home/ana/tools/app', paths), 'tools/app')
})

test('falls back to the full path when parent folders also collide', () => {
  const paths = ['/one/dev/app', '/two/dev/app']
  assert.equal(workspaceName('/one/dev/app', paths), '/one/dev/app')
  assert.equal(workspaceName('/two/dev/app', paths), '/two/dev/app')
})

test('reads Windows workspaces with either separator', () => {
  const paths = ['C:\\dev\\app', 'D:\\dev\\app']
  assert.equal(workspaceName('C:\\dev\\app', paths), 'C:\\dev\\app')
  assert.equal(workspaceName('C:\\dev\\app\\', ['C:\\dev\\app\\']), 'app')
})

test('deduplicates sessions and ignores empty workspace paths', () => {
  const rows = sidebarSessionRows([session('/active', 'a', 1)], [session('/active', 'b', 2)])
  assert.deepEqual(rows.map(({ id }) => id), ['b', 'a'])
  assert.deepEqual(workspaceGroups(rows, [], [], ['']).map(({ path }) => path), ['/active'])
})

test('includes live sessions that have no persisted history and deduplicates persisted rows', () => {
  const persisted = session('/active', 'persisted', 100)
  const groups = workspaceGroups(
    [persisted],
    [],
    [
      liveSession('persisted-live-id', '/active', persisted.sessionPath),
      liveSession('live-only', '/empty', '/sessions/live-only.jsonl'),
      liveSession('exited-only', '/stale', '/sessions/exited-only.jsonl', 'exited'),
    ],
    [],
  )

  assert.deepEqual(groups.map(({ path, latestActivity }) => ({ path, latestActivity })), [
    { path: '/active', latestActivity: 100 },
    { path: '/empty', latestActivity: 0 },
  ])
  assert.deepEqual(groups[0].sessions.map(({ id }) => id), ['persisted'])
  assert.deepEqual(groups[1].sessions.map(({ id }) => id), ['live-only'])
})

test('moves archived sessions out of the visible rows without reordering sections', () => {
  const archived = session('/archived', 'archived-newest', 900)
  const groups = workspaceGroups(
    [archived, session('/archived', 'kept', 200), session('/other', 'other', 500)],
    [],
    [],
    [],
    { archivedSessionPaths: new Set([archived.sessionPath]) },
  )

  assert.deepEqual(groups.map(({ path }) => path), ['/archived', '/other'])
  assert.deepEqual(groups[0].sessions.map(({ id }) => id), ['kept'])
  assert.deepEqual(groups[0].archivedSessions.map(({ id }) => id), ['archived-newest'])
  assert.deepEqual(groups[1].archivedSessions, [])
})

test('keeps a section whose sessions are all archived', () => {
  const only = session('/quiet', 'only', 100)
  const [group] = workspaceGroups([only], [], [], [], {
    archivedSessionPaths: new Set([only.sessionPath]),
  })

  assert.equal(group.path, '/quiet')
  assert.deepEqual(group.sessions, [])
  assert.deepEqual(group.archivedSessions.map(({ id }) => id), ['only'])
})

test('uses a custom workspace name and falls back to the folder name when blank', () => {
  const groups = workspaceGroups(
    [session('/work/alpha', 'a', 200), session('/work/beta', 'b', 100)],
    [],
    [],
    [],
    { workspaceNames: { '/work/alpha': '  Client site  ', '/work/beta': '   ' } },
  )

  assert.deepEqual(groups.map(({ name, customName }) => ({ name, customName })), [
    { name: 'Client site', customName: true },
    { name: 'beta', customName: false },
  ])
})
