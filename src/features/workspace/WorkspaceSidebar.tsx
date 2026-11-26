import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { PanelIcon } from '../../components/PanelIcon.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { RecentSession, SessionSummary } from '../../../shared/types.ts'
import { AddFolderDialog } from './AddFolderDialog.tsx'
import { SidebarBanner } from './SidebarBanner.tsx'
import { sessionIndicator } from './session-indicator.ts'
import { SessionStatusIndicator } from './SessionStatusIndicator.tsx'
import {
  parseSidebarGroupBy,
  projectNamesByPath,
  SIDEBAR_GROUP_BY_KEY,
  SIDEBAR_GROUP_BY_OPTIONS,
  sidebarSections,
  type SidebarGroupBy,
  type SidebarSection,
} from './sidebar-grouping.ts'
import type { SessionActionTarget } from './sidebar-sessions.ts'
import { SessionDeleteDialog } from './SessionDeleteDialog.tsx'
import { SessionRenameDialog } from './SessionRenameDialog.tsx'
import type { WorkspaceGroup } from './workspace-groups.ts'
import {
  maxWorkspaceSidebarWidth,
  minWorkspaceSidebarWidth,
  visibleWorkspaceSessionCount,
} from './workspace-sidebar.ts'

/** What a right-click opened: a session row, a project section header, or the sidebar itself. */
type ContextMenuSubject =
  | { kind: 'session'; target: SessionActionTarget; archived: boolean }
  | { kind: 'workspace'; group: WorkspaceGroup }
  | { kind: 'sidebar' }

interface ContextMenuState {
  subject: ContextMenuSubject
  x: number
  y: number
}

type RenameTarget =
  | { kind: 'session'; target: SessionActionTarget }
  | { kind: 'workspace'; path: string; name: string }

interface WorkspaceSidebarProps {
  /** The user's banner image (a data URL), or null for the built-in banner. */
  bannerImage: string | null
  collapsed: boolean
  collapsedWorkspacePaths: ReadonlySet<string>
  compactingSessionIds: ReadonlySet<string>
  completedSessionIds: ReadonlySet<string>
  groups: WorkspaceGroup[]
  isRefreshing: boolean
  selectedId: string
  sessions: SessionSummary[]
  width: number
  /** Adds an existing folder as a project section without starting a session. */
  onAddWorkspace: (path: string) => void
  onArchiveSession: (target: SessionActionTarget) => Promise<void>
  onChangeBanner: () => void
  onCloseSession: (sessionId: string) => Promise<void>
  onCreateInWorkspace: (path: string) => Promise<void>
  onDeleteSession: (target: SessionActionTarget) => Promise<void>
  onNewProject: () => void
  onNewSession: () => void
  onOpenSession: (row: RecentSession) => Promise<void>
  onOpenSettings: () => void
  /** Runs /reload for the selected session; a rejection is reported through `onError`. */
  onReload: () => Promise<void>
  /** Why Reload is unavailable right now (no session, Pi busy), or undefined when it can run. */
  reloadUnavailable?: string
  onRenameSession: (target: SessionActionTarget, name: string) => Promise<void>
  /** Stores a sidebar-only name; an empty name restores the folder name. */
  onRenameWorkspace: (path: string, name: string) => void
  onSetWorkspacesCollapsed: (paths: readonly string[], collapsed: boolean) => void
  onUnarchiveSession: (sessionPath: string) => void
  onToggleWorkspaceCollapsed: (path: string) => void
  onResize: (width: number) => void
  onToggleCollapsed: () => void
  onError: (cause: unknown) => void
}

