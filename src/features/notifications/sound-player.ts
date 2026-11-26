/**
 * Notification chimes, synthesized with the Web Audio API so no audio files ship with the app.
 * Browsers only allow sound after the page has been clicked or typed in once; until then a chime
 * is skipped quietly, never queued.
 */
import {
  NOTIFICATION_SOUNDS_STORAGE_KEY,
  type NotificationSoundKind,
  type NotificationSoundPreferences,
  parseNotificationSounds,
} from './notification-sounds.ts'

/** Notes of each chime: frequency in Hz, start offset and length in seconds. */
const chimes: Record<NotificationSoundKind, { frequency: number; at: number; length: number }[]> = {
  // A soft rising fifth: done.
  finished: [
    { frequency: 659.25, at: 0, length: 0.22 },
    { frequency: 987.77, at: 0.11, length: 0.38 },
  ],
  // Three quick rising notes: something needs you.
  input: [
    { frequency: 783.99, at: 0, length: 0.14 },
    { frequency: 987.77, at: 0.12, length: 0.14 },
    { frequency: 1318.51, at: 0.24, length: 0.32 },
  ],
  // One low, short note: something finished elsewhere.
  background: [{ frequency: 523.25, at: 0, length: 0.42 }],
}

let context: AudioContext | null = null
const lastPlayed = new Map<NotificationSoundKind, number>()
/** The same chime is not repeated within this window, so a burst of events makes one sound. */
const repeatWindowMs = 1500

function audioContext(): AudioContext | null {
  if (context) return context
  const Constructor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Constructor) return null
  context = new Constructor()
  return context
}

/** Lets later chimes play: browsers start audio suspended until the page has had a click or key. */
export function unlockNotificationSounds(): void {
  const handler = (): void => {
    const audio = audioContext()
    if (audio?.state === 'suspended') void audio.resume().catch(() => undefined)
    window.removeEventListener('pointerdown', handler)
    window.removeEventListener('keydown', handler)
  }
  window.addEventListener('pointerdown', handler, { once: true })
  window.addEventListener('keydown', handler, { once: true })
}

/** Plays a chime at `volume` (0 to 100). `force` skips the repeat guard (the Settings preview). */
export function playChime(kind: NotificationSoundKind, volume: number, force = false): void {
  if (volume <= 0) return
  const now = Date.now()
  if (!force && now - (lastPlayed.get(kind) ?? 0) < repeatWindowMs) return
  lastPlayed.set(kind, now)
  const audio = audioContext()
  if (!audio) return
  if (audio.state === 'suspended') {
    void audio
      .resume()
      .then(() => audio.state === 'running' && schedule(audio, kind, volume))
      .catch(() => undefined)
    return
  }
  schedule(audio, kind, volume)
}

function schedule(audio: AudioContext, kind: NotificationSoundKind, volume: number): void {
  // Perceived loudness grows roughly with the square of the level.
  const peak = 0.32 * (volume / 100) ** 2
  const start = audio.currentTime + 0.01
  for (const note of chimes[kind]) {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = note.frequency
    const begin = start + note.at
    const end = begin + note.length
    // A fast attack and an exponential fade read as a soft bell rather than a beep.
    gain.gain.setValueAtTime(0.0001, begin)
    gain.gain.exponentialRampToValueAtTime(peak, begin + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(begin)
    oscillator.stop(end + 0.02)
  }
}

export function readNotificationSounds(): NotificationSoundPreferences {
  try {
    return parseNotificationSounds(window.localStorage.getItem(NOTIFICATION_SOUNDS_STORAGE_KEY))
  } catch {
    return parseNotificationSounds(null)
  }
}

export function storeNotificationSounds(preferences: NotificationSoundPreferences): void {
  try {
    window.localStorage.setItem(NOTIFICATION_SOUNDS_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage can be unavailable; the choice still applies for this visit.
  }
}
