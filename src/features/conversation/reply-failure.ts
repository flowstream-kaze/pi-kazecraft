/**
 * A reply that ended in an error instead of text. Pi does not always keep such an error in the
 * conversation (after a failed attempt to shorten a too-long conversation it hides it), so without
 * this the conversation would just stop with no reply and no reason. Plain logic only, for tests.
 */
import { isObject } from '../../../shared/is-object.ts'

export interface ReplyFailure {
  kind: 'too-long' | 'error'
  /** "provider/model" of the model that failed. */
  model: string
  /** The provider's own error text. */
  detail: string
  /** For too-long: how many tokens were sent and how many the model holds, when the error says. */
  requested?: number
  limit?: number
}

// The wordings servers use for a request longer than the context (llama.cpp, OpenAI-compatible
// servers, PolyStrata); Pi's own overflow detection recognizes the same family of messages.
const tooLongPatterns = [
  /exceeds the available context size/i,
  /exceeds (?:the )?(?:model'?s )?(?:maximum )?context (?:length|window)/i,
  /context (?:length|window) exceeded/i,
  /context[_ ]length[_ ]exceeded|exceed_context_size/i,
  /prompt (?:is )?too long/i,
  /too many tokens/i,
  /greater than the context length/i,
]

/** The failure an assistant message reports, or null when it is a normal (or stopped) reply. */
export function replyFailureFrom(message: unknown): ReplyFailure | null {
  if (!isObject(message) || message.role !== 'assistant' || message.stopReason !== 'error')
    return null
  const detail = typeof message.errorMessage === 'string' && message.errorMessage.trim()
    ? message.errorMessage.trim()
    : 'The model returned an error without a message.'
  const model = typeof message.provider === 'string' && typeof message.model === 'string'
    ? `${message.provider}/${message.model}`
    : ''
  if (!tooLongPatterns.some((pattern) => pattern.test(detail))) {
    return { kind: 'error', model, detail }
  }
  const failure: ReplyFailure = { kind: 'too-long', model, detail }
  // llama.cpp: "request (103272 tokens) exceeds the available context size (76800 tokens)"
  const counts = [...detail.matchAll(/\((\d[\d,]*) tokens\)/g)].map((match) =>
    Number(match[1].replace(/,/g, ''))
  )
  if (counts.length >= 2) {
    failure.requested = counts[0]
    failure.limit = counts[1]
  }
  const fields = detail.match(/"n_prompt_tokens":\s*(\d+).*"n_ctx":\s*(\d+)/)
  if (fields) {
    failure.requested = Number(fields[1])
    failure.limit = Number(fields[2])
  }
  return failure
}
