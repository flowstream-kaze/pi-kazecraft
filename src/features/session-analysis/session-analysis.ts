import type { JsonObject, SessionStats } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import {
  messageUsage,
  turnUsageByMessage,
  type MessageUsage,
} from '../conversation/message-usage.ts'
import { toolDataLength } from '../conversation/tool-presentation.ts'
import {
  toolCallsInMessage,
  toolContentText,
  toolResultInMessage,
  type ToolExecution,
} from '../conversation/tool-protocol.ts'

export type SessionAnalysisTarget = { kind: 'message' | 'turn'; index: number } | {
  kind: 'tool'
  id: string
}

export interface AnalyzedTurn {
  messageIndex: number
  number: number
  usage: MessageUsage
  toolCallCount: number
}

export interface AnalyzedToolCall {
  id: string
  name: string
  requestMessageIndex: number
  turnMessageIndex?: number
  inputLength: number
  outputLength: number
  isError: boolean
  pending: boolean
  durationMs?: number
}

export interface AnalyzedRequest {
  messageIndex: number
  title: string
  usage: MessageUsage
  modelCallCount: number
  toolCalls: AnalyzedToolCall[]
  failedToolCalls: number
  complete: boolean
  durationMs?: number
}

export interface ToolSummary {
  name: string
  count: number
  failed: number
  inputLength: number
  outputLength: number
  durationMs: number
  measuredDurationCount: number
}

export interface SessionAnalysis {
  requests: AnalyzedRequest[]
  turns: AnalyzedTurn[]
  toolCalls: AnalyzedToolCall[]
  tools: ToolSummary[]
  turnCount: number
  averageToolCallsPerTurn: number
  totalToolCalls: number
  failedToolCalls: number
  contextPercent?: number
  tokens: MessageUsage
  tokensAvailable: boolean
}

interface AnalysisTelemetry {
  requestDurations?: ReadonlyMap<number, number>
  toolDurations?: ReadonlyMap<string, number>
  toolExecutions?: ToolExecution[]
}

interface MutableRequest extends AnalyzedRequest {
  usage: MessageUsage
}

const emptyUsage = (): MessageUsage => ({
  cacheMiss: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
})

