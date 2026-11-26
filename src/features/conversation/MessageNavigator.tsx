import { useEffect, useRef } from 'react'
import type { UserMessageAnchor } from './user-message-anchors.ts'

/**
 * A panel listing the user's prompts in thread order, opened from the top bar. Each entry shows its
 * number, a two-line preview, and its send time; choosing one scrolls the thread back to that prompt
 * and highlights it. The panel stays open so the user can hop between prompts; a click elsewhere,
 * or Escape inside it, closes it.
 */
export function MessageNavigator(
  { anchors, onClose, onSelect }: {
    anchors: readonly UserMessageAnchor[]
    onClose: () => void
    onSelect: (anchor: UserMessageAnchor) => void
  },
) {
  const listRef = useRef<HTMLOListElement>(null)
  const navRef = useRef<HTMLElement>(null)

  // A click anywhere else closes the panel, so it never keeps covering the right-aligned prompts.
  // The top-bar toggle is excluded: it closes the panel itself.
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (navRef.current?.contains(event.target)) return
      if (event.target.closest('[data-message-navigator-toggle]')) return
      onClose()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [onClose])

  // Start at the latest prompt, which is the one most often revisited.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [anchors.length])

  return (
    <nav
      aria-label='Your messages'
      className='message-navigator'
      ref={navRef}
      onKeyDown={(event) => {
        // Only while focus is inside: the panel stays open, and Escape elsewhere aborts Pi.
        if (event.key !== 'Escape') return
        event.preventDefault()
        onClose()
      }}
    >
      <header className='message-navigator-header'>
        <strong>Your messages</strong>
        <span className='message-navigator-count'>{anchors.length}</span>
        <button
          aria-label='Close message list'
          className='message-navigator-close'
          onClick={onClose}
          type='button'
        >
          <svg aria-hidden='true' viewBox='0 0 16 16'>
            <path d='m4.5 4.5 7 7m0-7-7 7' />
          </svg>
        </button>
      </header>
      {anchors.length === 0
        ? <p className='message-navigator-empty'>Your prompts will appear here as you send them.</p>
        : (
          <ol className='message-navigator-list' ref={listRef}>
            {anchors.map((anchor, index) => {
              const time = formatTime(anchor.timestamp)
              return (
                <li key={anchor.key}>
                  <button
                    aria-label={`Message ${index + 1} of ${anchors.length}${
                      time ? `, ${time}` : ''
                    }: ${anchor.preview}`}
                    className='message-navigator-item'
                    onClick={() => onSelect(anchor)}
                    type='button'
                  >
                    <span aria-hidden='true' className='message-navigator-number'>{index + 1}</span>
                    <span className='message-navigator-preview'>{anchor.preview}</span>
                    {time && <time className='message-navigator-time'>{time}</time>}
                  </button>
                </li>
              )
            })}
          </ol>
        )}
    </nav>
  )
}

function formatTime(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined) return undefined
  const time = new Date(timestamp)
  if (Number.isNaN(time.getTime())) return undefined
  const sameDay = time.toDateString() === new Date().toDateString()
  return sameDay
    ? time.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' })
    : time.toLocaleDateString(navigator.language, { day: 'numeric', month: 'short' })
}
