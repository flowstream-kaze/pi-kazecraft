import assert from 'node:assert/strict'
import test from 'node:test'
import { hostnameOf, refusalReason } from '../server/request-guard.ts'

test('the page, the Vite proxy and local tools are let through', () => {
  for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:43121']) {
    assert.equal(
      refusalReason('POST', { host: '127.0.0.1:5173', origin, 'sec-fetch-site': 'same-origin' }),
      null,
      origin,
    )
  }
  assert.equal(refusalReason('PUT', { host: '127.0.0.1:43121' }), null, 'a script without Origin')
  assert.equal(refusalReason('POST', {}), null, 'no headers at all')
  assert.equal(refusalReason('GET', { host: 'localhost:5173' }), null)
})

test('other websites cannot change anything', () => {
  assert.match(
    String(refusalReason('POST', { host: '127.0.0.1:5173', origin: 'https://evil.example' })),
    /other websites/,
  )
  assert.match(
    String(refusalReason('POST', { host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' })),
    /other websites/,
  )
  assert.match(String(refusalReason('PUT', { origin: 'null' })), /other websites/)
  assert.match(String(refusalReason('DELETE', { origin: 'not a url' })), /other websites/)
})

test('a site name pointed at this PC (DNS rebinding) is refused even for reading', () => {
  assert.match(String(refusalReason('GET', { host: 'evil.example:5173' })), /this PC/)
  assert.match(String(refusalReason('POST', { host: 'attacker.test' })), /this PC/)
})

test('host names with ports and IPv6 brackets', () => {
  assert.equal(hostnameOf('127.0.0.1:5173'), '127.0.0.1')
  assert.equal(hostnameOf('[::1]:43121'), '[::1]')
  assert.equal(hostnameOf('localhost'), 'localhost')
})
