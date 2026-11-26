import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import {
  conversationViewDetails,
  conversationViews,
  type ConversationView,
} from '../conversation/conversation-view.ts'

/** Rail action that chooses how much tool activity the conversation shows. */
export function ViewModeRailButton(
  { onChange, view }: { onChange: (view: ConversationView) => void; view: ConversationView },
) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const current = conversationViewDetails[view]

  useEffect(() => {
    if (!open) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target))
        setOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open])

  return (
    <div className='rail-view-mode' ref={rootRef}>
      <Tooltip label={`${current.label}: ${current.description}`}>
        <button
          aria-expanded={open}
          aria-haspopup='menu'
          aria-label={`Conversation view: ${current.label}`}
          className={`rail-tab rail-view-mode-button ${view}`}
          onClick={() => setOpen((value) => !value)}
          ref={buttonRef}
          type='button'
        >
          <ViewModeIcon view={view} />
        </button>
      </Tooltip>
      {open && (
        <div aria-label='Conversation view' className='rail-view-mode-menu' role='menu'>
          {conversationViews.map((option) => {
            const detail = conversationViewDetails[option]
            return (
              <button
                aria-checked={option === view}
                autoFocus={option === view}
                className={`rail-view-mode-option ${option}${option === view ? ' selected' : ''}`}
                key={option}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                  buttonRef.current?.focus()
                }}
                role='menuitemradio'
                type='button'
              >
                <ViewModeIcon view={option} />
                <span>
                  <strong>{detail.label}</strong>
                  <small>{detail.description}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** One line for messages only, a header row for tool headers, a card for full previews. */
function ViewModeIcon({ view }: { view: ConversationView }) {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='18'
      stroke='currentColor'
      strokeLinecap='round'
      strokeWidth='1.6'
      viewBox='0 0 18 18'
      width='18'
    >
      <path d='M3 4h12' />
      {view === 'simple' && <path d='M3 8h8M3 12h10' />}
      {view === 'semi-detailed' && (
        <>
          <rect height='3' rx='1' width='12' x='3' y='7' />
          <path d='M3 14h8' />
        </>
      )}
      {view === 'detailed' && <rect height='7' rx='1.5' width='12' x='3' y='7.5' />}
    </svg>
  )
}
