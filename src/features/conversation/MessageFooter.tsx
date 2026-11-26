import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import { formatExactTime, formatRelativeTime, useClock } from './relative-time.ts'
import { readReply } from './read-aloud.ts'

/** The always-visible action row under a message, in the order the message's side reads. */
export function MessageFooter(
  { children, side }: { children: ReactNode; side: 'assistant' | 'user' },
) {
  return <div className={`message-footer ${side}`}>{children}</div>
}

/**
 * Shows when a message was written: the clock time ("3:42 PM", with the date when it was not today)
 * and how long ago, with the full date and time on hover.
 */
export function RelativeTime({ detail, time }: { detail?: string; time: Date }) {
  const now = useClock()
  const exact = time.toLocaleString(navigator.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return (
    <Tooltip label={detail ? `${detail} · ${exact}` : exact}>
      <time className='message-footer-meta message-footer-time' dateTime={time.toISOString()}>
        <span className='message-footer-clock'>
          {formatExactTime(time, new Date(now), navigator.language)}
        </span>
        <span>{formatRelativeTime(time.getTime(), now, navigator.language)}</span>
      </time>
    </Tooltip>
  )
}

/** Reads a reply with local Paradee speech; a second click stops it. */
export function ReadAloudButton(
  { text, onError }: { text: string; onError: (cause: unknown) => void },
) {
  const [speaking, setSpeaking] = useState(false)
  const current = useRef<AbortController | null>(null)

  useEffect(() => () => {
    current.current?.abort()
    current.current = null
  }, [])

  function toggle(): void {
    if (current.current) {
      current.current.abort()
      return
    }
    const controller = new AbortController()
    current.current = controller
    setSpeaking(true)
    void readReply(text, controller)
      .catch(error => {
        if (!controller.signal.aborted) onError(error)
      })
      .finally(() => {
        if (current.current === controller) {
          current.current = null
          setSpeaking(false)
        }
      })
  }

  const label = speaking ? 'Stop reading' : 'Read aloud'
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        aria-pressed={speaking}
        className='conversation-action-button'
        onClick={toggle}
        type='button'
      >
        <svg aria-hidden='true' fill='none' stroke='currentColor' viewBox='0 0 16 16'>
          <path d='M2.5 6v4h2.5l3.5 3V3L5 6H2.5Z' strokeLinejoin='round' />
          {speaking
            ? <path d='M11 6.5 13.5 9m0-2.5L11 9' strokeLinecap='round' />
            : <path d='M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4' strokeLinecap='round' />}
        </svg>
      </button>
    </Tooltip>
  )
}
