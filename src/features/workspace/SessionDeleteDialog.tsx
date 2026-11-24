import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

interface SessionDeleteDialogProps {
  name: string
  /** Whether a Pi process still runs the session; it is closed before deletion. */
  running: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}

/** Confirms the permanent removal of a session's history file. */
export function SessionDeleteDialog(
  { name, running, onClose, onConfirm }: SessionDeleteDialogProps,
) {
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    // The safe choice holds the initial focus so Enter never deletes by accident.
    cancelRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!deleting) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function confirm(): Promise<void> {
    setError('')
    setDeleting(true)
    try {
      await onConfirm()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete the session.')
      setDeleting(false)
    }
  }

  return (
    <div
      className='modal-backdrop session-rename-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose()
      }}
    >
      <div
        aria-describedby='session-delete-description'
        aria-labelledby='session-delete-title'
        aria-modal='true'
        className='modal session-rename-modal'
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role='alertdialog'
      >
        <h2 id='session-delete-title'>Delete session?</h2>
        <p className='session-delete-description' id='session-delete-description'>
          <strong>{name}</strong> and its whole history will be permanently deleted from disk.
          {running && ' The running session is closed first.'} This cannot be undone.
        </p>
        {error && <p className='session-rename-error' role='alert'>{error}</p>}
        <div className='modal-actions'>
          <button disabled={deleting} onClick={onClose} ref={cancelRef} type='button'>
            Cancel
          </button>
          <button
            className='primary danger'
            disabled={deleting}
            onClick={() => void confirm()}
            type='button'
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
