import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampFontSize,
  DEFAULT_FONT_SIZES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseFontSizes,
} from '../src/features/settings/font-sizes.ts'

test('missing or malformed stored sizes fall back to the defaults', () => {
  assert.deepEqual(parseFontSizes(null), DEFAULT_FONT_SIZES)
  assert.deepEqual(parseFontSizes('not json'), DEFAULT_FONT_SIZES)
  assert.deepEqual(parseFontSizes('[1,2]'), DEFAULT_FONT_SIZES)
  assert.deepEqual(parseFontSizes('"18"'), DEFAULT_FONT_SIZES)
})

test('keeps valid stored sizes and defaults the rest', () => {
  assert.deepEqual(parseFontSizes(JSON.stringify({ message: 18, code: 'big', extra: 30 })), {
    ...DEFAULT_FONT_SIZES,
    message: 18,
  })
})

test('clamps and rounds sizes into the allowed range', () => {
  assert.equal(clampFontSize(3), MIN_FONT_SIZE)
  assert.equal(clampFontSize(99), MAX_FONT_SIZE)
  assert.equal(clampFontSize(15.6), 16)
  assert.equal(clampFontSize(Number.NaN), undefined)
  assert.equal(clampFontSize('16'), undefined)
  assert.deepEqual(parseFontSizes(JSON.stringify({ composer: 40 })), {
    ...DEFAULT_FONT_SIZES,
    composer: MAX_FONT_SIZE,
  })
})
