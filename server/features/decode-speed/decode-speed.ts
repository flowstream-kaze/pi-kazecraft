import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'

const defaultDecodeSpeedStorePath = process.env.PI_LIVECRAFT_DECODE_SPEED_STORE
  ?? join(homedir(), '.pi-livecraft', 'decode-speeds.json')
/** Oldest measurements are dropped beyond this count to keep the file small. */
const maxStoredSpeeds = 5_000
/** Hosts that name this machine; URL hostnames keep IPv6 literals in brackets. */
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
/** Streamed updates that carry generated tokens; their first arrival ends prompt reading. */
const generationDeltas = new Set(['text_delta', 'thinking_delta', 'toolcall_delta'])

/** A decode speed measured for one assistant reply. */
export interface DecodeSpeedMeasurement {
  key: string
  tokensPerSecond: number
}

/** Identifies a reply in both the live stream and persisted history. */
export function replyKey(message: JsonObject): string | undefined {
  if (typeof message.responseId === 'string' && message.responseId)
    return `response:${message.responseId}`
  if (typeof message.timestamp === 'number') return `timestamp:${message.timestamp}`
  return undefined
}

/**
 * Measures how fast the model writes each reply from the live Pi stream. Pi stores only the whole
 * request duration, which includes reading the prompt; the decode speed counts the output tokens
 * after the first generated one and divides them by the time from that token to the end of the reply.
 */
export class DecodeSpeedTracker {
  readonly #firstTokenAt = new Map<string, number>()

  /** Returns a measurement when `event` ends an assistant reply whose first token was observed. */
  receive(sessionId: string, event: JsonObject, now: number): DecodeSpeedMeasurement | undefined {
    if (event.type === 'message_start') {
      this.#firstTokenAt.delete(sessionId)
      return undefined
    }
    if (event.type === 'message_update') {
      const update = isObject(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined
      if (
        typeof update?.type === 'string' && generationDeltas.has(update.type)
        && !this.#firstTokenAt.has(sessionId)
      ) this.#firstTokenAt.set(sessionId, now)
      return undefined
    }
    if (event.type !== 'message_end') return undefined
    const firstTokenAt = this.#firstTokenAt.get(sessionId)
    this.#firstTokenAt.delete(sessionId)
    const message = isObject(event.message) ? event.message : undefined
    if (firstTokenAt === undefined || message?.role !== 'assistant') return undefined
    const output = isObject(message.usage) && typeof message.usage.output === 'number'
      ? message.usage.output
      : undefined
    const key = replyKey(message)
    const elapsedMs = now - firstTokenAt
    // The first token arrives with the first delta, so the timed span covers the remaining ones.
    if (!key || output === undefined || output < 2 || elapsedMs <= 0) return undefined
    return { key, tokensPerSecond: Math.round((output - 1) / (elapsedMs / 1_000) * 10) / 10 }
  }

  /** Drops the partial measurement of a session whose Pi process ended. */
  forget(sessionId: string): void {
    this.#firstTokenAt.delete(sessionId)
  }
}

/** Base URLs of the providers configured in Pi, keyed by provider name. */
export type ProviderBaseUrls = ReadonlyMap<string, string>

/** Reads provider base URLs from Pi's `models.json`, which names the local model servers. */
export async function readProviderBaseUrls(
  path = join(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'),
    'models.json',
  ),
): Promise<ProviderBaseUrls> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    const providers = isObject(value) && isObject(value.providers) ? value.providers : {}
    return new Map(
      Object.entries(providers).flatMap(([name, provider]) =>
        isObject(provider) && typeof provider.baseUrl === 'string'
          ? [[name, provider.baseUrl] as const]
          : []
      ),
    )
  } catch {
    return new Map()
  }
}

/**
 * Asks the reply's model server for the decode speed its engine measured. PolyStrata (and Strata)
 * report the last request in llama.cpp's names on `/v1/status`; the token count must match the
 * reply, so another request that finished in between is never attributed to it.
 */
export async function engineDecodeSpeed(
  message: JsonObject,
  providers: ProviderBaseUrls,
  fetchStatus: (url: URL) => Promise<unknown> = fetchJson,
): Promise<number | undefined> {
  const baseUrl = typeof message.provider === 'string'
    ? providers.get(message.provider)
    : undefined
  const output = isObject(message.usage) && typeof message.usage.output === 'number'
    ? message.usage.output
    : undefined
  if (!baseUrl || output === undefined) return undefined
  let statusUrl: URL
  try {
    statusUrl = new URL('/v1/status', baseUrl)
  } catch {
    return undefined
  }
  // Only a model server on this machine is asked: a cloud provider must not receive a request
  // after every reply, and such providers do not report engine timings anyway.
  if (!loopbackHosts.has(statusUrl.hostname)) return undefined
  try {
    const status = await fetchStatus(statusUrl)
    const timings = isObject(status) && isObject(status.last_timings)
      ? status.last_timings
      : undefined
    const speed = timings?.predicted_per_second
    if (
      typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0
      || timings?.predicted_n !== output
    ) return undefined
    return Math.round(speed * 10) / 10
  } catch {
    return undefined
  }
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** Persists measured decode speeds so reopened sessions still show them. */
export class DecodeSpeedStore {
  readonly #path: string
  #speeds: Promise<Map<string, number>> | undefined
  #saveQueue: Promise<void> = Promise.resolve()

  constructor(path = defaultDecodeSpeedStorePath) {
    this.#path = path
  }

  /** Returns the stored speeds of the given replies. */
  async lookup(keys: Iterable<string>): Promise<Map<string, number>> {
    const speeds = await this.#load()
    const found = new Map<string, number>()
    for (const key of keys) {
      const speed = speeds.get(key)
      if (speed !== undefined) found.set(key, speed)
    }
    return found
  }

  async record({ key, tokensPerSecond }: DecodeSpeedMeasurement): Promise<void> {
    const speeds = await this.#load()
    speeds.delete(key)
    speeds.set(key, tokensPerSecond)
    for (const oldest of speeds.keys()) {
      if (speeds.size <= maxStoredSpeeds) break
      speeds.delete(oldest)
    }
    const operation = this.#saveQueue.then(async () => {
      const temporaryPath = `${this.#path}.${process.pid}.tmp`
      await mkdir(dirname(this.#path), { recursive: true })
      await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(speeds))}\n`, {
        mode: 0o600,
      })
      await rename(temporaryPath, this.#path)
    })
    this.#saveQueue = operation.catch(() => undefined)
    await operation
  }

  #load(): Promise<Map<string, number>> {
    this.#speeds ??= readFile(this.#path, 'utf8')
      .then((text) => {
        const value: unknown = JSON.parse(text)
        return new Map(
          isObject(value)
            ? Object.entries(value).filter((entry): entry is [string, number] =>
              typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
            )
            : [],
        )
      })
      .catch(() => new Map<string, number>())
    return this.#speeds
  }
}
