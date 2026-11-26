import { spawn } from 'node:child_process'

/**
 * Moves a folder to the Windows Recycle Bin, so it can be restored from there. Other systems
 * have no single equivalent, so the folder is kept and this reports false.
 */
export function recycleFolder(path: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  // The path travels in an environment variable, never inside the command text.
  const command = 'Add-Type -AssemblyName Microsoft.VisualBasic; '
    + '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:KAZECRAFT_RECYCLE_PATH, '
    + '\'OnlyErrorDialogs\', \'SendToRecycleBin\')'
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        env: { ...process.env, KAZECRAFT_RECYCLE_PATH: path },
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    )
    let error = ''
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString()
    })
    const timer = setTimeout(() => child.kill(), 60_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(true)
      else reject(new Error(`The folder could not be moved to the Recycle Bin. ${error.trim()}`))
    })
  })
}
