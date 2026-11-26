import { useCallback, useEffect, useRef, useState } from 'react'
import { getModelSwitchStatus, preloadModel } from '../../api.ts'
import {
  type LoadTimes,
  MODEL_LOAD_TIMES_KEY,
  parseLoadTimes,
  recordLoadTime,
} from './model-switch.ts'

export interface ModelSwitch {
  /** "provider/model". */
  key: string
  /** The model's display name. */
  name: string
  startedAt: number
  /** Learned load time in seconds, if this model has been loaded before. */
  estimate?: number
  phase: 'loading' | 'ready' | 'failed'
}

const pollMs = 1_000
const giveUpMs = 10 * 60_000
const readyShownMs = 1_800

function readLoadTimes(): LoadTimes {
  try {
    return parseLoadTimes(window.localStorage.getItem(MODEL_LOAD_TIMES_KEY))
  } catch {
    return {}
  }
}

/**
 * Watches a model being loaded by llama-swap and exposes it for the composer's notice. `track`
 * does nothing when the model is already loaded or its server is not llama-swap, so the notice
 * only appears when there really is a wait.
 */
export function useModelSwitch(): {
  current: ModelSwitch | null
  track: (provider: string, model: string, name: string, options?: { preload?: boolean }) => void
  dismiss: () => void
} {
  const [current, setCurrent] = useState<ModelSwitch | null>(null)
  // Each track call gets a token; a newer call (another model picked) ends the older poll.
  const tokenRef = useRef(0)

  useEffect(() => () => {
    tokenRef.current += 1
  }, [])

  const track = useCallback((
    provider: string,
    model: string,
    name: string,
    { preload = false }: { preload?: boolean } = {},
  ): void => {
    const token = ++tokenRef.current
    const key = `${provider}/${model}`
    const live = () => token === tokenRef.current
    void (async () => {
      try {
        const first = await getModelSwitchStatus(provider, model)
        if (!live() || !first.managed) return
        if (first.state === 'ready' && !first.busy) return
        if (preload) await preloadModel(provider, model)
        const startedAt = Date.now()
        setCurrent({ key, name, startedAt, estimate: readLoadTimes()[key], phase: 'loading' })
        while (live()) {
          await new Promise((resolve) => setTimeout(resolve, pollMs))
          if (!live()) return
          const status = await getModelSwitchStatus(provider, model).catch(() => null)
          if (status && status.managed && status.state === 'ready' && !status.busy) {
            const seconds = (Date.now() - startedAt) / 1000
            try {
              window.localStorage.setItem(
                MODEL_LOAD_TIMES_KEY,
                JSON.stringify(recordLoadTime(readLoadTimes(), key, seconds)),
              )
            } catch {
              // The estimate is a convenience; nothing breaks without it.
            }
            setCurrent((value) => value && value.key === key ? { ...value, phase: 'ready' } : value)
            await new Promise((resolve) => setTimeout(resolve, readyShownMs))
            if (live()) setCurrent(null)
            return
          }
          if (Date.now() - startedAt > giveUpMs) {
            setCurrent((value) =>
              value && value.key === key ? { ...value, phase: 'failed' } : value
            )
            return
          }
        }
      } catch {
        if (live()) setCurrent(null)
      }
    })()
  }, [])

  const dismiss = useCallback((): void => {
    tokenRef.current += 1
    setCurrent(null)
  }, [])

  return { current, track, dismiss }
}
