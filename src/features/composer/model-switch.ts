/**
 * How long a model takes to load, learned from earlier switches, and how far along a load is.
 * Plain logic only, so it can be tested without a browser; `useModelSwitch` uses it.
 */

export const MODEL_LOAD_TIMES_KEY = 'pi-livecraft.model-load-seconds'

/** Measured load times in seconds, keyed by "provider/model". */
export type LoadTimes = Readonly<Record<string, number>>

export function parseLoadTimes(raw: string | null): LoadTimes {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0 && entry[1] < 3600
      ),
    )
  } catch {
    return {}
  }
}

/**
 * Adds a measured load. The newest measurement counts as much as the history so far, so the
 * estimate follows a change (a bigger context, a busier PC) within a few switches.
 */
export function recordLoadTime(times: LoadTimes, key: string, seconds: number): LoadTimes {
  if (!Number.isFinite(seconds) || seconds <= 0) return times
  const previous = times[key]
  const next = previous ? (previous + seconds) / 2 : seconds
  return { ...times, [key]: Math.round(next * 10) / 10 }
}

/**
 * How full the progress bar is, from 0 to 1. With an estimate it follows the elapsed time but
 * stops short of the end (0.95) until the model reports ready, so it never claims to be done early;
 * past the estimate it creeps on slowly. Without an estimate the bar is indeterminate (null).
 */
export function loadProgress(
  elapsedSeconds: number,
  estimateSeconds: number | undefined,
): number | null {
  if (!estimateSeconds) return null
  const fraction = elapsedSeconds / estimateSeconds
  if (fraction <= 0.9) return Math.max(0, fraction)
  // Past 90 % the bar slows down and approaches 95 % without reaching it.
  return 0.95 - 0.05 * Math.exp(-(fraction - 0.9) * 4)
}

/** "about 11 s" / "about 1 min 20 s" for the notice. */
export function formatSeconds(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds))
  if (rounded < 60) return `${rounded} s`
  const minutes = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`
}
