import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { ReadAloudVoice } from '../../../shared/read-aloud-voices.ts'

function startWorker() {
  const home = process.env.PARADEE_HOME
    ?? fileURLToPath(new URL('../../../../Paradee/', import.meta.url))
  const python = join(
    home,
    'venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  )
  const child = spawn(python, ['-u', fileURLToPath(new URL('worker.py', import.meta.url))], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      HF_HOME: join(home, 'cache'),
      HF_HUB_OFFLINE: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  child.on('error', () => child.stdout.destroy())
  child.stdin.on('error', () => child.kill())
  child.once('close', () => {
    if (worker?.child === child) worker = undefined
  })
  return { child, lines }
}

let worker: ReturnType<typeof startWorker> | undefined
let queue: Promise<void> = Promise.resolve()

/** Serialize passages on one warm CPU model. Discard disconnected requests before synthesis. */
export function renderSpeech(
  text: string,
  signal: AbortSignal,
  voice: ReadAloudVoice,
): Promise<Buffer> {
  const result = queue.then(async () => {
    signal.throwIfAborted()
    const current = worker ??= startWorker()
    const timeout = setTimeout(() => current.child.kill(), 60_000)
    try {
      current.child.stdin.write(JSON.stringify({ text, voice }) + '\n')
      const reply = await current.lines.next()
      if (reply.done)
        throw new Error('Paradee stopped. Check its local installation and model cache.')
      const data = JSON.parse(reply.value)
      if (typeof data.wav !== 'string')
        throw new Error(data.error || 'Paradee could not synthesize speech')
      return Buffer.from(data.wav, 'base64')
    } finally {
      clearTimeout(timeout)
    }
  })
  queue = result.then(() => {}, () => {})
  return result
}
