import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatSeconds,
  loadProgress,
  parseLoadTimes,
  recordLoadTime,
} from '../src/features/composer/model-switch.ts'

test('learns load times, weighting the newest measurement as much as the history', () => {
  const first = recordLoadTime({}, 'bonsai/bonsai-2.5-27b', 11.4)
  assert.deepEqual(first, { 'bonsai/bonsai-2.5-27b': 11.4 })
  assert.deepEqual(recordLoadTime(first, 'bonsai/bonsai-2.5-27b', 13.6), {
    'bonsai/bonsai-2.5-27b': 12.5,
  })
  assert.equal(recordLoadTime(first, 'x', Number.NaN), first)
})

test('stored load times tolerate damage', () => {
  assert.deepEqual(parseLoadTimes(null), {})
  assert.deepEqual(parseLoadTimes('nope'), {})
  assert.deepEqual(parseLoadTimes(JSON.stringify({ a: 12, b: -1, c: 'x', d: 99999 })), { a: 12 })
})

test('progress follows the estimate but never reaches the end before the model is ready', () => {
  assert.equal(loadProgress(5, undefined), null, 'no estimate: indeterminate')
  assert.equal(loadProgress(0, 20), 0)
  assert.equal(loadProgress(10, 20), 0.5)
  assert.ok(Math.abs((loadProgress(18, 20) ?? 0) - 0.9) < 1e-9)
  const late = loadProgress(40, 20) ?? 0
  assert.ok(late > 0.9 && late < 0.95, `twice the estimate stays under 95 % (${late})`)
  assert.ok((loadProgress(30, 20) ?? 0) < late, 'still creeping forward')
})

test('formats waiting times plainly', () => {
  assert.equal(formatSeconds(0.2), '1 s')
  assert.equal(formatSeconds(11.4), '11 s')
  assert.equal(formatSeconds(60), '1 min')
  assert.equal(formatSeconds(83), '1 min 23 s')
})
