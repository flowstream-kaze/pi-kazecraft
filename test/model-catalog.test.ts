import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  readModelCatalog,
  setDefaultModel,
} from '../server/features/model-catalog/model-catalog.ts'

async function agentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kazecraft-agent-'))
  await writeFile(
    join(dir, 'models.json'),
    JSON.stringify({
      providers: {
        polystrata: {
          baseUrl: 'http://127.0.0.1:8080/v1',
          models: [{
            id: 'gemma',
            name: '[Chat] Gemma',
            contextWindow: 76800,
            maxTokens: 32768,
            input: ['image'],
            reasoning: true,
          }],
        },
        bonsai: { baseUrl: 'http://127.0.0.1:8080/v1', models: [{ id: 'bonsai' }] },
      },
    }),
  )
  await writeFile(
    join(dir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'polystrata', defaultModel: 'gemma', shellPath: 'sh' }),
  )
  return dir
}

test('lists every model in models.json with its limits and the default', async () => {
  const catalog = await readModelCatalog(await agentDir())
  assert.deepEqual(catalog.defaultModel, { provider: 'polystrata', id: 'gemma' })
  assert.equal(catalog.models.length, 2)
  assert.deepEqual(catalog.models[0], {
    provider: 'polystrata',
    id: 'gemma',
    name: '[Chat] Gemma',
    baseUrl: 'http://127.0.0.1:8080/v1',
    contextWindow: 76800,
    maxTokens: 32768,
    images: true,
    reasoning: true,
  })
  assert.equal(catalog.models[1].name, 'bonsai', 'a model without a name shows its id')
})

test('changing the default keeps the rest of settings.json and refuses unknown models', async () => {
  const dir = await agentDir()
  await setDefaultModel('bonsai', 'bonsai', dir)
  const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
  assert.deepEqual(settings, { defaultProvider: 'bonsai', defaultModel: 'bonsai', shellPath: 'sh' })
  await assert.rejects(setDefaultModel('bonsai', 'missing', dir), /not in Pi's models\.json/)
})
