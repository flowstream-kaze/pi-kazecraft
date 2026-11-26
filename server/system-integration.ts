import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'

export type DesktopPlatform = 'linux' | 'wsl' | 'windows'
type SpawnProcess = (
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess
type StatPath = (path: string) => Promise<{ isDirectory(): boolean }>

/** Identifies the supported desktop environment from the process platform and WSL markers. */
export function getDesktopPlatform(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): DesktopPlatform {
  if (platform === 'win32') return 'windows'
  if (platform !== 'linux') throw new Error(`Unsupported platform: ${platform}`)
  return env.WSL_DISTRO_NAME || env.WSL_INTEROP ? 'wsl' : 'linux'
}

/** Returns the WSL distribution running the backend when its name is available. */
export function getWslDistributionName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.WSL_DISTRO_NAME || undefined
}

/**
 * File types Windows would run rather than show. A link in a reply is written by the model, so a
 * click never runs a program or script: these open the "Open with" dialog instead, where the user
 * chooses an app (Notepad, for example) or cancels.
 */
const runnableExtensions = new Set([
  // Programs and installers
  '.appinstaller',
  '.application',
  '.appref-ms',
  '.appx',
  '.appxbundle',
  '.com',
  '.cpl',
  '.exe',
  '.jar',
  '.msi',
  '.msix',
  '.msixbundle',
  '.msp',
  '.mst',
  '.pif',
  '.scr',
  // Scripts
  '.bat',
  '.cmd',
  '.hta',
  '.js',
  '.jse',
  '.ps1',
  '.psd1',
  '.psm1',
  '.sct',
  '.vb',
  '.vbe',
  '.vbs',
  '.ws',
  '.wsc',
  '.wsf',
  '.wsh',
  // Files Windows acts on when opened: settings, shortcuts, help, troubleshooters
  '.chm',
  '.diagcab',
  '.inf',
  '.lnk',
  '.msc',
  '.reg',
  '.scf',
  '.settingcontent-ms',
  '.url',
])

export function isRunnableFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  return dot > Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
    && runnableExtensions.has(path.slice(dot).toLowerCase())
}

/**
 * Opens a file or directory with its default application in the current desktop environment. On
 * Windows a file type with no app shows Windows' own "How do you want to open this?" picker, and a
 * program or script shows the "Open with" dialog instead of running.
 */
export async function openPath(
  path: string,
  platform = getDesktopPlatform(),
  spawnProcess: SpawnProcess = spawn,
  statPath: StatPath = stat,
): Promise<void> {
  if (platform === 'windows') {
    const pathInfo = await statPath(path)
    if (pathInfo.isDirectory()) await openApplication('explorer.exe', path, spawnProcess)
    else if (isRunnableFile(path)) await openWithDialog(path, spawnProcess)
    else await invokeWindowsPath(path, spawnProcess)
    return
  }
  const command = platform === 'wsl' ? 'explorer.exe' : 'xdg-open'
  await openApplication(command, await externalWorkspacePath(path, platform), spawnProcess)
}

/** Returns the path format expected by the browser or desktop integration. */
export function externalWorkspacePath(
  workspacePath: string,
  platform = getDesktopPlatform(),
  convertPath = convertWslPath,
): Promise<string> {
  return platform === 'wsl' ? convertPath(workspacePath) : Promise.resolve(workspacePath)
}

/** Returns a WSL path from a path chosen by a Windows application. */
export function internalWorkspacePath(
  workspacePath: string,
  platform = getDesktopPlatform(),
  convertPath = convertWindowsPath,
): Promise<string> {
  return platform === 'wsl' ? convertPath(workspacePath) : Promise.resolve(workspacePath)
}

/** Converts a WSL path to the Windows format understood by Windows applications. */
function convertWslPath(workspacePath: string): Promise<string> {
  return convertWslPathFormat(workspacePath, '-w')
}

/** Converts a Windows path to the WSL format understood by the backend. */
function convertWindowsPath(workspacePath: string): Promise<string> {
  return convertWslPathFormat(workspacePath, '-u')
}

function convertWslPathFormat(workspacePath: string, format: '-w' | '-u'): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('wslpath', [format, workspacePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let errorOutput = ''
    process.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    process.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString('utf8')
    })
    process.once('error', reject)
    process.once('exit', (code) => {
      const windowsPath = output.trim()
      if (code === 0 && windowsPath) resolve(windowsPath)
      else reject(new Error(errorOutput.trim() || `wslpath exited with code ${code}`))
    })
  })
}

/** Uses a constant script; the untrusted path is passed only as an environment value. */
function invokeWindowsPath(path: string, spawnProcess: SpawnProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; Start-Process -FilePath $env:PI_LIVECRAFT_OPEN_PATH -WindowStyle Normal',
      ],
      {
        env: { ...process.env, PI_LIVECRAFT_OPEN_PATH: path },
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      },
    )
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Windows path opener exited with code ${code ?? 'unknown'}`))
    })
  })
}

/**
 * Opens a File Explorer window on the folder holding `path`, with the file selected. The path is an
 * existing file the backend resolved (Windows file names cannot contain quotes), and Explorer
 * needs `/select,"path"` as one verbatim argument.
 */
export async function revealPath(
  path: string,
  platform = getDesktopPlatform(),
  spawnProcess: SpawnProcess = spawn,
): Promise<void> {
  if (platform === 'windows') {
    await startDetached('explorer.exe', [`/select,"${path}"`], spawnProcess, true)
    return
  }
  // Elsewhere there is no common way to select a file, so its folder opens.
  const folder = path.replace(/[\\/][^\\/]*$/, '') || path
  const command = platform === 'wsl' ? 'explorer.exe' : 'xdg-open'
  await openApplication(command, await externalWorkspacePath(folder, platform), spawnProcess)
}

/** Windows' "Open with" dialog for a file, which never runs it. */
function openWithDialog(path: string, spawnProcess: SpawnProcess): Promise<void> {
  return startDetached(
    'rundll32.exe',
    [`shell32.dll,OpenAs_RunDLL ${path}`],
    spawnProcess,
    true,
  )
}

function startDetached(
  command: string,
  args: string[],
  spawnProcess: SpawnProcess,
  verbatim = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
      windowsVerbatimArguments: verbatim,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Detaches a desktop application so restarting the backend never closes it. */
function openApplication(command: string, path: string, spawnProcess: SpawnProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, [path], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
