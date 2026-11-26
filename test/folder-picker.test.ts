import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  folderPickerInvocations,
  FolderPickerUnavailableError,
  getFolderPickerPlatform,
  pickDirectory,
  windowsPickerScript,
} from '../server/features/folder-picker/folder-picker.ts'

interface FakeRun {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

/** Builds a spawn stand-in whose children answer with the scripted outcome. */
function fakeSpawn(
  runs: FakeRun[],
  outcome: (run: FakeRun) => { code?: number; output?: string; stderr?: string; error?: Error },
) {
  const calls: string[] = []
  const spawnProcess = ((command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const run = { command, args, env: options.env }
    runs.push(run)
    calls.push(command)
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const result = outcome(run)
    queueMicrotask(() => {
      if (result.error) {
        child.emit('error', result.error)
        return
      }
      if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr))
      if (result.output) child.stdout.emit('data', Buffer.from(result.output))
      child.emit('close', result.code ?? 0)
    })
    return child as never
  }) as never
  return { calls, spawnProcess }
}

function missingExecutable(): Error {
  return Object.assign(new Error('spawn zenity ENOENT'), { code: 'ENOENT' })
}

test('detects the dialog platform from the process platform and WSL markers', () => {
  assert.equal(getFolderPickerPlatform('darwin', {}), 'darwin')
  assert.equal(getFolderPickerPlatform('win32', {}), 'windows')
  assert.equal(getFolderPickerPlatform('linux', {}), 'linux')
  assert.equal(getFolderPickerPlatform('linux', { WSL_DISTRO_NAME: 'Ubuntu' }), 'wsl')
  assert.throws(() => getFolderPickerPlatform('freebsd', {}))
})

test('orders Linux dialogs from zenity to kdialog to yad', () => {
  const invocations = folderPickerInvocations('linux', '/home/user/work')
  assert.deepEqual(invocations.map(({ command }) => command), ['zenity', 'kdialog', 'yad'])
  assert.deepEqual(invocations[0].args, [
    '--file-selection',
    '--directory',
    '--title=Select a workspace folder',
    '--filename=/home/user/work/',
  ])
  assert.deepEqual(invocations[1].args, [
    '--getexistingdirectory',
    '/home/user/work',
    '--title',
    'Select a workspace folder',
  ])
})

test('omits starting paths when no initial directory is known', () => {
  const invocations = folderPickerInvocations('linux')
  assert.deepEqual(invocations[0].args, [
    '--file-selection',
    '--directory',
    '--title=Select a workspace folder',
  ])
  assert.deepEqual(invocations[1].args, [
    '--getexistingdirectory',
    '--title',
    'Select a workspace folder',
  ])
})

test('passes the Windows starting directory only through the environment', () => {
  const [invocation] = folderPickerInvocations('windows', 'C:\\hostile & ü')
  assert.equal(invocation.command, 'powershell.exe')
  assert.deepEqual(invocation.args.slice(0, 4), [
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-Command',
  ])
  assert.ok(!invocation.args.join(' ').includes('hostile'))
  assert.equal(invocation.env?.PI_LIVECRAFT_PICK_INITIAL, 'C:\\hostile & ü')
})

test('keeps every else on its if statement in the Windows dialog script', () => {
  // Statements are joined with "; ", and PowerShell rejects an else after a semicolon.
  assert.doesNotMatch(windowsPickerScript, /;\s*else\b/)
})

test(
  'writes a Windows dialog script that PowerShell parses without errors',
  { skip: process.platform !== 'win32' && 'PowerShell parser is only checked on Windows' },
  () => {
    // A detached `else` parses as a command named "else" and only fails at run time,
    // so the check reports such commands alongside real parse errors.
    const problems = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$errors = $null; '
      + '$ast = [System.Management.Automation.Language.Parser]::ParseInput('
      + '$env:PICKER_SCRIPT, [ref]$null, [ref]$errors); '
      + '$errors | ForEach-Object { $_.Message }; '
      + '$ast.FindAll({ param($node) '
      + '$node -is [System.Management.Automation.Language.CommandAst] '
      + '-and $node.GetCommandName() -in @(\'else\', \'elseif\') }, $true) '
      + '| ForEach-Object { \'detached keyword: \' + $_.Extent.Text }',
    ], { encoding: 'utf8', env: { ...process.env, PICKER_SCRIPT: windowsPickerScript } })
    assert.equal(problems.trim(), '')
  },
)

