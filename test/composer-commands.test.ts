import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeSessionStats,
  findModel,
  parseBuiltinCommand,
  slashMenuCommands,
} from '../src/features/composer/builtin-commands.ts'
import { isCommandDraft } from '../src/features/composer/composer-utils.ts'

test('detects only slash commands exposed by Pi', () => {
  const commands = [{ name: 'agent' }, { name: 'session-name' }]
  assert.equal(isCommandDraft('/agent frontend', commands), true)
  assert.equal(isCommandDraft('  /SESSION-NAME demo', commands), true)
  assert.equal(isCommandDraft('/unknown', commands), false)
  assert.equal(isCommandDraft('agent', commands), false)
})

test('parses built-in commands with their arguments', () => {
  assert.deepEqual(parseBuiltinCommand('/compact', []), { kind: 'run', name: 'compact', args: '' })
  assert.deepEqual(parseBuiltinCommand('  /Compact keep the API notes  ', []), {
    kind: 'run',
    name: 'compact',
    args: 'keep the API notes',
  })
  assert.deepEqual(parseBuiltinCommand('/name ', []), { kind: 'run', name: 'name', args: '' })
  assert.deepEqual(parseBuiltinCommand('/model polystrata/gemma', []), {
    kind: 'run',
    name: 'model',
    args: 'polystrata/gemma',
  })
})

test('points terminal-only commands elsewhere instead of sending them to the model', () => {
  const parsed = parseBuiltinCommand('/login', [])
  assert.equal(parsed?.kind, 'terminal-only')
})

test('leaves ordinary text and unknown commands alone', () => {
  assert.equal(parseBuiltinCommand('compact the code', []), null)
  assert.equal(parseBuiltinCommand('/unknown thing', []), null)
  assert.equal(parseBuiltinCommand('/', []), null)
})

test('lets a Pi command with the same name win over a built-in', () => {
  assert.equal(parseBuiltinCommand('/compact', [{ name: 'compact' }]), null)
  const menu = slashMenuCommands([{ name: 'compact' }, { name: 'agent' }])
  assert.equal(menu.filter((command) => command.name === 'compact').length, 1)
  assert.ok(menu.some((command) => command.name === 'model'))
  assert.ok(menu.some((command) => command.name === 'agent'))
})

test('finds a model by provider/id, id, or a unique partial name', () => {
  const models = [
    { provider: 'polystrata', id: 'gemma-4-26b', name: 'Local Gemma 4' },
    { provider: 'polystrata', id: 'qwen3.6-35b', name: 'Local Qwen3.6' },
    { provider: 'polystrata', id: 'qwen3.8-gyro', name: 'Local Qwen3.8 Gyro-S' },
  ]
  assert.equal(findModel(models, 'polystrata/qwen3.6-35b')?.id, 'qwen3.6-35b')
  assert.equal(findModel(models, 'GEMMA-4-26B')?.id, 'gemma-4-26b')
  assert.equal(findModel(models, 'gyro')?.id, 'qwen3.8-gyro')
  assert.equal(findModel(models, 'qwen'), null)
  assert.equal(findModel(models, ''), null)
})

test('summarizes session statistics on one line', () => {
  const line = describeSessionStats({
    userMessages: 3,
    assistantMessages: 3,
    toolCalls: 7,
    tokens: { input: 12000, output: 800 },
    contextUsage: { tokens: 9000, contextWindow: 131072, percent: 6.9 },
  }, 'Demo')
  assert.equal(
    line,
    '“Demo” · 3 prompts, 3 replies, 7 tool calls · 12,000 tokens in, 800 out · context 9,000 of 131,072 (7%)',
  )
})
