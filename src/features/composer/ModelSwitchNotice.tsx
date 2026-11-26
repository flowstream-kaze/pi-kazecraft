import { useEffect, useState } from 'react'
import { formatSeconds, loadProgress } from './model-switch.ts'
import type { ModelSwitch } from './useModelSwitch.ts'

/**
 * Says that a model is being loaded, how long it usually takes and how far along it is, so a
 * switch does not look like Pi has stalled. Shown above the message box.
 */
export function ModelSwitchNotice(
  { change, onDismiss }: { change: ModelSwitch; onDismiss: () => void },
) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (change.phase !== 'loading') return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [change.phase])

  const elapsed = Math.max(0, (now - change.startedAt) / 1000)
  const progress = change.phase === 'ready' ? 1 : loadProgress(elapsed, change.estimate)
  const hint = change.estimate
    ? `Usually about ${formatSeconds(change.estimate)}.`
    : 'The first load of a model can take up to a minute; later loads show an estimate.'

  return (
    <div
      aria-live='polite'
      className={`model-switch-notice ${change.phase}`}
      role='status'
    >
      <div className='model-switch-line'>
        {change.phase === 'loading' && <span aria-hidden='true' className='model-switch-spinner' />}
        {change.phase === 'ready' && (
          <span aria-hidden='true' className='model-switch-check'>✓</span>
        )}
        <span className='model-switch-text'>
          {change.phase === 'loading' && (
            <>
              <strong>Loading {change.name}…</strong> {hint}
            </>
          )}
          {change.phase === 'ready' && <strong>{change.name} is ready.</strong>}
          {change.phase === 'failed' && (
            <>
              <strong>{change.name} is taking unusually long to load.</strong>{' '}
              Check the launcher window or llama-swap's page at http://127.0.0.1:8080/.
            </>
          )}
        </span>
        {change.phase === 'loading' && (
          <span className='model-switch-elapsed'>{formatSeconds(elapsed)}</span>
        )}
        {change.phase === 'failed' && (
          <button
            aria-label='Dismiss'
            className='model-switch-dismiss'
            onClick={onDismiss}
            type='button'
          >
            ×
          </button>
        )}
      </div>
      <div
        aria-label='Loading progress'
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
        className={`model-switch-bar${progress === null ? ' indeterminate' : ''}`}
        role='progressbar'
      >
        <span style={progress === null ? undefined : { width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}
