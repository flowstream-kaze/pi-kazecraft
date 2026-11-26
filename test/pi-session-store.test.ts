import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, realpath, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'
import {
  deletePiSession,
  listRecentPiSessions,
  PiSessionWorkspaceError,
  resolvePiSessionDirectory,
} from '../server/pi-session-store.ts'

async function fixture(): Promise<{ directory: string; workspace: string }> {
  return {
    directory: await mkdtemp(join(tmpdir(), 'pi-sessions-')),
    workspace: await mkdtemp(join(tmpdir(), 'pi-workspace-')),
  }
}

test('resolves Pi session storage with Pi environment precedence', () => {
  const homeDirectory = join('home', 'user')
  const agentDirectory = join('infrastructure', '.pi', 'agent')
  const sessionDirectory = join('custom', 'sessions')

  assert.equal(
    resolvePiSessionDirectory({
      PI_CODING_AGENT_SESSION_DIR: sessionDirectory,
      PI_CODING_AGENT_DIR: agentDirectory,
    }, homeDirectory),
    sessionDirectory,
  )
  assert.equal(
    resolvePiSessionDirectory({ PI_CODING_AGENT_DIR: agentDirectory }, homeDirectory),
    join(agentDirectory, 'sessions'),
  )
  assert.equal(
    resolvePiSessionDirectory({}, homeDirectory),
    join(homeDirectory, '.pi', 'agent', 'sessions'),
  )
})

test('deletes a session file that belongs to the workspace', async () => {
  const { directory, workspace } = await fixture()
  const path = join(directory, 'done.jsonl')
  await writeSession(path, workspace, 'done', 'Finished work')

  await deletePiSession(path, await realpath(workspace), directory)
  await assert.rejects(access(path))
})

test('deletes a header-only session that never recorded a message', async () => {
  const { directory, workspace } = await fixture()
  const path = join(directory, 'empty.jsonl')
  await writeFile(
    path,
    `${
      JSON.stringify({
        type: 'session',
        id: 'empty',
        timestamp: '2026-07-19T09:00:00.000Z',
        cwd: workspace,
      })
    }\n`,
  )

  await deletePiSession(path, await realpath(workspace), directory)
  await assert.rejects(access(path))
})

test('treats a session Pi never wrote to disk as already deleted', async () => {
  const { directory, workspace } = await fixture()
  await deletePiSession(join(directory, 'never-written.jsonl'), workspace, directory)
})

test('refuses to delete a session recorded for another workspace', async () => {
  const { directory, workspace } = await fixture()
  const otherWorkspace = await mkdtemp(join(tmpdir(), 'pi-workspace-'))
  const path = join(directory, 'other.jsonl')
  await writeSession(path, otherWorkspace, 'other', 'Other work')

  await assert.rejects(
    deletePiSession(path, await realpath(workspace), directory),
    PiSessionWorkspaceError,
  )
  await access(path)
})

test('refuses to delete a file outside the Pi session directory', async () => {
  const { directory, workspace } = await fixture()
  const outside = join(workspace, 'outside.jsonl')
  await writeSession(outside, workspace, 'outside', 'Outside')

  await assert.rejects(
    deletePiSession(outside, await realpath(workspace), directory),
    /must be stored in the Pi session directory/,
  )
  await access(outside)
})

test('sorts canonical Pi sessions by their last message timestamp', async () => {
  const { directory, workspace } = await fixture()
  const sessions = join(directory, 'project')
  await mkdir(sessions)
  await writeSession(
    join(sessions, 'older.jsonl'),
    `${workspace}${sep}`,
    'older',
    'Older session',
    undefined,
    '2026-07-19T11:00:00.000Z',
  )
  await writeSession(
    join(sessions, 'newer.jsonl'),
    workspace,
    'newer',
    'Newer session',
    'Renamed session',
  )
  const recent = await listRecentPiSessions(directory)
  assert.deepEqual(recent.map(({ id, name, cwd }) => ({ id, name, cwd })), [
    { id: 'older', name: 'Older session', cwd: workspace },
    { id: 'newer', name: 'Renamed session', cwd: workspace },
  ])
  assert.deepEqual(recent.map(({ sessionPath }) => sessionPath), [
    await realpath(join(sessions, 'older.jsonl')),
    await realpath(join(sessions, 'newer.jsonl')),
  ])
})

