import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_NOTIFICATION_SOUNDS,
  finishedSoundKind,
  parseNotificationSounds,
} from '../src/features/notifications/notification-sounds.ts'

test('missing or malformed sound preferences fall back to the defaults', () => {
  assert.deepEqual(parseNotificationSounds(null), DEFAULT_NOTIFICATION_SOUNDS)
  assert.deepEqual(parseNotificationSounds('nonsense'), DEFAULT_NOTIFICATION_SOUNDS)
  assert.deepEqual(parseNotificationSounds('[]'), DEFAULT_NOTIFICATION_SOUNDS)
})

test('keeps valid choices, ignores unknown ones and clamps the volume', () => {
  assert.deepEqual(
    parseNotificationSounds(
      JSON.stringify({ enabled: { finished: false, input: 'yes', extra: true }, volume: 140.6 }),
    ),
    { enabled: { finished: false, input: true, background: true }, volume: 100 },
  )
  assert.equal(parseNotificationSounds(JSON.stringify({ volume: -5 })).volume, 0)
})

test('a reply in the open, visible session is "finished"; anything else is "background"', () => {
  assert.equal(finishedSoundKind('a', 'a', true), 'finished')
  assert.equal(finishedSoundKind('a', 'a', false), 'background')
  assert.equal(finishedSoundKind('b', 'a', true), 'background')
})
