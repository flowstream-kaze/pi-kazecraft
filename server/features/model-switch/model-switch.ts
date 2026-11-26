/**
 * Model switching behind llama-swap. Choosing a model in Pi is instant, but llama-swap only loads it
 * on the next request, which can take tens of seconds on a small GPU. This reports where a model
 * stands (`/running`: stopping, starting, ready) and starts loading it early, so the interface can
 * show a notice with progress instead of a silent wait.
 */
import { isObject } from '../../../shared/is-object.ts'

export type SwapState = 'ready' | 'starting' | 'stopping' | 'unloaded'

export type ModelSwitchStatus =
  /** The provider is not llama-swap on this machine, so nothing is loaded on demand. */
  | { managed: false }
  /** `state` is the requested model's; `busy` is true while another model is still stopping. */
  | { managed: true; state: SwapState; busy: boolean }

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

type FetchJson = (url: URL, timeoutMs: number) => Promise<unknown>

async function fetchJson(url: URL, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** The llama-swap origin for a provider base URL, or null when it is not on this machine. */
export function swapOrigin(baseUrl: string | undefined): URL | null {
  if (!baseUrl) return null
  try {
    const url = new URL(baseUrl)
    return loopbackHosts.has(url.hostname) ? new URL(url.origin) : null
  } catch {
    return null
  }
}

/** Reads llama-swap's `/running` list and reports the requested model's state. */
export function switchStatusFrom(running: unknown, model: string): ModelSwitchStatus {
  if (!isObject(running) || !Array.isArray(running.running)) return { managed: false }
  const entries = running.running.filter(isObject)
  const own = entries.find((entry) => entry.model === model)
  const state =
    own && (own.state === 'ready' || own.state === 'starting' || own.state === 'stopping')
      ? own.state
      : 'unloaded'
  const busy = entries.some((entry) => entry.model !== model && entry.state === 'stopping')
  return { managed: true, state, busy }
}

export async function modelSwitchStatus(
  baseUrl: string | undefined,
  model: string,
  fetcher: FetchJson = fetchJson,
): Promise<ModelSwitchStatus> {
  const origin = swapOrigin(baseUrl)
  if (!origin || !model) return { managed: false }
  try {
    return switchStatusFrom(await fetcher(new URL('/running', origin), 2_000), model)
  } catch {
    // Not llama-swap (no /running), or not running at all: nothing to report.
    return { managed: false }
  }
}

/**
 * Starts loading `model` without sending it a chat request: asking its upstream health check makes
 * llama-swap swap it in. Returns at once; the load continues and is watched through the status.
 */
export async function preloadModel(
  baseUrl: string | undefined,
  model: string,
  fetcher: FetchJson = fetchJson,
): Promise<boolean> {
  const origin = swapOrigin(baseUrl)
  if (!origin || !model) return false
  const status = await modelSwitchStatus(baseUrl, model, fetcher)
  if (!status.managed || status.state === 'ready' || status.state === 'starting')
    return status.managed
  void fetcher(new URL(`/upstream/${encodeURIComponent(model)}/health`, origin), 10 * 60_000).catch(
    () => undefined,
  )
  return true
}