/** Reconstructs assistant turns, user cycles, and their calls from Pi's public contract. */
export function analyzeSession(
  messages: JsonObject[],
  stats: SessionStats | null,
  running: boolean,
  telemetry: AnalysisTelemetry = {},
): SessionAnalysis {
  const resultsByCallId = new Map(messages.flatMap((message) => {
    const result = toolResultInMessage(message)
    return result ? [[result.toolCallId, result] as const] : []
  }))
  const executionsByCallId = new Map(
    telemetry.toolExecutions?.map((execution) => [execution.id, execution]) ?? [],
  )
  const requests: MutableRequest[] = []
  const seenToolCallIds = new Set<string>()
  let currentRequest: MutableRequest | undefined

  messages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      currentRequest = {
        messageIndex,
        title: messageTitle(message),
        usage: emptyUsage(),
        modelCallCount: 0,
        toolCalls: [],
        failedToolCalls: 0,
        complete: true,
        durationMs: typeof message.timestamp === 'number'
          ? telemetry.requestDurations?.get(message.timestamp)
          : undefined,
      }
      requests.push(currentRequest)
      return
    }
    if (!currentRequest) return

    if (message.role === 'assistant') {
      const usage = messageUsage(message)
      if (usage) {
        addUsage(currentRequest.usage, usage)
        currentRequest.modelCallCount += 1
      }
      for (const call of toolCallsInMessage(message)) {
        const execution = executionsByCallId.get(call.id)
        const result = resultsByCallId.get(call.id) ?? execution?.result
        const analyzedCall: AnalyzedToolCall = {
          id: call.id,
          name: call.name,
          requestMessageIndex: currentRequest.messageIndex,
          turnMessageIndex: messageIndex,
          inputLength: toolDataLength(call.args),
          outputLength: result ? toolContentText(result.content).length : 0,
          isError: result?.isError === true,
          pending: result === undefined,
          durationMs: telemetry.toolDurations?.get(call.id),
        }
        currentRequest.toolCalls.push(analyzedCall)
        seenToolCallIds.add(call.id)
      }
      return
    }

    if (message.role === 'toolResult') {
      const usage = messageUsage(message)
      if (usage) addUsage(currentRequest.usage, usage)
    }
  })

  const activeRequest = requests.at(-1) ?? createActiveRequest()
  for (const execution of telemetry.toolExecutions ?? []) {
    if (seenToolCallIds.has(execution.id)) continue
    const call: AnalyzedToolCall = {
      id: execution.id,
      name: execution.name,
      requestMessageIndex: activeRequest.messageIndex,
      inputLength: toolDataLength(execution.args),
      outputLength: execution.result ? toolContentText(execution.result.content).length : 0,
      isError: execution.result?.isError === true,
      pending: execution.result === undefined,
      durationMs: telemetry.toolDurations?.get(execution.id),
    }
    activeRequest.toolCalls.push(call)
    seenToolCallIds.add(execution.id)
  }
  if (activeRequest.messageIndex === -1 && activeRequest.toolCalls.length > 0)
    requests.push(activeRequest)

  requests.forEach((request, index) => {
    request.failedToolCalls = request.toolCalls.filter((call) => call.isError).length
    request.complete = index < requests.length - 1 || !running
  })

  const toolCalls = requests.flatMap((request) => request.toolCalls)
  const attributionAvailable = requests.some((request) => request.modelCallCount > 0)
  const turns = [...turnUsageByMessage(messages)].map(([messageIndex, usage], index) => ({
    messageIndex,
    number: index + 1,
    usage,
    toolCallCount: toolCallsInMessage(messages[messageIndex] ?? {}).length,
  }))
  const parsedUsage = requests.reduce(
    (total, request) => addUsage(total, request.usage),
    emptyUsage(),
  )
  const statsTokens = statsUsage(stats)
  const tokens = statsTokens ?? parsedUsage
  const totalToolCalls = Math.max(stats?.toolCalls ?? 0, toolCalls.length)

  return {
    requests,
    turns,
    toolCalls,
    tools: summarizeTools(toolCalls),
    turnCount: turns.length,
    averageToolCallsPerTurn: turns.length ? totalToolCalls / turns.length : 0,
    totalToolCalls,
    failedToolCalls: toolCalls.filter((call) => call.isError).length,
    contextPercent: finiteNumber(stats?.contextUsage?.percent),
    tokens,
    tokensAvailable: statsTokens !== null || attributionAvailable,
  }
}

