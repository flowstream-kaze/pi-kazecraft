/**
 * The models Pi knows (its `models.json`) and the one new sessions start with (its
 * `settings.json`), for the Settings → Models tab. Writing the default changes only those two keys
 * of `settings.json` and keeps everything else in it.
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isObject } from '../../../shared/is-object.ts'

export interface CatalogModel {
  provider: string
  id: string
  name: string
  baseUrl?: string
  contextWindow?: number
  maxTokens?: number
  images: boolean
  reasoning: boolean
}

export interface ModelCatalog {
  models: CatalogModel[]
  /** The model new sessions start with, when settings.json names one. */
  defaultModel: { provider: string; id: string } | null
}

export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isObject(value) ? value : {}
  } catch {
    return {}
  }
}

/** Every model in `models.json`, in file order, and the default from `settings.json`. */
export async function readModelCatalog(agentDir = piAgentDir()): Promise<ModelCatalog> {
  const [modelsFile, settings] = await Promise.all([
    readJson(join(agentDir, 'models.json')),
    readJson(join(agentDir, 'settings.json')),
  ])
  const providers = isObject(modelsFile.providers) ? modelsFile.providers : {}
  const models = Object.entries(providers).flatMap(([provider, entry]) => {
    if (!isObject(entry) || !Array.isArray(entry.models)) return []
    const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl : undefined
    return entry.models.filter(isObject).flatMap((model): CatalogModel[] => {
      if (typeof model.id !== 'string' || !model.id) return []
      return [{
        provider,
        id: model.id,
        name: typeof model.name === 'string' && model.name ? model.name : model.id,
        baseUrl,
        contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : undefined,
        maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : undefined,
        images: Array.isArray(model.input) && model.input.includes('image'),
        reasoning: model.reasoning === true,
      }]
    })
  })
  const defaultModel =
    typeof settings.defaultProvider === 'string' && typeof settings.defaultModel === 'string'
      ? { provider: settings.defaultProvider, id: settings.defaultModel }
      : null
  return { models, defaultModel }
}

/**
 * Makes a model the one new sessions start with. Refuses a model that `models.json` does not list,
 * so a typo can never leave Pi starting with a model it cannot reach. Written through a temporary
 * file and a rename, so an interrupted write never leaves half a settings file.
 */
export async function setDefaultModel(
  provider: string,
  id: string,
  agentDir = piAgentDir(),
): Promise<void> {
  const { models } = await readModelCatalog(agentDir)
  if (!models.some((model) => model.provider === provider && model.id === id))
    throw new Error('That model is not in Pi\'s models.json')
  const path = join(agentDir, 'settings.json')
  const settings = await readJson(path)
  settings.defaultProvider = provider
  settings.defaultModel = id
  const temporary = `${path}.kazecraft-tmp`
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
