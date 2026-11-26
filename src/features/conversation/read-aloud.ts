import { readAloudAudio } from '../../api.ts'
import { speechPassages } from './speakable-text.ts'
import { readVoice } from './voice-preference.ts'

let active: AbortController | undefined

/** Claim page-wide audio on click, and release only the playback owned by this request. */
export async function readReply(markdown: string, controller: AbortController): Promise<void> {
  active?.abort()
  active = controller
  const { signal } = controller
  const voice = readVoice()
  const context = new AudioContext()
  let source: AudioBufferSourceNode | undefined
  const stop = () => source?.stop()
  signal.addEventListener('abort', stop, { once: true })
  try {
    await context.resume()
    let ended: Promise<void> = Promise.resolve()
    for (const passage of speechPassages(markdown)) {
      signal.throwIfAborted()
      const [audio] = await Promise.all([
        readAloudAudio(passage, signal, voice).then(bytes => context.decodeAudioData(bytes)),
        ended,
      ])
      signal.throwIfAborted()
      source = context.createBufferSource()
      source.buffer = audio
      source.connect(context.destination)
      const playing = source
      ended = new Promise(resolve => {
        playing.onended = () => resolve()
      })
      source.start()
    }
    await ended
  } finally {
    if (active === controller) active = undefined
    signal.removeEventListener('abort', stop)
    await context.close()
  }
}
