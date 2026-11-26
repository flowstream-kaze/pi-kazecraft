import assert from 'node:assert/strict'
import test from 'node:test'
import { nextConversationView } from '../src/features/conversation/conversation-view.ts'
import { formatExactTime, formatRelativeTime } from '../src/features/conversation/relative-time.ts'
import { speakableText, speechPassages } from '../src/features/conversation/speakable-text.ts'

const minute = 60_000

test('keeps read-aloud passages bounded and preserves long identifiers and Unicode', () => {
  const identifier = 'a'.repeat(399) + '😀' + 'b'.repeat(420)
  const passages = [...speechPassages('Hello. ' + identifier)]
  assert.equal(passages.shift(), 'Hello.')
  assert.ok(passages.every(text => text.length <= 400 && !text.endsWith('\ud83d')))
  assert.equal(passages.join(''), identifier)
})

test('shows the clock time, with the date only when it was not today', () => {
  const now = new Date(2026, 10, 25, 18, 0)
  // Intl may use a narrow no-break space before AM/PM; compare with plain spaces.
  const plain = (text: string) => text.replace(/\s/g, ' ')
  assert.equal(plain(formatExactTime(new Date(2026, 10, 25, 15, 42), now, 'en-US')), '3:42 PM')
  assert.equal(
    plain(formatExactTime(new Date(2026, 10, 24, 9, 5), now, 'en-US')),
    'Nov 24, 9:05 AM',
  )
  assert.equal(
    plain(formatExactTime(new Date(2025, 0, 3, 21, 30), now, 'en-US')),
    'Jan 3, 2025, 9:30 PM',
  )
})

test('phrases message times relative to now', () => {
  const now = Date.UTC(2026, 10, 24, 12)
  assert.equal(formatRelativeTime(now - 10_000, now, 'en'), 'just now')
  assert.equal(formatRelativeTime(now - minute, now, 'en'), '1 minute ago')
  assert.equal(formatRelativeTime(now - 2 * minute, now, 'en'), '2 minutes ago')
  assert.equal(formatRelativeTime(now - 3 * 60 * minute, now, 'en'), '3 hours ago')
  assert.equal(formatRelativeTime(now - 24 * 60 * minute, now, 'en'), 'yesterday')
  assert.equal(formatRelativeTime(now - 23.6 * 60 * minute, now, 'en'), 'yesterday')
  assert.equal(formatRelativeTime(now - 59.6 * minute, now, 'en'), '1 hour ago')
})

test('drops Markdown that reads badly aloud', () => {
  assert.equal(
    speakableText(
      '# Title\n\n**Bold** and `code` with a [link](https://x.test).\n\n```js\nlet a\n```',
    ),
    'Title Bold and code with a link. code block.',
  )
})

test('cycles the conversation view from simple to detailed and back', () => {
  assert.equal(nextConversationView('simple'), 'semi-detailed')
  assert.equal(nextConversationView('semi-detailed'), 'detailed')
  assert.equal(nextConversationView('detailed'), 'simple')
})
