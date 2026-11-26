import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  engines,
  type ReadAloudEngine,
  type ReadAloudVoice,
  voiceParts,
} from '../../../shared/read-aloud-voices.ts'

/**
 * Where each engine's Python environment lives: a sibling folder of this checkout, or the
 * environment variable. Kokoro keeps kokoro-v1.0.onnx, voices-v1.0.bin and voice_presets.py
 * beside its `venv`.
 */
const installs: Record<
  ReadAloudEngine,
  { homeVariable: string; folder: string; script: string; env: (home: string) => object }
> = {
  kokoro: {
    homeVariable: 'KOKORO_HOME',
    folder: 'Kokoro',
    script: 'kokoro_worker.py',
    env: (home) => ({ KOKORO_HOME: home }),
  },
}

interface Worker {
  child: ChildProcessByStdio<Writable, Readable, null>
  lines: AsyncIterator<string>
}

function startWorker(engine: ReadAloudEngine): Worker {
  const install = installs[engine]
  const home = process.env[install.homeVariable]
    ?? fileURLToPath(new URL(`../../../../${install.folder}/`, import.meta.url))
  const python = join(
    home,
    'venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  )
  const child = spawn(python, ['-u', fileURLToPath(new URL(install.script, import.meta.url))], {
    windowsHide: true,
    // stderr is shared with the backend's console, where each passage's timing is printed.
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...install.env(home), PYTHONIOENCODING: 'utf-8' },
  })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  child.on('error', () => child.stdout.destroy())
  child.stdin.on('error', () => child.kill())
  child.once('close', () => {
    if (workers[engine]?.child === child) delete workers[engine]
  })
  return { child, lines }
}

const workers: Partial<Record<ReadAloudEngine, Worker>> = {}
let queue: Promise<void> = Promise.resolve()

/**
 * Serialize passages, so two engines never compete for the CPU, each on its own warm worker.
 * Discard disconnected requests before synthesis.
 */
export function renderSpeech(
  text: string,
  signal: AbortSignal,
  voice: ReadAloudVoice,
): Promise<Buffer> {
  const { engine, speaker } = voiceParts(voice)
  const result = queue.then(async () => {
    signal.throwIfAborted()
    const current = workers[engine] ??= startWorker(engine)
    const timeout = setTimeout(() => current.child.kill(), 60_000)
    try {
      current.child.stdin.write(JSON.stringify({ text, voice: speaker }) + '\n')
      const reply = await current.lines.next()
      if (reply.done) {
        throw new Error(
          `${engines[engine]} stopped. Check its local installation (${installs[engine].folder}).`,
        )
      }
      const data = JSON.parse(reply.value)
      if (typeof data.wav !== 'string')
        throw new Error(data.error || `${engines[engine]} could not synthesize speech`)
      return Buffer.from(data.wav, 'base64')
    } finally {
      clearTimeout(timeout)
    }
  })
  queue = result.then(() => {}, () => {})
  return result
}
