import { Tooltip } from '../../components/Tooltip.tsx'
import type { SessionStats } from '../../../shared/types.ts'
import { formatTokens } from '../conversation/message-usage.ts'

/** Tone thresholds for context usage, highest first: the chip warms as the window fills. */
const contextTones = [
  [85, 'danger'],
  [70, 'warning-strong'],
  [50, 'warning'],
] as const

/**
 * Shows how much of the model's context window the session uses, as a chip whose background fills
 * like a gauge. It sits in the composer toolbar beside the model it belongs to.
 */
export function ContextChip({ stats }: { stats: SessionStats | null }) {
  const usage = stats?.contextUsage
  const percent = typeof usage?.percent === 'number'
    ? Math.min(100, Math.max(0, usage.percent))
    : null
  const tokens = typeof usage?.tokens === 'number' && typeof usage.contextWindow === 'number'
    ? `${formatTokens(usage.tokens)} of ${formatTokens(usage.contextWindow)} tokens`
    : null
  const tone = percent === null
    ? ''
    : contextTones.find(([threshold]) => percent >= threshold)?.[1] ?? ''
  const label = percent === null ? '—' : `${Math.round(percent)}%`
  const detail = tokens
    ? `Context: ${tokens} used`
    : 'Context usage appears after the next reply'

  return (
    <Tooltip label={detail}>
      <div
        aria-label={detail}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent === null ? undefined : Math.round(percent)}
        className={`context-chip${tone ? ` ${tone}` : ''}`}
        role='meter'
        tabIndex={0}
      >
        <span
          aria-hidden='true'
          className='context-chip-fill'
          style={{ width: `${percent ?? 0}%` }}
        />
        <svg aria-hidden='true' className='context-chip-icon' viewBox='0 0 16 16'>
          <rect height='11' rx='2.5' width='12' x='2' y='2.5' />
          <path d='M5 6h6M5 9h4' />
        </svg>
        <span className='context-chip-label'>Context</span>
        <span className='context-chip-value'>{label}</span>
      </div>
    </Tooltip>
  )
}
