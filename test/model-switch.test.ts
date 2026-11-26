import assert from 'node:assert/strict'
import test from 'node:test'
import {
  modelSwitchStatus,
  preloadModel,
  swapOrigin,
  switchStatusFrom,
} from '../server/features/model-switch/model-switch.ts'

const base = 'http://127.0.0.1:8080/v1'

test('only a model server on this machine is asked', () => {
  assert.equal(swapOrigin(base)?.href, 'http://127.0.0.1:8080/')
  assert.equal(swapOrigin('https://api.example.com/v1'), null)
  assert.equal(swapOrigin(undefined), null)
  assert.equal(swapOrigin('not a url'), null)
})

test('reads the requested model state from llama-swap', () => {
  assert.deepEqual(switchStatusFrom({ running: [{ model: 'a', state: 'starting' }] }, 'a'), {
    managed: true,
    state: 'starting',
    busy: false,
  })
  assert.deepEqual(
    switchStatusFrom({ running: [{ model: 'b', state: 'stopping' }] }, 'a'),
    { managed: true, state: 'unloaded', busy: true },
    'another model still stopping means the swap is under way',
  )
  assert.deepEqual(switchStatusFrom({ running: [] }, 'a'), {
    managed: true,
    state: 'unloaded',
    busy: false,
  })
  assert.deepEqual(switchStatusFrom({ models: [] }, 'a'), { managed: false }, 'not llama-swap')
})

test('a provider that is not llama-swap is reported as unmanaged', async () => {
  const offline = async () => {
    throw new Error('HTTP 404')
  }
  assert.deepEqual(await modelSwitchStatus(base, 'a', offline), { managed: false })
  assert.deepEqual(await modelSwitchStatus('https://api.example.com/v1', 'a', offline), {
    managed: false,
  })
})

test('preloading asks the upstream health check only when the model is not loaded or loading', async () => {
  const requested: string[] = []
  const fetcher = (state: string) => async (url: URL) => {
    requested.push(url.pathname)
    return url.pathname === '/running' ? { running: [{ model: 'gemma', state }] } : {}
  }
  assert.equal(await preloadModel(base, 'bonsai', fetcher('ready')), true)
  assert.deepEqual(requested, ['/running', '/upstream/bonsai/health'])
  requested.length = 0
  assert.equal(await preloadModel(base, 'gemma', fetcher('ready')), true)
  assert.deepEqual(requested, ['/running'], 'already loaded: nothing to start')
  requested.length = 0
  assert.equal(await preloadModel(base, 'gemma', fetcher('starting')), true)
  assert.deepEqual(requested, ['/running'], 'already loading: no second start')
})