test('returns sessions from every workspace and omits stale cwd records', async () => {
  const { directory, workspace } = await fixture()
  const otherWorkspace = await mkdtemp(join(tmpdir(), 'pi-workspace-'))
  await Promise.all(
    Array.from({ length: 11 }, (_, index) =>
      writeSession(
        join(directory, `${index}.jsonl`),
        workspace,
        String(index),
        `Session ${index}`,
      )),
  )
  await writeSession(join(directory, 'other.jsonl'), otherWorkspace, 'other', 'Other session')
  await writeSession(join(directory, 'stale.jsonl'), join(directory, 'missing'), 'stale', 'Stale')
  const recent = await listRecentPiSessions(directory)
  assert.equal(recent.length, 12)
  assert.deepEqual(
    new Set(recent.map(({ cwd }) => cwd)),
    new Set([workspace, otherWorkspace]),
  )
})

test('applies the recent-session limit independently to each workspace', async () => {
  const { directory, workspace } = await fixture()
  const otherWorkspace = await mkdtemp(join(tmpdir(), 'pi-workspace-'))
  const baseMtime = Date.now() - 1_000_000
  for (
    const [cwd, prefix, total, mtimeOffset] of [
      [workspace, 'first', 31, 0],
      [otherWorkspace, 'second', 100, 31],
    ] as const
  ) {
    for (let index = 0; index < total; index += 1) {
      const id = prefix + '-' + index
      const path = join(directory, id + '.jsonl')
      await writeSession(path, cwd, id, 'Session ' + id)
      const mtime = new Date(baseMtime + (mtimeOffset + index) * 1_000)
      await utimes(path, mtime, mtime)
    }
  }

  const recent = await listRecentPiSessions(directory)
  const workspaceCounts = recent.reduce((counts, session) => {
    counts.set(session.cwd, (counts.get(session.cwd) ?? 0) + 1)
    return counts
  }, new Map<string, number>())
  assert.equal(recent.length, 60)
  assert.equal(workspaceCounts.size, 2)
  assert.equal(workspaceCounts.get(workspace), 30)
  assert.equal(workspaceCounts.get(otherWorkspace), 30)
})

test('uses the first non-command user prompt and hides sessions without messages', async () => {
  const { directory, workspace } = await fixture()
  await writeFile(
    join(directory, 'unnamed.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'unnamed',
        timestamp: '2026-07-19T10:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: '/agent' } }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user', content: 'One two three four five six seven eight nine' },
      }),
    ]
      .join('\n'),
  )
  await writeFile(
    join(directory, 'empty.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'empty',
        timestamp: '2026-07-19T10:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'session_info', name: 'New session' }),
    ]
      .join('\n'),
  )
  const recent = await listRecentPiSessions(directory)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].name, 'One two three four five six seven eight…')
})

test('reads the newest entry of a large session file even when it exceeds one tail chunk', async () => {
  const { directory, workspace } = await fixture()
  // Middle history large enough that the head+tail path is taken and real bytes are skipped.
  const padding = JSON.stringify({
    type: 'message',
    timestamp: '2026-07-19T10:00:00.000Z',
    message: { role: 'assistant', content: 'x'.repeat(150 * 1024) },
  })
  // The final record is larger than one 64 KiB tail chunk: the backward scan must keep going
  // past the first chunk to capture its start, otherwise the newest entry would be dropped.
  const finalEntry = JSON.stringify({
    type: 'message',
    timestamp: '2026-07-19T11:00:00.000Z',
    message: { role: 'user', content: 'y'.repeat(70 * 1024) },
  })
  await writeFile(
    join(directory, 'big.jsonl'),
    [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'big',
        timestamp: '2026-07-19T09:00:00.000Z',
        cwd: workspace,
      }),
      JSON.stringify({ type: 'session_info', name: 'Big session' }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-07-19T09:00:00.000Z',
        message: { role: 'user', content: 'first prompt' },
      }),
      padding,
      finalEntry,
    ]
      .join('\n') + '\n',
  )
  const recent = await listRecentPiSessions(directory)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].name, 'Big session')
  // updatedAt reflects the final entry's timestamp; if it were ignored, this would fall back to 09:00.
  assert.equal(recent[0].updatedAt, Date.parse('2026-07-19T11:00:00.000Z'))
})

async function writeSession(
  path: string,
  cwd: string,
  id: string,
  name: string,
  renamedName?: string,
  lastMessageTimestamp?: string,
): Promise<void> {
  const timestamp = id === 'newer' ? '2026-07-19T10:00:00.000Z' : '2026-07-19T09:00:00.000Z'
  await writeFile(
    path,
    [
      JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd }),
      JSON.stringify({ type: 'session_info', name }),
      JSON.stringify({
        type: 'message',
        timestamp: lastMessageTimestamp ?? timestamp,
        message: { role: 'user', content: name },
      }),
      ...(renamedName ? [JSON.stringify({ type: 'session_info', name: renamedName })] : []),
    ]
      .join('\n'),
  )
}
