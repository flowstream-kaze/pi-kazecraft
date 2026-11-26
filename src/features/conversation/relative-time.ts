import { useSyncExternalStore } from 'react'

const relativeUnits = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
] as const

/** Phrases a past or future moment relative to `now`, such as "2 minutes ago" or "yesterday". */
export function formatRelativeTime(time: number, now: number, locale?: string): string {
  const seconds = Math.round((time - now) / 1_000)
  if (Math.abs(seconds) < 45) return 'just now'
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  // Pick the largest unit whose rounded value reaches 1, so 23.6 hours reads "yesterday",
  // not "24 hours ago", and 59.6 minutes reads "1 hour ago".
  for (const [unit, size] of relativeUnits) {
    const value = Math.round(seconds / size)
    if (Math.abs(value) >= 1) return formatter.format(value, unit)
  }
  return formatter.format(Math.sign(seconds), 'minute')
}

/**
 * The moment a message was written as a clock time: "3:42 PM" today, "Nov 24, 3:42 PM" earlier
 * this year, and with the year for older messages.
 */
export function formatExactTime(time: Date, now: Date, locale?: string): string {
  const clock = time.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  if (time.toDateString() === now.toDateString()) return clock
  const sameYear = time.getFullYear() === now.getFullYear()
  const day = time.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `${day}, ${clock}`
}

const clockIntervalMs = 30_000
const clockListeners = new Set<() => void>()
let clockNow = Date.now()
let clockTimer: ReturnType<typeof setInterval> | undefined

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener)
  if (clockTimer === undefined) {
    clockNow = Date.now()
    clockTimer = setInterval(() => {
      clockNow = Date.now()
      for (const notify of clockListeners) notify()
    }, clockIntervalMs)
  }
  return () => {
    clockListeners.delete(listener)
    if (clockListeners.size > 0 || clockTimer === undefined) return
    clearInterval(clockTimer)
    clockTimer = undefined
  }
}

/** The current time, refreshed every 30 seconds by one timer shared by every subscriber. */
export function useClock(): number {
  return useSyncExternalStore(subscribeToClock, () => clockNow)
}
