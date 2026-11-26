import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { getProjectDeleteInfo, type ProjectDeleteInfo } from '../../api.ts'

interface ProjectDeleteDialogProps {
  name: string
  path: string
  /** Whether any of the project's sessions is running; they are closed first. */
  running: boolean
  onClose: () => void
  onConfirm: (deleteFolder: boolean) => Promise<void>
}

/**
 * Confirms deleting a project: every saved session in it is permanently deleted and the project
 * leaves the sidebar. The folder is kept unless the user asks to move it to the Recycle Bin, which
 * is offered only for folders inside the projects folder.
 */
export function ProjectDeleteDialog(
  { name, path, running, onClose, onConfirm }: ProjectDeleteDialogProps,
) {
  const [info, setInfo] = useState<ProjectDeleteInfo | null>(null)
  const [deleteFolder, setDeleteFolder] = useState(false)
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

  useEffect(() => {
    let current = true
    getProjectDeleteInfo(path)
      .then((value) => {
        if (current) setInfo(value)
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      current = false
    }
  }, [path])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!deleting) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled)',
    )
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
      await onConfirm(deleteFolder && Boolean(info?.folderDeletable))
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete the project.')
      setDeleting(false)
    }
  }

  const count = info?.sessionCount ?? 0
  const sessions = count === 1 ? '1 saved session' : `${count} saved sessions`

  return (
    <div
      className='modal-backdrop session-rename-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose()
      }}
    >
      <div
        aria-describedby='project-delete-description'
        aria-labelledby='project-delete-title'
        aria-modal='true'
        className='modal session-rename-modal'
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role='alertdialog'
      >
        <h2 id='project-delete-title'>Delete project?</h2>
        <p className='session-delete-description' id='project-delete-description'>
          {!info
            ? 'Checking the project…'
            : info.missing
            ? (
              <>
                The folder of <strong>{name}</strong>{' '}
                no longer exists. The project will be removed from the sidebar.
              </>
            )
            : count === 0
            ? (
              <>
                <strong>{name}</strong>{' '}
                has no saved sessions. The project will be removed from the sidebar.{running
                  && ' Its running session is closed first.'}
              </>
            )
            : (
              <>
                <strong>{name}</strong> and its {sessions}{' '}
                will be permanently deleted, and the project removed from the sidebar.
                {running && ' Its running sessions are closed first.'} This cannot be undone.
              </>
            )}
        </p>
        {info && !info.missing && (
          <p className='project-delete-folder' title={path}>
            Folder: <code>{path}</code>
          </p>
        )}
        {info?.folderDeletable && (
          <label className='project-delete-option'>
            <input
              checked={deleteFolder}
              disabled={deleting}
              onChange={(event) => setDeleteFolder(event.target.checked)}
              type='checkbox'
            />
            <span>
              Also move the folder and its files to the Recycle Bin
            </span>
          </label>
        )}
        {info && !info.missing && !info.folderDeletable && (
          <p className='project-delete-note'>
            The folder and its files stay on disk; only kazecraft forgets the project.
          </p>
        )}
        {info?.folderDeletable && !deleteFolder && (
          <p className='project-delete-note'>The folder and its files stay on disk.</p>
        )}
        {error && <p className='session-rename-error' role='alert'>{error}</p>}
        <div className='modal-actions'>
          <button disabled={deleting} onClick={onClose} ref={cancelRef} type='button'>
            Cancel
          </button>
          <button
            className='primary danger'
            disabled={deleting || !info}
            onClick={() => void confirm()}
            type='button'
          >
            {deleting ? 'Deleting…' : info?.missing ? 'Remove' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  )
}