/** Builds a bounded, data-only prompt from the deterministic session report. */
export function buildSessionAnalysisPrompt(analysis: SessionAnalysis): string {
  const percent = (value: number, total: number) =>
    total > 0 ? Math.round(value / total * 1_000) / 10 : null
  const turnTokens = (turn: AnalyzedTurn) =>
    turn.usage.cacheMiss + turn.usage.cacheRead + turn.usage.cacheWrite + turn.usage.output
  const visibleTurnTokens = analysis.turns.reduce((total, turn) => total + turnTokens(turn), 0)
  const turnNumbers = new Map(
    analysis.turns.map((turn) => [turn.messageIndex, turn.number] as const),
  )
  const toolCallsByTurn = new Map<number, AnalyzedToolCall[]>()
  for (const call of analysis.toolCalls) {
    if (call.turnMessageIndex === undefined) continue
    const calls = toolCallsByTurn.get(call.turnMessageIndex) ?? []
    calls.push(call)
    toolCallsByTurn.set(call.turnMessageIndex, calls)
  }
  const turnSnapshot = (turn: AnalyzedTurn) => {
    const calls = toolCallsByTurn.get(turn.messageIndex) ?? []
    const measuredCalls = calls.filter((call) => call.durationMs !== undefined)
    return {
      turn: turn.number,
      tokens: turnTokens(turn),
      tokensPercentOfVisibleTurns: percent(turnTokens(turn), visibleTurnTokens),
      cacheMiss: turn.usage.cacheMiss,
      cacheRead: turn.usage.cacheRead,
      cacheWrite: turn.usage.cacheWrite,
      output: turn.usage.output,
      toolCallCount: turn.toolCallCount,
      tools: calls.slice(0, 8).map((call) => call.name),
      toolFailures: calls.filter((call) => call.isError).length,
      toolInputLength: calls.reduce((total, call) => total + call.inputLength, 0),
      toolOutputLength: calls.reduce((total, call) => total + call.outputLength, 0),
      measuredToolDurations: measuredCalls.length,
      measuredToolDurationMs: measuredCalls.length > 0
        ? measuredCalls.reduce((total, call) => total + (call.durationMs ?? 0), 0)
        : null,
    }
  }
  const toolCallSnapshot = (call: AnalyzedToolCall) => ({
    turn: call.turnMessageIndex === undefined
      ? null
      : turnNumbers.get(call.turnMessageIndex) ?? null,
    name: call.name,
    inputLength: call.inputLength,
    outputLength: call.outputLength,
    durationMs: call.durationMs ?? null,
    failed: call.isError,
    pending: call.pending,
  })
  const heaviestTurns = [...analysis.turns]
    .sort((a, b) => turnTokens(b) - turnTokens(a))
    .slice(0, 5)
    .map(turnSnapshot)
  const largestToolOutputs = [...analysis.toolCalls]
    .filter((call) => call.outputLength > 0)
    .sort((a, b) => b.outputLength - a.outputLength)
    .slice(0, 4)
    .map(toolCallSnapshot)
  const slowestToolCalls = [...analysis.toolCalls]
    .filter((call) => call.durationMs !== undefined)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 4)
    .map(toolCallSnapshot)
  const failedToolCalls = analysis
    .toolCalls
    .filter((call) => call.isError)
    .slice(0, 5)
    .map(toolCallSnapshot)
  const topThreeTurnTokens = heaviestTurns
    .slice(0, 3)
    .reduce((total, turn) => total + turn.tokens, 0)
  const inputTokens = analysis.tokens.cacheMiss
    + analysis.tokens.cacheRead
    + analysis.tokens.cacheWrite
  const observedToolCalls = analysis.toolCalls.length
  const measuredToolDurations =
    analysis.toolCalls.filter((call) => call.durationMs !== undefined).length
  const snapshot = {
    indicators: {
      turns: {
        count: analysis.turnCount,
        visibleTurnTokens,
        averageTokensPerTurn: analysis.turnCount > 0
          ? Math.round(visibleTurnTokens / analysis.turnCount)
          : null,
        maximumTokensPerTurn: heaviestTurns[0]?.tokens ?? null,
        topTurnPercentOfVisibleTokens: percent(heaviestTurns[0]?.tokens ?? 0, visibleTurnTokens),
        topThreeTurnsPercentOfVisibleTokens: percent(topThreeTurnTokens, visibleTurnTokens),
      },
      cacheAndContext: {
        contextUsedPercent: analysis.contextPercent ?? null,
        tokens: analysis.tokensAvailable
          ? {
            input: inputTokens,
            cacheMiss: analysis.tokens.cacheMiss,
            cacheRead: analysis.tokens.cacheRead,
            cacheWrite: analysis.tokens.cacheWrite,
            output: analysis.tokens.output,
          }
          : null,
        cacheReadPercentOfInput: analysis.tokensAvailable
          ? percent(analysis.tokens.cacheRead, inputTokens)
          : null,
        cacheMissPercentOfInput: analysis.tokensAvailable
          ? percent(analysis.tokens.cacheMiss, inputTokens)
          : null,
      },
      tools: {
        totalCalls: analysis.totalToolCalls,
        observedCalls: observedToolCalls,
        averageCallsPerTurn: analysis.turnCount > 0 ? analysis.averageToolCallsPerTurn : null,
        explicitFailures: analysis.failedToolCalls,
        observedFailurePercent: percent(analysis.failedToolCalls, observedToolCalls),
        pendingCalls: analysis.toolCalls.filter((call) => call.pending).length,
        measuredDurations: measuredToolDurations,
        durationCoveragePercent: percent(measuredToolDurations, observedToolCalls),
      },
    },
    evidence: {
      heaviestTurns,
      mostUsedTools: analysis.tools.slice(0, 6),
      largestToolOutputs,
      slowestToolCalls,
      failedToolCalls,
    },
    dataQuality: {
      tokensAvailable: analysis.tokensAvailable,
      toolDetailsPartial: observedToolCalls < analysis.totalToolCalls,
      toolsWithoutTurn: analysis
        .toolCalls
        .filter(
          (call) => call.turnMessageIndex === undefined || !turnNumbers.has(call.turnMessageIndex),
        )
        .length,
    },
  }
  return [
    'Analyze only the JSON snapshot below. Focus on turns and tools without restating every metric.',
    'Answer in English, in 120 words at most, with exactly this Markdown structure:',
    '**Summary** — one sentence that characterizes the session without vague judgment.',
    '- **Key turns** — cite one to three turns by number, ranked by tokens; give their tokens and their share of the visible turn tokens, then the metrics that set them apart.',
    '- **Tools** — point out frequent, failed, large, or slow tools and tie them to their turn when it is known.',
    '- **Cache & context** — explain only the overall signal or the one specific to the key turns.',
    '**Priority** — one concrete action based on the strongest signal, or "No priority action".',
    'A turn is key here by its token count and its share of the visible turn tokens. Its tools characterize it; never attribute its tokens to them.',
    'Support each finding with one or two values. If an area is healthy, say so; if data is missing or partial, qualify it briefly.',
    'cacheReadPercentOfInput is the share of input tokens read back from the cache: a high value is generally good. Tool lengths are characters, not tokens. Durations apply only to measured calls.',
    'Do not attribute unobserved causes and never infer the content of the conversation or the tools.',
    '<session_analysis_json>',
    JSON.stringify(snapshot),
    '</session_analysis_json>',
  ]
    .join('\n')
}

