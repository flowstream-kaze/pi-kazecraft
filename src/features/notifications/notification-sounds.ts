/**
 * Which events play a sound, and how loud. Plain data and parsing only, so it can be tested
 * without a browser; `sound-player.ts` makes the sounds.
 */

export const NOTIFICATION_SOUND_KINDS = ['finished', 'input', 'background'] as const
export type NotificationSoundKind = (typeof NOTIFICATION_SOUND_KINDS)[number]

export interface NotificationSoundPreferences {
  /** Which events play a sound. */
  enabled: Record<NotificationSoundKind, boolean>
  /** 0 to 100. */
  volume: number
}

export const NOTIFICATION_SOUND_LABELS: Record<
  NotificationSoundKind,
  { title: string; description: string }
> = {
  finished: {
    title: 'Finished responses',
    description: 'When Pi finishes responding in the session you have open. Useful for long tasks.',
  },
  input: {
    title: 'Questions and approvals',
    description: 'When Pi stops to ask you a question or needs your approval to continue.',
  },
  background: {
    title: 'Other sessions and projects',
    description:
      'When a session you are not looking at finishes, in any project, or the open one finishes while kazecraft is in a background tab.',
  },
}

export const DEFAULT_NOTIFICATION_SOUNDS: NotificationSoundPreferences = {
  enabled: { finished: true, input: true, background: true },
  volume: 60,
}

export const NOTIFICATION_SOUNDS_STORAGE_KEY = 'pi-kazecraft.notification-sounds'

/** Reads stored preferences; anything missing or malformed falls back to the defaults. */
export function parseNotificationSounds(raw: string | null): NotificationSoundPreferences {
  let value: unknown
  try {
    value = JSON.parse(raw ?? 'null')
  } catch {
    value = null
  }
  const stored = typeof value === 'object' && value !== null
    ? value as { enabled?: unknown; volume?: unknown }
    : {}
  const storedEnabled = typeof stored.enabled === 'object' && stored.enabled !== null
    ? stored.enabled as Record<string, unknown>
    : {}
  const enabled = { ...DEFAULT_NOTIFICATION_SOUNDS.enabled }
  for (const kind of NOTIFICATION_SOUND_KINDS) {
    if (typeof storedEnabled[kind] === 'boolean') enabled[kind] = storedEnabled[kind] as boolean
  }
  const volume = typeof stored.volume === 'number' && Number.isFinite(stored.volume)
    ? Math.min(100, Math.max(0, Math.round(stored.volume)))
    : DEFAULT_NOTIFICATION_SOUNDS.volume
  return { enabled, volume }
}

/**
 * Which sound a finished reply plays: the open session while you can see it is a "finished"
 * response; any other session, or the open one while the tab is hidden, is "background".
 */
export function finishedSoundKind(
  sessionId: string,
  openSessionId: string,
  tabVisible: boolean,
): NotificationSoundKind {
  return sessionId === openSessionId && tabVisible ? 'finished' : 'background'
}
