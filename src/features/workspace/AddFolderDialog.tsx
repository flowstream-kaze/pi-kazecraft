import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { listDirectories, pickDirectory } from '../../api.ts'

interface AddFolderDialogProps {
  /** Folders that already have a section; adding one again is refused. */
  existingPaths: readonly string[]
  onAdd: (path: string) => void
  onClose: () => void
  onError: (cause: unknown) => void
}

/**
 * Adds an existing folder as a project section without starting a session (the sidebar's
 * New section). The typed path stays available because a headless host may have no folder dialog.
 */
export function AddFolderDialog({ existingPaths, onAdd, onClose, onError }: AddFolderDialogProps) {
  const [path, setPath] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [pickerUnavailable, setPickerUnavailable] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = browsing || adding

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    inputRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  async function browse(): Promise<void> {
    setBrowsing(true)
    setError('')
    setPickerUnavailable(false)
    try {
      const result = await pickDirectory(path.trim() || undefined)
      if (result.path) setPath(result.path)
      else if (result.unavailable) setPickerUnavailable(true)
    } catch (cause) {
      onError(cause)
    } finally {
      setBrowsing(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!path.trim()) {
      setError('Choose a folder or type its path.')
      return
    }
    setError('')
    setAdding(true)
    try {
      // Resolves the typed path on the host and fails for a folder that does not exist.
      const directory = (await listDirectories(path.trim())).path
      if (existingPaths.includes(directory))
        throw new Error('This folder is already in the sidebar.')
      onAdd(directory)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add the folder.')
      setAdding(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (!busy) onClose()
  }

  return (
    <div
      className='modal-backdrop new-session-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <form
        aria-describedby={error ? 'add-folder-error' : undefined}
        aria-labelledby='add-folder-title'
        aria-modal='true'
        className='modal new-session-modal'
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        role='dialog'
      >
        <header className='new-session-heading'>
          <h2 id='add-folder-title'>New section</h2>
        </header>
        <p className='new-session-hint'>
          Add an existing folder as a project. Its sessions appear under it, and a new session can
          start there from the section's ＋ button.
        </p>
        <div className='new-session-folder'>
          <button
            className='new-session-browse'
            disabled={busy}
            onClick={() => void browse()}
            type='button'
          >
            {browsing ? 'Opening…' : 'Choose folder…'}
          </button>
          <p className='new-session-or'>Or type a path</p>
          <input
            aria-invalid={Boolean(error)}
            aria-label='Folder path'
            autoComplete='off'
            className='directory-path-input'
            disabled={busy}
            onChange={(event) => {
              setPath(event.target.value)
              if (error) setError('')
            }}
            placeholder='Paste or type a folder path'
            ref={inputRef}
            value={path}
          />
          {pickerUnavailable && (
            <p className='new-session-hint'>
              No system folder dialog is available. Type the path instead.
            </p>
          )}
        </div>
        {error && <p className='new-session-error' id='add-folder-error' role='alert'>{error}</p>}
        <div className='modal-actions'>
          <button disabled={busy} onClick={onClose} type='button'>Cancel</button>
          <button className='primary' disabled={busy} type='submit'>
            {adding ? 'Adding…' : 'Add folder'}
          </button>
        </div>
      </form>
    </div>
  )
}