/** Displays the sessions grouped by project folder, date, or as one list. */
export function WorkspaceSidebar({
  bannerImage,
  collapsed,
  collapsedWorkspacePaths,
  compactingSessionIds,
  completedSessionIds,
  groups,
  isRefreshing,
  selectedId,
  sessions,
  width,
  onAddWorkspace,
  onArchiveSession,
  onChangeBanner,
  onCloseSession,
  onCreateInWorkspace,
  onDeleteSession,
  onNewProject,
  onNewSession,
  onOpenSession,
  onOpenSettings,
  onReload,
  reloadUnavailable,
  onRenameSession,
  onRenameWorkspace,
  onSetWorkspacesCollapsed,
  onUnarchiveSession,
  onToggleWorkspaceCollapsed,
  onResize,
  onToggleCollapsed,
  onError,
}: WorkspaceSidebarProps) {
  const [openingSessionPath, setOpeningSessionPath] = useState('')
  const [creatingInPath, setCreatingInPath] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ left: 0, top: 0 })
  const [groupByMenuOpen, setGroupByMenuOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SessionActionTarget | null>(null)
  const [addFolderOpen, setAddFolderOpen] = useState(false)
  const [groupBy, setGroupBy] = useState<SidebarGroupBy>(readGroupBy)
  // Date and flat sections are not folders, so their collapse state stays in this view.
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [expandedWorkspacePaths, setExpandedWorkspacePaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [archiveOpenPaths, setArchiveOpenPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const revealedSelectionIdRef = useRef('')
  const selectedSessionRef = useRef<HTMLButtonElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuTriggerRef = useRef<HTMLElement>(null)

  const sections = useMemo(() => sidebarSections(groups, groupBy), [groups, groupBy])
  const projectNames = useMemo(() => projectNamesByPath(groups), [groups])

  function isSectionCollapsed(section: SidebarSection): boolean {
    return section.project
      ? collapsedWorkspacePaths.has(section.key)
      : collapsedSectionKeys.has(section.key)
  }

  useEffect(() => {
    selectedSessionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [sections, selectedId, expandedWorkspacePaths])

  // A selection made outside the list, such as a shortcut or the restored session, must stay
  // reachable, so the section holding it reveals its full history once.
  useEffect(() => {
    if (!selectedId || selectedId === revealedSelectionIdRef.current) return
    const sessionPath = sessions.find((session) => session.id === selectedId)?.sessionPath
    const section = sessionPath
      ? sections.find((candidate) =>
        candidate.sessions.some((row) => row.sessionPath === sessionPath)
      )
      : undefined
    // History may still be loading; the next render resolves the section.
    if (!section) return
    revealedSelectionIdRef.current = selectedId
    const index = section.sessions.findIndex((row) => row.sessionPath === sessionPath)
    if (index < visibleWorkspaceSessionCount) return
    setExpandedWorkspacePaths((current) =>
      current.has(section.key) ? current : new Set(current).add(section.key)
    )
  }, [sections, selectedId, sessions])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const { width: menuWidth, height: menuHeight } = contextMenuRef.current.getBoundingClientRect()
    const left = Math.min(
      Math.max(8, contextMenu.x),
      Math.max(8, window.innerWidth - menuWidth - 8),
    )
    const top = Math.min(
      Math.max(8, contextMenu.y),
      Math.max(8, window.innerHeight - menuHeight - 8),
    )
    setContextMenuPosition({ left, top })
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const dismissOnPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !contextMenuRef.current?.contains(event.target)) {
        setContextMenu(null)
      }
    }
    const dismissOnKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setContextMenu(null)
      contextMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', dismissOnPointerDown)
    document.addEventListener('keydown', dismissOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointerDown)
      document.removeEventListener('keydown', dismissOnKeyDown)
    }
  }, [contextMenu])

  // Escape leaves selection mode when no menu or dialog is open above it.
  useEffect(() => {
    if (!selecting) return
    const exitOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || contextMenu || bulkDeleteOpen) return
      endSelection()
    }
    document.addEventListener('keydown', exitOnEscape)
    return () => document.removeEventListener('keydown', exitOnEscape)
  }, [bulkDeleteOpen, contextMenu, selecting])

  // Rows that disappear (deleted, archived elsewhere) leave the selection.
  useEffect(() => {
    if (selectedPaths.size === 0) return
    const visible = new Set(
      sections.flatMap((section) => section.sessions.map((row) => row.sessionPath)),
    )
    if ([...selectedPaths].every((path) => visible.has(path))) return
    setSelectedPaths(new Set([...selectedPaths].filter((path) => visible.has(path))))
  }, [sections, selectedPaths])

  function dismissContextMenu(): void {
    setContextMenu(null)
    setGroupByMenuOpen(false)
    contextMenuTriggerRef.current?.focus()
  }

  function openContextMenu(
    subject: ContextMenuSubject,
    event: ReactMouseEvent<HTMLElement>,
  ): void {
    event.preventDefault()
    contextMenuTriggerRef.current = event.currentTarget
    setGroupByMenuOpen(false)
    setContextMenu({ subject, x: event.clientX, y: event.clientY })
  }

  /** Right-click anywhere else in the sidebar opens the sidebar menu. */
  function openSidebarContextMenu(event: ReactMouseEvent<HTMLElement>): void {
    // A row or section header already opened its own menu.
    if (event.nativeEvent.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    // Dialogs and text fields keep the browser's own menu.
    if (target?.closest('.modal-backdrop, input, textarea, .session-context-menu')) return
    openContextMenu({ kind: 'sidebar' }, event)
  }

  function openContextMenuFromKeyboard(
    subject: ContextMenuSubject,
    event: ReactKeyboardEvent<HTMLElement>,
  ): void {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    // A row or header handled it; the sidebar's own handler must not replace that menu.
    event.stopPropagation()
    contextMenuTriggerRef.current = event.currentTarget
    const rect = event.currentTarget.getBoundingClientRect()
    setGroupByMenuOpen(false)
    setContextMenu({ subject, x: rect.left, y: rect.bottom })
  }

  /** Dismisses the menu, then runs its action and reports a failure as a notification. */
  function runMenuAction(action: () => Promise<void> | void): void {
    dismissContextMenu()
    void Promise.resolve().then(action).catch(onError)
  }

  function startRename(): void {
    if (!contextMenu) return
    const { subject } = contextMenu
    if (subject.kind === 'sidebar') return
    dismissContextMenu()
    setRenameTarget(
      subject.kind === 'session'
        ? { kind: 'session', target: subject.target }
        : { kind: 'workspace', path: subject.group.path, name: subject.group.name },
    )
  }

  function dismissRename(): void {
    setRenameTarget(null)
    contextMenuTriggerRef.current?.focus()
  }

  function startDelete(target: SessionActionTarget): void {
    dismissContextMenu()
    setDeleteTarget(target)
  }

  function dismissDelete(): void {
    setDeleteTarget(null)
    contextMenuTriggerRef.current?.focus()
  }

  function toggleArchiveOpen(path: string): void {
    setArchiveOpenPaths((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  function openRow(row: RecentSession): void {
    setOpeningSessionPath(row.sessionPath)
    void onOpenSession(row).catch(onError).finally(() =>
      setOpeningSessionPath((current) => current === row.sessionPath ? '' : current)
    )
  }

  async function reload(): Promise<void> {
    setReloading(true)
    try {
      await onReload()
    } catch (cause) {
      onError(cause)
    } finally {
      setReloading(false)
    }
  }

  async function createInWorkspace(path: string): Promise<void> {
    setCreatingInPath(path)
    try {
      await onCreateInWorkspace(path)
    } catch (cause) {
      onError(cause)
    } finally {
      setCreatingInPath('')
    }
  }

  /** Collapsing a section drops its extra rows, so reopening it starts from the default step. */
  function forgetExpanded(keys: readonly string[]): void {
    setExpandedWorkspacePaths((current) => {
      if (!keys.some((key) => current.has(key))) return current
      const next = new Set(current)
      for (const key of keys) next.delete(key)
      return next
    })
  }

  function toggleSection(section: SidebarSection): void {
    const sectionCollapsed = isSectionCollapsed(section)
    if (!sectionCollapsed) forgetExpanded([section.key])
    if (section.project) {
      onToggleWorkspaceCollapsed(section.key)
      return
    }
    setCollapsedSectionKeys((current) => {
      const next = new Set(current)
      if (!next.delete(section.key)) next.add(section.key)
      return next
    })
  }

  function setAllSectionsCollapsed(collapse: boolean): void {
    const projectKeys = sections.filter((section) => section.project).map((section) => section.key)
    const otherKeys = sections.filter((section) => !section.project).map((section) => section.key)
    if (collapse) forgetExpanded(sections.map((section) => section.key))
    onSetWorkspacesCollapsed(projectKeys, collapse)
    setCollapsedSectionKeys((current) => {
      const next = new Set(current)
      for (const key of otherKeys) {
        if (collapse) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  function toggleWorkspaceExpanded(key: string): void {
    setExpandedWorkspacePaths((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  function chooseGroupBy(next: SidebarGroupBy): void {
    setGroupBy(next)
    try {
      window.localStorage.setItem(SIDEBAR_GROUP_BY_KEY, next)
    } catch {
      // The choice still applies for this visit.
    }
    dismissContextMenu()
  }

  // ── Selection ────────────────────────────────────────────────────

  /** Every regular (not archived) row in the sidebar, in display order. */
  const selectableRows = useMemo(
    () => sections.flatMap((section) => section.sessions),
    [sections],
  )

  function targetForRow(row: RecentSession): SessionActionTarget {
    const live = sessions.find((session) =>
      session.sessionPath === row.sessionPath && session.status !== 'exited'
    )
    return { cwd: row.cwd, name: row.name, sessionId: live?.id, sessionPath: row.sessionPath }
  }

  function selectAll(): void {
    setSelecting(true)
    setSelectedPaths(new Set(selectableRows.map((row) => row.sessionPath)))
  }

  function endSelection(): void {
    setSelecting(false)
    setSelectedPaths(new Set())
  }

  function toggleSelected(sessionPath: string): void {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (!next.delete(sessionPath)) next.add(sessionPath)
      return next
    })
  }

  const selectedRows = selectableRows.filter((row) => selectedPaths.has(row.sessionPath))
  const selectedRunning = selectedRows.some((row) => targetForRow(row).sessionId)

  async function archiveSelected(): Promise<void> {
    setBulkBusy(true)
    try {
      for (const row of selectedRows) await onArchiveSession(targetForRow(row))
      endSelection()
    } catch (cause) {
      onError(cause)
    } finally {
      setBulkBusy(false)
    }
  }

  async function deleteSelected(): Promise<void> {
    setBulkBusy(true)
    try {
      for (const row of selectedRows) await onDeleteSession(targetForRow(row))
      endSelection()
    } finally {
      setBulkBusy(false)
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const handle = event.currentTarget
    const initialX = event.clientX
    const initialWidth = width
    handle.setPointerCapture(event.pointerId)

    const resize = (moveEvent: PointerEvent): void =>
      onResize(initialWidth + moveEvent.clientX - initialX)
    const stop = (): void => {
      handle.removeEventListener('pointermove', resize)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
      handle.removeEventListener('lostpointercapture', stop)
    }

    handle.addEventListener('pointermove', resize)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
    handle.addEventListener('lostpointercapture', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const adjustment = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (adjustment) {
      event.preventDefault()
      onResize(width + adjustment)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onResize(minWorkspaceSidebarWidth)
    }
    if (event.key === 'End') {
      event.preventDefault()
      onResize(maxWorkspaceSidebarWidth)
    }
  }

  /**
   * Renders one session row; archived rows keep every action behind the context menu. Outside
   * the folder view a row also names its project. In selection mode a click selects the row.
   */
  function renderSessionRow(recentSession: RecentSession, archived: boolean, showProject: boolean) {
    const activeSession = sessions.find((session) =>
      session.sessionPath === recentSession.sessionPath
      && session.status !== 'exited'
    )
    const indicator = sessionIndicator(
      activeSession,
      selectedId,
      compactingSessionIds,
      completedSessionIds,
    )
    const sessionLabel = openingSessionPath === recentSession.sessionPath
      ? 'Opening…'
      : recentSession.name
    const subject: ContextMenuSubject = {
      kind: 'session',
      archived,
      target: targetForRow(recentSession),
    }
    const checkable = selecting && !archived
    const checked = checkable && selectedPaths.has(recentSession.sessionPath)
    const projectName = showProject ? projectNames.get(recentSession.cwd) : undefined
    return (
      <Tooltip
        key={recentSession.sessionPath}
        hint={checkable ? 'Click to select' : 'Right-click for rename, archive, and delete'}
        label={`${recentSession.name}\n${
          new Date(recentSession.updatedAt).toLocaleString('en-US')
        }`}
      >
        <button
          aria-haspopup={checkable ? undefined : 'menu'}
          aria-pressed={checkable ? checked : undefined}
          className={`session-item${archived ? ' archived' : ''}${
            activeSession?.id === selectedId ? ' selected' : ''
          }${checked ? ' checked' : ''}${indicator ? ` ${indicator}` : ''}`}
          disabled={openingSessionPath === recentSession.sessionPath}
          onContextMenu={(event) => openContextMenu(subject, event)}
          onKeyDown={(event) => openContextMenuFromKeyboard(subject, event)}
          onClick={() =>
            checkable ? toggleSelected(recentSession.sessionPath) : openRow(recentSession)}
          ref={activeSession?.id === selectedId ? selectedSessionRef : undefined}
          type='button'
        >
          {checkable && (
            <span
              aria-hidden='true'
              className='session-check'
              data-checked={checked}
            />
          )}
          {indicator && <SessionStatusIndicator status={indicator} />}
          <span>
            <strong>{sessionLabel}</strong>
            {projectName && <small className='session-project'>{projectName}</small>}
          </span>
        </button>
      </Tooltip>
    )
  }

  const menuSubject = contextMenu?.subject
  const allCollapsed = sections.length > 0 && sections.every(isSectionCollapsed)
  const noneCollapsed = sections.every((section) => !isSectionCollapsed(section))
  const groupByLabel = SIDEBAR_GROUP_BY_OPTIONS.find((option) => option.id === groupBy)?.label

  return (
    <aside
      aria-label='Session sidebar'
      className={`sidebar${collapsed ? ' collapsed' : ''}`}
      onContextMenu={openSidebarContextMenu}
    >
      <div className='sidebar-rail'>
        <Tooltip label='Expand session sidebar'>
          <button
            aria-expanded={false}
            aria-label='Expand session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <PanelIcon side='left' />
          </button>
        </Tooltip>
      </div>
      <div
        aria-label='Resize session sidebar'
        aria-orientation='vertical'
        aria-valuemax={maxWorkspaceSidebarWidth}
        aria-valuemin={minWorkspaceSidebarWidth}
        aria-valuenow={width}
        className='sidebar-resize-handle'
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        role='separator'
        tabIndex={0}
      />
      <header className='sidebar-header'>
        <div className='sidebar-banner'>
          <SidebarBanner image={bannerImage} />
          <Tooltip label='Change banner'>
            <button
              aria-label='Change banner'
              className='sidebar-banner-edit'
              onClick={onChangeBanner}
              type='button'
            >
              <PencilIcon />
            </button>
          </Tooltip>
        </div>
      </header>
      <div aria-label='Sidebar actions' className='sidebar-toolbar' role='toolbar'>
        <Tooltip label='New session'>
          <button
            aria-label='New session'
            className='sidebar-tool sidebar-tool-primary'
            onClick={onNewSession}
            type='button'
          >
            <PlusIcon />
            <span>New</span>
          </button>
        </Tooltip>
        <span className='sidebar-toolbar-spacer' />
        <Tooltip label={reloadUnavailable ?? 'Reload Pi for this session (/reload)'}>
          <span className='sidebar-tool-wrap'>
            <button
              aria-label='Reload Pi for this session'
              className={`sidebar-tool${reloading ? ' spinning' : ''}`}
              disabled={Boolean(reloadUnavailable) || reloading}
              onClick={() => void reload()}
              type='button'
            >
              <ReloadIcon />
            </button>
          </span>
        </Tooltip>
        <Tooltip label='Settings'>
          <button
            aria-label='Open settings'
            className='sidebar-tool'
            onClick={onOpenSettings}
            type='button'
          >
            <SettingsIcon />
          </button>
        </Tooltip>
        <Tooltip label='Collapse session sidebar'>
          <button
            aria-expanded={true}
            aria-label='Collapse session sidebar'
            className='sidebar-toggle'
            onClick={onToggleCollapsed}
            type='button'
          >
            <PanelIcon side='left' />
          </button>
        </Tooltip>
      </div>
      {selecting && (
        <div aria-label='Selected sessions' className='sidebar-selection-bar' role='toolbar'>
          <span className='sidebar-selection-count' role='status'>
            {selectedRows
              .length} selected
          </span>
          <button
            disabled={bulkBusy || selectedRows
                  .length === selectableRows
                  .length}
            onClick={selectAll}
            type='button'
          >
            All
          </button>
          <button
            disabled={bulkBusy || selectedRows
                  .length === 0}
            onClick={() =>
              void archiveSelected()}
            type='button'
          >
            {bulkBusy ? '…' : 'Archive'}
          </button>
          <button
            className='danger'
            disabled={bulkBusy || selectedRows
                  .length === 0}
            onClick={() =>
              setBulkDeleteOpen(true)}
            type='button'
          >
            Delete…
          </button>
          <button disabled={bulkBusy} onClick={endSelection} type='button'>
            Done
          </button>
        </div>
      )}
      <nav className='workspace-sections' aria-label='Projects and sessions'>
        {isRefreshing && groups.length === 0 && (
          <p className='session-list-loading' role='status'>Loading sessions…</p>
        )}
        {sections.map((section, index) => {
          const group = section.project
          const sectionCollapsed = isSectionCollapsed(section)
          const expanded = expandedWorkspacePaths.has(section.key)
          const hiddenSessionCount = section.sessions.length - visibleWorkspaceSessionCount
          const visibleSessions = expanded
            ? section.sessions
            : section.sessions.slice(0, visibleWorkspaceSessionCount)
          const listId = `workspace-section-${index}`
          const archivedListId = `${listId}-archived`
          const archiveOpen = archiveOpenPaths.has(section.key)
          const workspaceSubject: ContextMenuSubject | undefined = group
            ? { kind: 'workspace', group }
            : undefined
          return (
            <section className='workspace-section' key={section.key}>
              <div className='workspace-section-header'>
                <Tooltip
                  hint={group ? 'Right-click to rename' : undefined}
                  label={group ? group.path : section.name}
                >
                  <button
                    aria-controls={listId}
                    aria-expanded={!sectionCollapsed}
                    aria-haspopup={workspaceSubject ? 'menu' : undefined}
                    className='workspace-section-toggle'
                    onClick={() => toggleSection(section)}
                    onContextMenu={workspaceSubject
                      ? (event) => openContextMenu(workspaceSubject, event)
                      : undefined}
                    onKeyDown={workspaceSubject
                      ? (event) => openContextMenuFromKeyboard(workspaceSubject, event)
                      : undefined}
                    type='button'
                  >
                    <ChevronIcon collapsed={sectionCollapsed} />
                    <span className='workspace-section-name'>{section.name}</span>
                    <span className='workspace-section-count'>{section.sessions.length}</span>
                  </button>
                </Tooltip>
                {group && (
                  <Tooltip label={`New session in ${group.name}`}>
                    <button
                      aria-label={`New session in ${group.name}`}
                      className='workspace-section-new'
                      disabled={creatingInPath === group.path}
                      onClick={() => void createInWorkspace(group.path)}
                      type='button'
                    >
                      {creatingInPath === group.path ? '…' : '＋'}
                    </button>
                  </Tooltip>
                )}
              </div>
              {!sectionCollapsed && (
                <div className='session-list' id={listId}>
                  {visibleSessions.map((recentSession) =>
                    renderSessionRow(recentSession, false, !group)
                  )}
                  {hiddenSessionCount > 0 && (
                    <button
                      aria-controls={listId}
                      aria-expanded={expanded}
                      className='session-list-more'
                      onClick={() => toggleWorkspaceExpanded(section.key)}
                      type='button'
                    >
                      {expanded ? 'Show less' : `Show ${hiddenSessionCount} more`}
                    </button>
                  )}
                  {section.archivedSessions.length > 0 && (
                    <button
                      aria-controls={archivedListId}
                      aria-expanded={archiveOpen}
                      className='session-list-more'
                      onClick={() => toggleArchiveOpen(section.key)}
                      type='button'
                    >
                      {archiveOpen
                        ? 'Hide archived'
                        : `Archived (${section.archivedSessions.length})`}
                    </button>
                  )}
                  {archiveOpen && section.archivedSessions.length > 0 && (
                    <div
                      aria-label={`Archived sessions in ${section.name}`}
                      className='session-list-archived'
                      id={archivedListId}
                      role='group'
                    >
                      {section.archivedSessions.map((recentSession) =>
                        renderSessionRow(recentSession, true, !group)
                      )}
                    </div>
                  )}
                  {section.sessions.length === 0 && section.archivedSessions.length === 0 && (
                    <p className='workspace-section-empty'>No saved sessions yet.</p>
                  )}
                </div>
              )}
            </section>
          )
        })}
        {sections.length === 0 && !isRefreshing && (
          <p className='empty-sidebar'>
            Start a session to see its project here.
          </p>
        )}
      </nav>
      {menuSubject?.kind === 'sidebar' && (
        <div
          aria-label='Sidebar actions'
          className='session-context-menu'
          ref={contextMenuRef}
          role='menu'
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          <button
            autoFocus
            onClick={() => runMenuAction(onNewProject)}
            onPointerEnter={() => setGroupByMenuOpen(false)}
            role='menuitem'
            type='button'
          >
            New project
          </button>
          <button
            onClick={() => {
              dismissContextMenu()
              setAddFolderOpen(true)
            }}
            onPointerEnter={() => setGroupByMenuOpen(false)}
            role='menuitem'
            type='button'
          >
            New section
          </button>
          <hr aria-hidden='true' className='session-context-menu-separator' />
          <button
            disabled={selectableRows.length === 0}
            onClick={() => {
              dismissContextMenu()
              selectAll()
            }}
            onPointerEnter={() => setGroupByMenuOpen(false)}
            role='menuitem'
            type='button'
          >
            Select all
          </button>
          <div className='session-context-submenu-anchor'>
            <button
              aria-expanded={groupByMenuOpen}
              aria-haspopup='menu'
              className='session-context-menu-parent'
              onClick={() => setGroupByMenuOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setGroupByMenuOpen(true)
                }
              }}
              onPointerEnter={() => setGroupByMenuOpen(true)}
              role='menuitem'
              type='button'
            >
              <span>Group by</span>
              <span className='session-context-menu-value'>{groupByLabel}</span>
              <span aria-hidden='true' className='session-context-menu-arrow'>›</span>
            </button>
            {groupByMenuOpen && (
              <div
                aria-label='Group by'
                className='session-context-menu session-context-submenu'
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft') return
                  event.preventDefault()
                  setGroupByMenuOpen(false)
                }}
                role='menu'
              >
                {SIDEBAR_GROUP_BY_OPTIONS.map((option, optionIndex) => (
                  <button
                    aria-checked={groupBy === option.id}
                    autoFocus={optionIndex === 0}
                    key={option.id}
                    onClick={() => chooseGroupBy(option.id)}
                    role='menuitemradio'
                    type='button'
                  >
                    <span aria-hidden='true' className='session-context-menu-check'>
                      {groupBy === option.id ? '✓' : ''}
                    </span>
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            disabled={allCollapsed}
            onClick={() => runMenuAction(() => setAllSectionsCollapsed(true))}
            onPointerEnter={() => setGroupByMenuOpen(false)}
            role='menuitem'
            type='button'
          >
            Collapse all
          </button>
          <button
            disabled={noneCollapsed}
            onClick={() => runMenuAction(() => setAllSectionsCollapsed(false))}
            onPointerEnter={() => setGroupByMenuOpen(false)}
            role='menuitem'
            type='button'
          >
            Expand all
          </button>
        </div>
      )}
      {menuSubject?.kind === 'session' && (
        <div
          aria-label='Session actions'
          className='session-context-menu'
          ref={contextMenuRef}
          role='menu'
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          <button autoFocus onClick={startRename} role='menuitem' type='button'>
            Rename…
          </button>
          {menuSubject.target.sessionPath && (
            <button
              onClick={() => {
                const { target } = menuSubject
                const sessionPath = target.sessionPath ?? ''
                runMenuAction(() =>
                  menuSubject.archived
                    ? onUnarchiveSession(sessionPath)
                    : onArchiveSession(target)
                )
              }}
              role='menuitem'
              type='button'
            >
              {menuSubject.archived ? 'Unarchive' : 'Archive'}
            </button>
          )}
          {menuSubject.target.sessionId && (
            <button
              onClick={() => {
                const sessionId = menuSubject.target.sessionId ?? ''
                runMenuAction(() => onCloseSession(sessionId))
              }}
              role='menuitem'
              type='button'
            >
              Close session
            </button>
          )}
          {menuSubject.target.sessionPath && (
            <>
              <hr aria-hidden='true' className='session-context-menu-separator' />
              <button
                className='danger'
                onClick={() => startDelete(menuSubject.target)}
                role='menuitem'
                type='button'
              >
                Delete…
              </button>
            </>
          )}
        </div>
      )}
      {menuSubject?.kind === 'workspace' && (
        <div
          aria-label='Project actions'
          className='session-context-menu'
          ref={contextMenuRef}
          role='menu'
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          <button autoFocus onClick={startRename} role='menuitem' type='button'>
            Rename project…
          </button>
          {menuSubject.group.customName && (
            <button
              onClick={() => {
                const { path } = menuSubject.group
                runMenuAction(() => onRenameWorkspace(path, ''))
              }}
              role='menuitem'
              type='button'
            >
              Reset to folder name
            </button>
          )}
        </div>
      )}
      {renameTarget?.kind === 'session' && (
        <SessionRenameDialog
          initialName={renameTarget.target.name}
          key={renameTarget.target.sessionPath ?? renameTarget.target.sessionId
            ?? renameTarget.target.name}
          onClose={dismissRename}
          onConfirm={(name) => onRenameSession(renameTarget.target, name)}
        />
      )}
      {renameTarget?.kind === 'workspace' && (
        <SessionRenameDialog
          initialName={renameTarget.name}
          key={renameTarget.path}
          onClose={dismissRename}
          onConfirm={async (name) => onRenameWorkspace(renameTarget.path, name)}
          subject='workspace'
        />
      )}
      {deleteTarget && (
        <SessionDeleteDialog
          key={deleteTarget.sessionPath}
          name={deleteTarget.name}
          running={Boolean(deleteTarget.sessionId)}
          onClose={dismissDelete}
          onConfirm={() => onDeleteSession(deleteTarget)}
        />
      )}
      {bulkDeleteOpen && (
        <SessionDeleteDialog
          count={selectedRows.length}
          name={selectedRows[0]?.name ?? ''}
          running={selectedRunning}
          onClose={() => setBulkDeleteOpen(false)}
          onConfirm={deleteSelected}
        />
      )}
      {addFolderOpen && (
        <AddFolderDialog
          existingPaths={groups.map((group) => group.path)}
          onAdd={(path) => {
            // A new folder section must be visible, so the sidebar returns to the folder view.
            if (groupBy !== 'folder') chooseGroupBy('folder')
            onAddWorkspace(path)
          }}
          onClose={() => setAddFolderOpen(false)}
          onError={onError}
        />
      )}
    </aside>
  )
}

function readGroupBy(): SidebarGroupBy {
  try {
    return parseSidebarGroupBy(window.localStorage.getItem(SIDEBAR_GROUP_BY_KEY))
  } catch {
    return 'folder'
  }
}

function PlusIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='15'
      stroke='currentColor'
      strokeLinecap='round'
      strokeWidth='2'
      viewBox='0 0 24 24'
      width='15'
    >
      <path d='M12 5v14M5 12h14' />
    </svg>
  )
}

function ReloadIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M20 11.5A8 8 0 1 1 17.7 6' />
      <path d='M20 4v5h-5' />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='13'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='13'
    >
      <path d='M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4Z' />
      <path d='m13.5 6.5 4 4' />
    </svg>
  )
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden='true'
      className='workspace-section-chevron'
      data-collapsed={collapsed}
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.75'
      viewBox='0 0 24 24'
      width='14'
    >
      <path d='m6 9 6 6 6-6' />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='16'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      width='16'
    >
      <path d='M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z' />
      <path d='m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.9 1.9 0 0 0-3.2 1.3v.2a2 2 0 1 1-4 0v-.2a1.9 1.9 0 0 0-3.2-1.3l.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.9 1.9 0 0 0 2.2 12a1.9 1.9 0 0 0 1.2-3.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.9 1.9 0 0 0 3.2-1.3v-.2a2 2 0 1 1 4 0v.2a1.9 1.9 0 0 0 3.2 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.9 1.9 0 0 0 20.8 12a1.9 1.9 0 0 0-1.4 3Z' />
    </svg>
  )
}
