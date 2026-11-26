import assert from 'node:assert/strict'
import test from 'node:test'
import { bannerDisplaySize, parseWelcomeBanner } from '../src/components/banner-image.ts'

test('banners keep their proportions within 460 x 200 and are never scaled up', () => {
  assert.deepEqual(
    bannerDisplaySize(920, 307),
    { width: 460, height: 154 },
    'the built-in 3:1 banner',
  )
  assert.deepEqual(
    bannerDisplaySize(1200, 1200),
    { width: 200, height: 200 },
    'a square is held to 200 tall',
  )
  assert.deepEqual(
    bannerDisplaySize(400, 1600),
    { width: 50, height: 200 },
    'a tall image is held to 200 tall',
  )
  assert.deepEqual(bannerDisplaySize(2000, 100), { width: 460, height: 23 }, 'a very wide strip')
  assert.deepEqual(
    bannerDisplaySize(240, 80),
    { width: 240, height: 80 },
    'a small image stays its size',
  )
})

test('a malformed stored banner counts as none, so the built-in one shows', () => {
  const src = 'data:image/png;base64,iVBORw0KGgo='
  assert.deepEqual(parseWelcomeBanner(JSON.stringify({ src, width: 300, height: 100 })), {
    src,
    width: 300,
    height: 100,
  })
  assert.equal(parseWelcomeBanner(null), null)
  assert.equal(parseWelcomeBanner('not json'), null)
  assert.equal(parseWelcomeBanner(JSON.stringify({ src, width: 0, height: 100 })), null)
  assert.equal(
    parseWelcomeBanner(JSON.stringify({ src: 'javascript:alert(1)', width: 1, height: 1 })),
    null,
  )
  assert.equal(
    parseWelcomeBanner(JSON.stringify({ src: 'https://example.com/a.png', width: 1, height: 1 })),
    null,
  )
})
