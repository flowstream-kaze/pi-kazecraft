import {
  defaultVoice,
  isReadAloudVoice,
  type ReadAloudVoice,
} from '../../../shared/read-aloud-voices.ts'

const key = 'pi-livecraft.read-aloud-voice'
let inMemory: ReadAloudVoice = defaultVoice

export function readVoice(): ReadAloudVoice {
  try {
    const saved = localStorage.getItem(key)
    return isReadAloudVoice(saved) ? saved : defaultVoice
  } catch {
    return inMemory
  }
}

export function selectVoice(value: string): void {
  if (!isReadAloudVoice(value)) return
  inMemory = value
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private browsing may disable persistent storage.
  }
  window.dispatchEvent(new Event(key))
}

export function subscribeVoice(update: () => void): () => void {
  window.addEventListener(key, update)
  window.addEventListener('storage', update)
  return () => {
    window.removeEventListener(key, update)
    window.removeEventListener('storage', update)
  }
}
