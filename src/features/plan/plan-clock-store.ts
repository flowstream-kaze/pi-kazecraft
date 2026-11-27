import {
  parseStoredPlanTiming,
  serializeStoredPlanTiming,
  type PlanTiming,
  type StoredPlanTiming,
} from './plan-state.ts'

const storagePrefix = 'pi-kazecraft.plan-timing.'

/**
 * Active time the panel folded itself, kept across a reload. The payload in the session only knows
 * the work up to the last `update_plan` call, so a paused or running timer needs this copy.
 */
export function readPlanTiming(sessionId: string): StoredPlanTiming | undefined {
  const value = window.localStorage.getItem(storagePrefix + sessionId)
  if (value === null) return undefined
  try {
    return parseStoredPlanTiming(JSON.parse(value))
  } catch {
    return undefined
  }
}

export function writePlanTiming(sessionId: string, timing: PlanTiming, savedAt: number): void {
  const stored = serializeStoredPlanTiming(timing, savedAt)
  window.localStorage.setItem(storagePrefix + sessionId, JSON.stringify(stored))
}

/** Forgets the folded time when a new turn starts, so a later plan never inherits it. */
export function clearPlanTiming(sessionId: string): void {
  window.localStorage.removeItem(storagePrefix + sessionId)
}
