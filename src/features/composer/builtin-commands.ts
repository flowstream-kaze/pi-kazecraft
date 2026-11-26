import type { JsonObject } from '../../../shared/types.ts'

/**
 * Pi's built-in terminal commands. Pi handles them only in its interactive TUI: in RPC mode `get_commands`
 * omits them and a `prompt` would send them to the model as plain text. Pi Local AI therefore runs each one
 * itself, through the matching RPC command or its own UI.
 */
export interface BuiltinCommand {
  name: string
  description: string
  /** Shown after the name in the slash menu, e.g. `[provider/model]`. */
  args?: string
}

/** Commands this app can run, in the order the slash menu lists them. */
export const builtinCommands: readonly BuiltinCommand[] = [
  { name: 'model', args: '[provider/model]', description: 'Select a model' },
  { name: 'thinking', args: '[level]', description: 'Set the thinking level' },
  { name: 'compact', args: '[instructions]', description: 'Compact the current context' },
  { name: 'new', description: 'Start a new session' },
  { name: 'name', args: '[name]', description: 'Set or show the session name' },
  { name: 'session', description: 'Show session information and statistics' },
  { name: 'fork', description: 'Restart from your last message, with it back in the chatbox' },
  { name: 'copy', description: 'Copy the last assistant message' },
  { name: 'export', args: '[path.html]', description: 'Export the session as HTML' },
  {
    name: 'reload',
    description: 'Restart Pi for this session to reload extensions, skills and prompts',
  },
  { name: 'settings', description: 'Open settings' },
  { name: 'hotkeys', description: 'Show keyboard shortcuts' },
]

/** Pi commands that only make sense in its terminal, with where to go instead. */
const terminalOnlyCommands: Readonly<Record<string, string>> = {
  clone: 'Use the Edit or Rewind buttons under a message to branch the conversation.',
  resume: 'Pick a session in the sidebar to resume it.',
  tree: 'Use the Edit or Rewind buttons under a message to branch the conversation.',
  quit: 'Close the session from its menu in the sidebar.',
  ...Object.fromEntries(
    [
      'scoped-models',
      'login',
      'logout',
      'llama',
      'mcp',
      'trust',
      'share',
      'bug',
      'import',
      'changelog',
    ]
      .map((name) => [name, 'Open Pi in a terminal to use it.']),
  ),
}

export type ParsedBuiltinCommand =
  | { kind: 'run'; name: string; args: string }
  | { kind: 'terminal-only'; name: string; hint: string }

/**
 * Recognizes a draft that is a built-in Pi command. A command that Pi itself exposes (an extension, prompt
 * template or skill with the same name) wins, so it is left for Pi to run.
 */
export function parseBuiltinCommand(
  text: string,
  piCommands: JsonObject[],
): ParsedBuiltinCommand | null {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return null
  const name = match[1].toLowerCase()
  if (piCommands.some((command) => String(command.name).toLowerCase() === name)) return null
  if (builtinCommands.some((command) => command.name === name))
    return { kind: 'run', name, args: (match[2] ?? '').trim() }
  const hint = terminalOnlyCommands[name]
  return hint ? { kind: 'terminal-only', name, hint } : null
}

/** The slash menu: Pi's own commands, plus every built-in that none of them overrides. */
export function slashMenuCommands(piCommands: JsonObject[]): JsonObject[] {
  const names = new Set(piCommands.map((command) => String(command.name).toLowerCase()))
  const builtins = builtinCommands
    .filter((command) => !names.has(command.name))
    .map((command): JsonObject => ({
      name: command.name,
      description: command.args ? `${command.args}  ${command.description}` : command.description,
      source: 'builtin',
    }))
  return [...builtins, ...piCommands]
}

interface ModelChoice {
  provider: string
  id: string
  name?: string
}

/**
 * Finds the model a `/model` argument names: an exact `provider/id`, then an exact id, then the only model
 * whose id or display name contains the text. Returns null when nothing or more than one model matches.
 */
export function findModel<T extends ModelChoice>(models: T[], query: string): T | null {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return null
  const exact = models.find((model) => `${model.provider}/${model.id}`.toLowerCase() === wanted)
    ?? models.find((model) => model.id.toLowerCase() === wanted)
  if (exact) return exact
  const partial = models.filter((model) =>
    model.id.toLowerCase().includes(wanted) || (model.name ?? '').toLowerCase().includes(wanted)
  )
  return partial.length === 1 ? partial[0] : null
}

/** One line of session facts for `/session`, from Pi's `get_session_stats` data. */
export function describeSessionStats(stats: JsonObject, sessionName: string): string {
  const number = (value: unknown): number => typeof value === 'number' ? value : 0
  const count = (value: unknown, noun: string): string =>
    `${number(value)} ${noun}${number(value) === 1 ? '' : 's'}`
  const tokens = typeof stats.tokens === 'object' && stats.tokens !== null
    ? stats.tokens as JsonObject
    : {}
  const context = typeof stats.contextUsage === 'object' && stats.contextUsage !== null
    ? stats.contextUsage as JsonObject
    : null
  const parts = [
    `“${sessionName}”`,
    `${count(stats.userMessages, 'prompt')}, ${
      number(stats.assistantMessages) === 1
        ? '1 reply'
        : `${number(stats.assistantMessages)} replies`
    }, ${count(stats.toolCalls, 'tool call')}`,
    `${number(tokens.input).toLocaleString('en-US')} tokens in, ${
      number(tokens.output).toLocaleString('en-US')
    } out`,
  ]
  if (context && typeof context.tokens === 'number' && typeof context.contextWindow === 'number') {
    parts.push(
      `context ${context.tokens.toLocaleString('en-US')} of ${
        context.contextWindow.toLocaleString('en-US')
      } (${Math.round(number(context.percent))}%)`,
    )
  }
  return parts.join(' · ')
}
