import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DecodeSpeedStore,
  DecodeSpeedTracker,
  engineDecodeSpeed,
  readProviderBaseUrls,
  replyKey,
} from '../server/features/decode-speed/decode-speed.ts'
import { writeFile } from 'node:fs/promises'

function delta(type: string) {
  return { type: 'message_update', assistantMessageEvent: { type } }
}

function end(output: number, responseId = 'chatcmpl-1') {
  return {
    type: 'message_end',
    message: { role: 'assistant', responseId, timestamp: 1, usage: { output } },
  }
}

test('measures decode speed from the first generated token to the end of the reply', () => {
  const tracker = new DecodeSpeedTracker()
  tracker.receive('s', { type: 'message_start' }, 0)
  // Prompt reading happens before the first delta and is excluded from the span.
  assert.equal(tracker.receive('s', delta('text_start'), 4_000), undefined)
  tracker.receive('s', delta('thinking_delta'), 5_000)
  tracker.receive('s', delta('text_delta'), 5_500)

  assert.deepEqual(tracker.receive('s', end(41), 6_000), {
    key: 'response:chatcmpl-1',
    tokensPerSecond: 40,
  })
})

test('ignores replies whose first token was not observed or that are too short', () => {
  const tracker = new DecodeSpeedTracker()
  assert.equal(tracker.receive('s', end(40), 1_000), undefined)

  tracker.receive('s', delta('text_delta'), 0)
  assert.equal(tracker.receive('s', end(1), 1_000), undefined)

  tracker.receive('s', delta('text_delta'), 0)
  tracker.forget('s')
  assert.equal(tracker.receive('s', end(40), 1_000), undefined)
})

test('keeps sessions apart and skips messages that are not assistant replies', () => {
  const tracker = new DecodeSpeedTracker()
  tracker.receive('a', delta('text_delta'), 0)
  tracker.receive('b', delta('text_delta'), 500)
  assert.equal(
    tracker.receive('a', { type: 'message_end', message: { role: 'toolResult' } }, 1_000),
    undefined,
  )
  assert.equal(tracker.receive('b', end(11), 1_500)?.tokensPerSecond, 10)
})

test('keys replies by response id, else by timestamp', () => {
  assert.equal(replyKey({ responseId: 'r1', timestamp: 5 }), 'response:r1')
  assert.equal(replyKey({ timestamp: 5 }), 'timestamp:5')
  assert.equal(replyKey({}), undefined)
})

const polystrata = new Map([['polystrata', 'http://127.0.0.1:8080/v1']])
const reply = { role: 'assistant', provider: 'polystrata', usage: { output: 30 } }

test('uses the decode speed the model server measured for the reply', async () => {
  const requested: string[] = []
  const speed = await engineDecodeSpeed(reply, polystrata, async (url) => {
    requested.push(url.href)
    return { last_timings: { predicted_n: 30, predicted_per_second: 70.54 } }
  })

  assert.equal(speed, 70.5)
  assert.deepEqual(requested, ['http://127.0.0.1:8080/v1/status'])
})

test('rejects server timings that belong to another request or are missing', async () => {
  const otherRequest = async () => ({
    last_timings: { predicted_n: 12, predicted_per_second: 80 },
  })
  assert.equal(await engineDecodeSpeed(reply, polystrata, otherRequest), undefined)
  assert.equal(await engineDecodeSpeed(reply, polystrata, async () => ({})), undefined)
  assert.equal(
    await engineDecodeSpeed(reply, polystrata, async () => {
      throw new Error('offline')
    }),
    undefined,
  )
  assert.equal(
    await engineDecodeSpeed({ ...reply, provider: 'unknown' }, polystrata, otherRequest),
    undefined,
  )
})

test('never asks a model server that is not on this machine', async () => {
  const requested: string[] = []
  const remote = new Map([['cloud', 'https://api.example.com/v1']])
  const speed = await engineDecodeSpeed({ ...reply, provider: 'cloud' }, remote, async (url) => {
    requested.push(url.href)
    return { last_timings: { predicted_n: 30, predicted_per_second: 99 } }
  })

  assert.equal(speed, undefined)
  assert.deepEqual(requested, [])
})

test('reads provider base URLs from Pi models.json', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'pi-models-')), 'models.json')
  await writeFile(
    path,
    JSON.stringify({
      providers: { polystrata: { baseUrl: 'http://127.0.0.1:8080/v1' }, broken: {} },
    }),
  )

  assert.deepEqual([...await readProviderBaseUrls(path)], [
    ['polystrata', 'http://127.0.0.1:8080/v1'],
  ])
  assert.deepEqual([...await readProviderBaseUrls(join(tmpdir(), 'missing-models.json'))], [])
})

test('persists speeds and finds them again from a new store', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'pi-decode-')), 'speeds.json')
  await new DecodeSpeedStore(path).record({ key: 'response:r1', tokensPerSecond: 48.3 })

  const reopened = new DecodeSpeedStore(path)
  assert.deepEqual([...await reopened.lookup(['response:r1', 'response:missing'])], [
    ['response:r1', 48.3],
  ])
})
