import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { findMentionedFiles, openWorkspaceFile, revealWorkspaceFile } from '../../api.ts'
import { looksLikeFileMention } from './file-mentions.ts'

interface FileLinksContextValue {
  cwd: string
  onError: (cause: unknown) => void
}

const FileLinksContext = createContext<FileLinksContextValue | null>(null)

/** Lets Markdown inside a conversation turn file names into links, looked up in the chat's folder. */
export function FileLinksProvider(
  { children, cwd, onError }: FileLinksContextValue & { children: ReactNode },
) {
  // A stable value, so a re-render of the conversation does not look every file up again.
  const value = useMemo(() => ({ cwd, onError }), [cwd, onError])
  return <FileLinksContext.Provider value={value}>{children}</FileLinksContext.Provider>
}

// ── Lookup: one request per folder for every name rendered in the same moment ──────────────

type Lookup = Promise<string | null>
const lookups = new Map<string, Map<string, Lookup>>()
const pending = new Map<string, Map<string, (path: string | null) => void>>()
const lookupDelayMs = 30
const retryDelayMs = 4_000

function lookupFile(cwd: string, text: string): Lookup {
  let known = lookups.get(cwd)
  if (!known) lookups.set(cwd, known = new Map())
  const existing = known.get(text)
  if (existing) return existing
  const lookup = new Promise<string | null>((resolve) => {
    let waiting = pending.get(cwd)
    if (!waiting) {
      pending.set(cwd, waiting = new Map())
      window.setTimeout(() => void flush(cwd), lookupDelayMs)
    }
    waiting.set(text, resolve)
  })
  known.set(text, lookup)
  return lookup
}

async function flush(cwd: string): Promise<void> {
  const waiting = pending.get(cwd)
  pending.delete(cwd)
  if (!waiting) return
  let found: { text: string; path: string }[] = []
  try {
    found = await findMentionedFiles(cwd, [...waiting.keys()])
  } catch {
    // Not found is the safe answer: the name stays plain text.
  }
  const paths = new Map(found.map((file) => [file.text, file.path]))
  for (const [text, resolve] of waiting) {
    resolve(paths.get(text) ?? null)
    // A file the reply mentions may be written a moment later; look again next time.
    if (!paths.has(text)) lookups.get(cwd)?.delete(text)
  }
}

/** Inline code in a reply: a link with Open and Show in folder when it names an existing file. */
export function FileMention({ children, text }: { children: ReactNode; text: string }) {
  const context = useContext(FileLinksContext)
  const [path, setPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const candidate = Boolean(context) && looksLikeFileMention(text)

  useEffect(() => {
    if (!context || !candidate) return
    let current = true
    let retry: number | undefined
    const look = (again: boolean) =>
      void lookupFile(context.cwd, text.trim()).then((found) => {
        if (!current) return
        setPath(found)
        // Pi often names a file in the same reply that writes it; look once more a moment later.
        if (!found && again) retry = window.setTimeout(() => look(false), retryDelayMs)
      })
    look(true)
    return () => {
      current = false
      window.clearTimeout(retry)
    }
  }, [candidate, context, text])

  const closeMenu = useCallback(() => setMenu(null), [])

  if (!context || !path) return <code>{children}</code>

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    // A keyboard click has no pointer position; place the menu under the link.
    const keyboard = event.clientX === 0 && event.clientY === 0
    setMenu({
      x: keyboard ? rect.left : event.clientX,
      y: keyboard ? rect.bottom + 4 : event.clientY,
    })
  }

  return (
    <>
      <button
        aria-haspopup='menu'
        className='file-link'
        onClick={openMenu}
        onContextMenu={openMenu}
        title={`${path}\nClick for Open and Show in folder`}
        type='button'
      >
        <FileIcon />
        <code>{children}</code>
      </button>
      {menu && (
        <FileLinkMenu
          onClose={closeMenu}
          onOpen={() => openWorkspaceFile(context.cwd, path)}
          onReveal={() => revealWorkspaceFile(context.cwd, path)}
          onError={context.onError}
          path={path}
          x={menu.x}
          y={menu.y}
        />
      )}
    </>
  )
}

function FileLinkMenu(
  { onClose, onError, onOpen, onReveal, path, x, y }: {
    onClose: () => void
    onError: (cause: unknown) => void
    onOpen: () => Promise<void>
    onReveal: () => Promise<void>
    path: string
    x: number
    y: number
  },
) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Keep the menu on screen near the window's right and bottom edges.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    })
  }, [x, y])

  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const run = (action: () => Promise<void>) => {
    onClose()
    void action().catch(onError)
  }

  return createPortal(
    <div
      aria-label='File actions'
      className='session-context-menu file-link-menu'
      ref={ref}
      role='menu'
      style={{ left: position.left, top: position.top }}
    >
      <p className='file-link-menu-path' title={path}>{path}</p>
      <button onClick={() => run(onOpen)} role='menuitem' type='button'>
        Open
      </button>
      <button onClick={() => run(onReveal)} role='menuitem' type='button'>
        Show in folder
      </button>
    </div>,
    document.body,
  )
}

function FileIcon() {
  return (
    <svg aria-hidden='true' className='file-link-icon' viewBox='0 0 16 16'>
      <path
        d='M4 1.75h5.25L12.75 5.25v8.25a.75.75 0 0 1-.75.75H4a.75.75 0 0 1-.75-.75V2.5A.75.75 0 0 1 4 1.75Z M9 1.75v3.5h3.75'
        fill='none'
        stroke='currentColor'
        strokeLinejoin='round'
        strokeWidth='1.2'
      />
    </svg>
  )
}
