import assert from 'node:assert/strict'
import test from 'node:test'
import { replyFailureFrom } from '../src/features/conversation/reply-failure.ts'

test('a too-long request to llama.cpp is reported with both token counts', () => {
  const failure = replyFailureFrom({
    role: 'assistant',
    stopReason: 'error',
    provider: 'bonsai',
    model: 'bonsai-2.5-27b',
    errorMessage:
      '400: {"code":400,"message":"request (103272 tokens) exceeds the available context size (76800 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":103272,"n_ctx":76800}',
  })
  assert.equal(failure?.kind, 'too-long')
  assert.equal(failure?.model, 'bonsai/bonsai-2.5-27b')
  assert.equal(failure?.requested, 103272)
  assert.equal(failure?.limit, 76800)
})

test('another error keeps its own text', () => {
  const failure = replyFailureFrom({
    role: 'assistant',
    stopReason: 'error',
    provider: 'polystrata',
    model: 'gemma',
    errorMessage: 'Connection refused',
  })
  assert.deepEqual(failure, {
    kind: 'error',
    model: 'polystrata/gemma',
    detail: 'Connection refused',
  })
})

test('normal, stopped and user messages are not failures', () => {
  assert.equal(replyFailureFrom({ role: 'assistant', stopReason: 'stop' }), null)
  assert.equal(replyFailureFrom({ role: 'assistant', stopReason: 'aborted' }), null)
  assert.equal(replyFailureFrom({ role: 'user', stopReason: 'error' }), null)
  assert.equal(replyFailureFrom('not a message'), null)
})