function createActiveRequest(): MutableRequest {
  return {
    messageIndex: -1,
    title: 'Request in progress',
    usage: emptyUsage(),
    modelCallCount: 0,
    toolCalls: [],
    failedToolCalls: 0,
    complete: false,
  }
}

/** Accumulates one MessageUsage record into another, mutating the target in place. */
function addUsage(target: MessageUsage, usage: MessageUsage): MessageUsage {
  target.cacheMiss += usage.cacheMiss
  target.cacheRead += usage.cacheRead
  target.cacheWrite += usage.cacheWrite
  target.output += usage.output
  return target
}

/** Converts a snapshot token breakdown into MessageUsage, or returns null when unavailable. */
function statsUsage(stats: SessionStats | null): MessageUsage | null {
  const tokens = stats?.tokens
  if (!tokens) return null
  const cacheMiss = finiteNumber(tokens.input)
  const cacheRead = finiteNumber(tokens.cacheRead)
  const cacheWrite = finiteNumber(tokens.cacheWrite)
  const output = finiteNumber(tokens.output)
  if (
    cacheMiss === undefined || cacheRead === undefined || cacheWrite === undefined
    || output === undefined
  ) return null
  return { cacheMiss, cacheRead, cacheWrite, output }
}

/** Aggregates tool call metrics by tool name, sorted by call count. */
function summarizeTools(calls: AnalyzedToolCall[]): ToolSummary[] {
  const summaries = new Map<string, ToolSummary>()
  for (const call of calls) {
    const summary = summaries.get(call.name)
      ?? {
        name: call.name,
        count: 0,
        failed: 0,
        inputLength: 0,
        outputLength: 0,
        durationMs: 0,
        measuredDurationCount: 0,
      }
    summary.count += 1
    summary.failed += Number(call.isError)
    summary.inputLength += call.inputLength
    summary.outputLength += call.outputLength
    if (call.durationMs !== undefined) {
      summary.durationMs += call.durationMs
      summary.measuredDurationCount += 1
    }
    summaries.set(call.name, summary)
  }
  return [...summaries.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Produces a short title from the user message text, truncating at 90 characters. */
function messageTitle(message: JsonObject): string {
  const content = message.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
    ? content
      .flatMap((part) =>
        isObject(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
      )
      .join(' ')
    : ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 90 ? `${normalized.slice(0, 89)}…` : normalized || 'Untitled request'
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