test('uses the Windows dialog first in WSL and converts its selected path back', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({ output: 'C:\\Users\\Ada\\Projects\n' }))
  const conversions: Array<[string, 'to-windows' | 'to-wsl']> = []
  const convertWslPath = async (
    path: string,
    direction: 'to-windows' | 'to-wsl',
  ): Promise<string> => {
    conversions.push([path, direction])
    return direction === 'to-windows'
      ? '\\\\wsl.localhost\\Ubuntu\\home\\ada\\work'
      : '/mnt/c/Users/Ada/Projects'
  }

  const selected = await pickDirectory('wsl', '/home/ada/work', spawnProcess, convertWslPath)

  assert.equal(selected, '/mnt/c/Users/Ada/Projects')
  assert.deepEqual(runs.map(({ command }) => command), ['powershell.exe'])
  assert.equal(
    runs[0].env?.PI_LIVECRAFT_PICK_INITIAL,
    '\\\\wsl.localhost\\Ubuntu\\home\\ada\\work',
  )
  assert.ok(runs[0].env?.WSLENV?.split(':').includes('PI_LIVECRAFT_PICK_INITIAL'))
  assert.deepEqual(conversions, [
    ['/home/ada/work', 'to-windows'],
    ['C:\\Users\\Ada\\Projects', 'to-wsl'],
  ])
})

test('falls back to Linux dialogs in WSL when Windows interop is unavailable', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, (run) =>
    run.command === 'powershell.exe'
      ? { error: missingExecutable() }
      : { output: '/home/ada/chosen' })

  assert.equal(await pickDirectory('wsl', undefined, spawnProcess), '/home/ada/chosen')
  assert.deepEqual(runs.map(({ command }) => command), ['powershell.exe', 'zenity'])
})

test('passes the macOS starting directory as an argument, outside the AppleScript source', () => {
  const hostilePath = '/Users/a "quoted" dir'
  const [invocation] = folderPickerInvocations('darwin', hostilePath)
  assert.equal(invocation.command, 'osascript')
  assert.deepEqual(invocation.args.slice(0, 1), ['-e'])
  assert.ok(!invocation.args[1].includes(hostilePath))
  assert.equal(invocation.args[2], hostilePath)
  assert.match(invocation.args[1], /on run argv/)
  assert.ok(invocation.args[1].includes('\n'))
})

test('resolves the selected path from the first available dialog', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({ output: '/home/user/chosen\n' }))
  assert.equal(await pickDirectory('linux', '/home/user', spawnProcess), '/home/user/chosen')
  assert.deepEqual(runs.map(({ command }) => command), ['zenity'])
})

test('falls through candidates whose executable is missing', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, (run) =>
    run.command === 'zenity'
      ? { error: missingExecutable() }
      : { output: '/home/user/chosen' })
  assert.equal(await pickDirectory('linux', undefined, spawnProcess), '/home/user/chosen')
  assert.deepEqual(runs.map(({ command }) => command), ['zenity', 'kdialog'])
})

test('treats exit code 1 as a cancellation and stops trying candidates', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({ code: 1 }))
  assert.equal(await pickDirectory('linux', undefined, spawnProcess), null)
  assert.deepEqual(runs.map(({ command }) => command), ['zenity'])
})

test('reports a Linux dialog failure that exits with code 1 and writes stderr', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({
    code: 1,
    stderr: 'cannot open display',
  }))
  await assert.rejects(() => pickDirectory('linux', undefined, spawnProcess), /cannot open display/)
})

test('treats an osascript error -128 as a cancellation', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({
    code: 1,
    stderr: 'execution error: User canceled. (-128)',
  }))
  assert.equal(await pickDirectory('darwin', undefined, spawnProcess), null)
})

test('reports other osascript failures', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({
    code: 1,
    stderr: 'execution error: Invalid default location (-1728)',
  }))
  await assert.rejects(
    () => pickDirectory('darwin', undefined, spawnProcess),
    /Invalid default location/,
  )
})

test('reports a dialog failure that is not a cancellation', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({
    code: 2,
    stderr: 'cannot open display',
  }))
  await assert.rejects(() => pickDirectory('linux', undefined, spawnProcess), /cannot open display/)
})

test('treats empty output as a cancellation instead of an empty path', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({ output: '   \n' }))
  assert.equal(await pickDirectory('linux', undefined, spawnProcess), null)
})

test('reports an unavailable picker when every executable is missing', async () => {
  const runs: FakeRun[] = []
  const { spawnProcess } = fakeSpawn(runs, () => ({ error: missingExecutable() }))
  await assert.rejects(
    () => pickDirectory('linux', undefined, spawnProcess),
    FolderPickerUnavailableError,
  )
  assert.deepEqual(runs.map(({ command }) => command), ['zenity', 'kdialog', 'yad'])
})
