/**
 * The welcome banner's image: the built-in banner, or one the user chose in Settings → Banners.
 * Every banner on screen subscribes, so a change shows everywhere at once, including other tabs.
 */
import { useSyncExternalStore } from 'react'
import { parseWelcomeBanner, type PreparedImage, WELCOME_BANNER_KEY } from './banner-image.ts'

export { WELCOME_BANNER_BOX } from './banner-image.ts'

function read(): PreparedImage | null {
  try {
    return parseWelcomeBanner(window.localStorage.getItem(WELCOME_BANNER_KEY))
  } catch {
    return null
  }
}

let current: PreparedImage | null | undefined
const listeners = new Set<() => void>()

function snapshot(): PreparedImage | null {
  if (current === undefined) current = read()
  return current
}

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab changed it: reread so this tab shows the same banner.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== WELCOME_BANNER_KEY) return
    current = read()
    notify()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The user's welcome banner, or null for the built-in one. */
export function useWelcomeBanner(): PreparedImage | null {
  return useSyncExternalStore(subscribe, snapshot, () => null)
}

/** Saves a new welcome banner, or restores the built-in one for null. Throws when it cannot save. */
export function setWelcomeBanner(image: PreparedImage | null): void {
  try {
    if (image) window.localStorage.setItem(WELCOME_BANNER_KEY, JSON.stringify(image))
    else window.localStorage.removeItem(WELCOME_BANNER_KEY)
  } catch {
    throw new Error('The browser could not save this image. Try a smaller one.')
  }
  current = image
  notify()
}
