import { useCallback, useEffect, useState } from 'react'
import { type CatalogModel, listModelCatalog, preloadModel, setDefaultModel } from '../../api.ts'
import { formatSeconds, MODEL_LOAD_TIMES_KEY, parseLoadTimes } from '../composer/model-switch.ts'
import { modelProfiles } from './model-profiles.ts'

const pollMs = 2_000

function loadTimes(): Readonly<Record<string, number>> {
  try {
    return parseLoadTimes(window.localStorage.getItem(MODEL_LOAD_TIMES_KEY))
  } catch {
    return {}
  }
}

function statusText(model: CatalogModel): { label: string; tone: string } {
  if (!model.swap.managed) return { label: 'Always available', tone: 'ready' }
  if (model.swap.state === 'ready' && !model.swap.busy) return { label: 'Loaded', tone: 'ready' }
  if (model.swap.state === 'starting' || model.swap.busy)
    return { label: 'Loading…', tone: 'loading' }
  if (model.swap.state === 'stopping') return { label: 'Unloading…', tone: 'idle' }
  return { label: 'Not loaded', tone: 'idle' }
}

/**
 * Settings → Models: every model Pi knows, what it is good at, whether it is loaded, and buttons to
 * use it in the open chat, load it ahead of time, or make it the default for new sessions.
 */
export function ModelSettings(
  { currentModel, onUseInSession }: {
    /** "provider/id" of the open session's model, or undefined with no session open. */
    currentModel?: string
    /** Switches the open session to a model; undefined when no session is open. */
    onUseInSession?: (provider: string, id: string) => Promise<void>
  },
) {
  const [models, setModels] = useState<CatalogModel[] | null>(null)
  const [defaultKey, setDefaultKey] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** A failed status check; the next successful one clears it (the backend may be restarting). */
  const [pollError, setPollError] = useState('')
  const times = loadTimes()

  const refresh = useCallback(async (): Promise<void> => {
    const catalog = await listModelCatalog()
    setModels(catalog.models)
    setDefaultKey(
      catalog.defaultModel ? `${catalog.defaultModel.provider}/${catalog.defaultModel.id}` : '',
    )
  }, [])

  // Loading states change on their own (another chat, the launcher), so the list keeps polling.
  useEffect(() => {
    let current = true
    const tick = () => {
      refresh()
        .then(() => {
          if (current) setPollError('')
        })
        .catch((cause: unknown) => {
          if (current) setPollError(cause instanceof Error ? cause.message : String(cause))
        })
    }
    tick()
    const timer = window.setInterval(tick, pollMs)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [refresh])

  async function run(key: string, action: () => Promise<void>, done: string): Promise<void> {
    setBusyKey(key)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(done)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyKey('')
    }
  }

  if (!models) {
    return (
      <section className='model-settings'>
        <p>{error || pollError || 'Reading the models…'}</p>
      </section>
    )
  }

  return (
    <section className='model-settings'>
      <p>
        One model runs at a time on the graphics card; choosing another unloads the first. Both hold
        76,800 tokens of conversation, so a chat can switch models at any point.
      </p>
      {(notice || error || pollError) && (
        <p
          className={error || pollError ? 'model-settings-error' : 'model-settings-notice'}
          role='status'
        >
          {error || pollError || notice}
        </p>
      )}
      <div className='model-cards'>
        {models.map((model) => {
          const key = `${model.provider}/${model.id}`
          const profile = modelProfiles[key]
          const status = statusText(model)
          const inSession = currentModel === key
          const isDefault = defaultKey === key
          const learned = times[key]
          const busy = busyKey === key
          return (
            <article className={`model-card${inSession ? ' current' : ''}`} key={key}>
              <header>
                <div>
                  <h3>{model.name}</h3>
                  <code>{key}</code>
                </div>
                <span className={`model-status ${status.tone}`}>{status.label}</span>
              </header>
              <div className='model-badges'>
                {inSession && <span>In this chat</span>}
                {isDefault && <span>Default for new chats</span>}
              </div>
              {profile
                ? <p className='model-summary'>{profile.summary}</p>
                : (
                  <p className='model-summary'>
                    No description yet. Ask Pi in a chat on the pi-kazecraft project to add one to
                    {' '}
                    <code>model-profiles.ts</code>.
                  </p>
                )}
              {profile && (
                <>
                  <h4>Best for</h4>
                  <ul className='model-best-for'>
                    {profile.bestFor.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </>
              )}
              <dl className='model-details'>
                {[
                  ...(model.contextWindow === undefined ? [] : [{
                    label: 'Context',
                    value: `${model.contextWindow.toLocaleString()} tokens`,
                  }]),
                  ...(model.maxTokens === undefined ? [] : [{
                    label: 'Longest reply',
                    value: `${model.maxTokens.toLocaleString()} tokens`,
                  }]),
                  {
                    label: 'Thinks first',
                    value: model.reasoning ? 'yes, adjustable in the chat' : 'no',
                  },
                  ...(learned === undefined ? [] : [{
                    label: 'Recent loads here',
                    value: `about ${formatSeconds(learned)}`,
                  }]),
                  ...(profile?.details ?? []),
                ]
                  .map((detail) => (
                    <div className='model-detail-row' key={detail.label}>
                      <dt>{detail.label}</dt>
                      <dd>{detail.value}</dd>
                    </div>
                  ))}
              </dl>
              <div className='model-actions'>
                <button
                  className='primary'
                  disabled={!onUseInSession || inSession || busy}
                  onClick={() =>
                    void run(
                      key,
                      async () => {
                        await onUseInSession?.(model.provider, model.id)
                      },
                      `The open chat now uses ${model.name}.`,
                    )}
                  title={onUseInSession ? undefined : 'Open a chat first'}
                  type='button'
                >
                  {inSession ? 'In use in this chat' : 'Use in this chat'}
                </button>
                {model.swap.managed && (
                  <button
                    disabled={busy || model.swap.state === 'ready'
                      || model.swap.state === 'starting'}
                    onClick={() =>
                      void run(
                        key,
                        () => preloadModel(model.provider, model.id),
                        `Loading ${model.name}. It is ready when its status says Loaded.`,
                      )}
                    type='button'
                  >
                    Load now
                  </button>
                )}
                <button
                  disabled={busy || isDefault}
                  onClick={() =>
                    void run(
                      key,
                      () => setDefaultModel(model.provider, model.id),
                      `New chats now start with ${model.name}.`,
                    )}
                  type='button'
                >
                  {isDefault ? 'Default for new chats' : 'Make default'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
      <p className='settings-hint'>
        The list comes from Pi&apos;s <code>~\.pi\agent\models.json</code>; the default is saved in
        {' '}
        <code>settings.json</code> beside it.
      </p>
    </section>
  )
}
