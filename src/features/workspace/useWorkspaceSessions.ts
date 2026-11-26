import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closeSession as requestCloseSession,
  createSession,
  deleteProject,
  deleteSession as deleteStoredSession,
  listRecentSessions,
  listSessions,
  openSession as requestOpenSession,
  renameSession as renameStoredSession,
  sendPiCommand,
} from '../../api.ts'
import type { JsonObject, RecentSession, SessionSummary } from '../../../shared/types.ts'
import { promptSessionTitle } from '../composer/prompt-title.ts'
import { nextActiveSessionId, type SessionActionTarget } from './sidebar-sessions.ts'
import { workspaceGroups } from './workspace-groups.ts'

interface WorkspaceSessionsOptions {
  onDraftMessage: (sessionId: string, message: string) => void
  onError: (cause: unknown) => void
  onInitialMessageSent: () => void
  onSessionsRefreshed: (sessions: SessionSummary[]) => void
  onWorkspaceSelected: () => void
}

interface StartSessionOptions {
  projectName?: string
  reportErrorInDialog?: boolean
  draftMessage?: string
  initialMessage?: string
  /** Whether selecting the launched session may reopen its collapsed section. */
  revealSection?: boolean
}

const COMPLETED_SESSIONS_KEY = 'pi-livecraft.completed-sessions'
const WORKSPACE_PATHS_KEY = 'pi-livecraft.workspace-paths'
const COLLAPSED_WORKSPACES_KEY = 'pi-livecraft.collapsed-workspaces'
const ACTIVE_WORKSPACE_KEY = 'pi-livecraft.active-workspace'
const SELECTED_SESSION_KEY = 'pi-livecraft.selected-session'
const ARCHIVED_SESSIONS_KEY = 'pi-livecraft.archived-sessions'
const WORKSPACE_NAMES_KEY = 'pi-livecraft.workspace-names'
const MAX_COMPLETED_SESSIONS = 30

/**
 * Owns the workspace sections, their session lists, persistence, and session creation.
 *
 * There is no main workspace: the active directory follows the selected session and
 * falls back to the workspace used last, so workspace-dependent features keep a
 * stable context while the user browses sections.
 */
export function useWorkspaceSessions(
  { onDraftMessage, onError, onInitialMessageSent, onSessionsRefreshed, onWorkspaceSelected }:
    WorkspaceSessionsOptions,
) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sentSessions, setSentSessions] = useState<RecentSession[]>([])
  const [completedSessionIds, setCompletedSessionIds] = useState<ReadonlySet<string>>(
    readCompletedSessionIds,
  )
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(true)
  const [workspacePaths, setWorkspacePaths] = useState<string[]>(readWorkspacePaths)
  const [collapsedWorkspacePaths, setCollapsedWorkspacePaths] = useState<ReadonlySet<string>>(
    readCollapsedWorkspacePaths,
  )
  const [archivedSessionPaths, setArchivedSessionPaths] = useState<ReadonlySet<string>>(
    () => readStringSet(ARCHIVED_SESSIONS_KEY),
  )
  const [workspaceNames, setWorkspaceNames] = useState<Readonly<Record<string, string>>>(
    readWorkspaceNames,
  )
  const [activeWorkspacePath, setActiveWorkspacePath] = useState(
    () => window.localStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? '',
  )
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(
    () => window.localStorage.getItem(SELECTED_SESSION_KEY) ?? '',
  )
  const [creatingSession, setCreatingSession] = useState(false)
  const sessionsRef = useRef(sessions)
  const completedSessionIdsRef = useRef(completedSessionIds)
  const selectedIdRef = useRef(selectedId)
  const creatingSessionRef = useRef(false)
  /** Session created in a section, whose selection must keep that section closed. */
  const quietSelectionIdRef = useRef('')
  const refreshVersionRef = useRef(0)
  const notifiedWorkspacePathRef = useRef<string | null>(null)
  sessionsRef.current = sessions
  completedSessionIdsRef.current = completedSessionIds
  selectedIdRef.current = selectedId

  const groups = useMemo(
    () =>
      workspaceGroups(recentSessions, sentSessions, sessions, workspacePaths, {
        archivedSessionPaths,
        workspaceNames,
      }),
    [archivedSessionPaths, recentSessions, sentSessions, sessions, workspaceNames, workspacePaths],
  )
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  const selectedSession = sessions.find((session) => session.id === selectedId)
  /** Workspace-dependent features follow the selected session, else the last used workspace. */
  const workspacePath = selectedSession?.cwd ?? activeWorkspacePath

  useEffect(() => {
    if (selectedId) window.localStorage.setItem(SELECTED_SESSION_KEY, selectedId)
    else window.localStorage.removeItem(SELECTED_SESSION_KEY)
    setCompletedSessionIds((current) => {
      const sessionKey = sessionsRef
        .current
        .find((session) => session.id === selectedId)
        ?.sessionPath ?? selectedId
      if (!current.has(sessionKey)) return current
      const next = new Set(current)
      next.delete(sessionKey)
      return next
    })
  }, [selectedId])

  // Keep the last workspace for features that outlive a selection, and tell the
  // application when the context changes so workspace-scoped state can reset.
  useEffect(() => {
    if (workspacePath) {
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspacePath)
      setActiveWorkspacePath((current) => current === workspacePath ? current : workspacePath)
    }
    if (notifiedWorkspacePathRef.current === workspacePath) return
    if (notifiedWorkspacePathRef.current !== null) onWorkspaceSelected()
    notifiedWorkspacePathRef.current = workspacePath
  }, [onWorkspaceSelected, workspacePath])

  // A session selected from anywhere reveals its section. Only a selection change
  // reopens it, so collapsing the current section survives later refreshes. A session
  // just created in a section does not reopen it: that section stays as the user left it.
  const selectedSessionCwd = selectedSession?.cwd
  useEffect(() => {
    if (!selectedId || !selectedSessionCwd) return
    if (quietSelectionIdRef.current === selectedId) {
      quietSelectionIdRef.current = ''
      return
    }
    setCollapsedWorkspacePaths((current) =>
      current.has(selectedSessionCwd) ? withoutPath(current, selectedSessionCwd) : current
    )
  }, [selectedId, selectedSessionCwd])

  useEffect(() => writeCompletedSessionIds(completedSessionIds), [completedSessionIds])
  useEffect(() => writeWorkspacePaths(workspacePaths), [workspacePaths])
  useEffect(() => writeCollapsedWorkspaces(collapsedWorkspacePaths), [collapsedWorkspacePaths])
  useEffect(() => writeStringSet(ARCHIVED_SESSIONS_KEY, archivedSessionPaths), [
    archivedSessionPaths,
  ])
  useEffect(() => writeWorkspaceNames(workspaceNames), [workspaceNames])

  /** Reloads every workspace section while discarding responses superseded by a newer refresh. */
  const refreshSessions = useCallback(async () => {
    const version = ++refreshVersionRef.current
    setIsRefreshingSessions(true)
    try {
      const [nextSessions, nextRecentSessions] = await Promise.all([
        listSessions(),
        listRecentSessions(),
      ])
      if (version !== refreshVersionRef.current) return
      const recentNames = new Map(
        nextRecentSessions.map((session) => [session.sessionPath, session.name]),
      )
      const namedSessions = nextSessions.map((session) => {
        const recentName = session.sessionPath ? recentNames.get(session.sessionPath) : undefined
        const previousName = sessionsRef.current.find((current) => current.id === session.id)?.name
        return recentName
          ? { ...session, name: recentName }
          : previousName && previousName !== 'New session'
          ? { ...session, name: previousName }
          : session
      })
      setSessions(namedSessions)
      setCompletedSessionIds((current) => {
        if (current.size === 0) return current
        const sessionKeys = new Set(
          nextSessions.flatMap((session) =>
            [session.id, session.sessionPath].filter((key): key is string => Boolean(key))
          ),
        )
        const recentKeys = new Set(nextRecentSessions.map((session) => session.sessionPath))
        const next = keepRecentCompletedSessionIds(
          [...current].filter((key) => sessionKeys.has(key) || recentKeys.has(key)),
        )
        return next.size === current.size ? current : next
      })
      setRecentSessions(nextRecentSessions)
      setSentSessions((current) =>
        current.filter((sent) =>
          !nextRecentSessions.some((recent) =>
            recent.id === sent.id || recent.sessionPath === sent.sessionPath
          )
        )
      )
      setSelectedId((current) =>
        nextSessions.some((session) => session.id === current) ? current : ''
      )
      onSessionsRefreshed(nextSessions)
    } catch (cause) {
      if (version === refreshVersionRef.current) onError(cause)
    } finally {
      if (version === refreshVersionRef.current) setIsRefreshingSessions(false)
    }
  }, [onError, onSessionsRefreshed])

  useEffect(() => void refreshSessions(), [refreshSessions])

  /** Registers a workspace so it keeps a section even when it has no sessions left. */
  const addWorkspacePath = useCallback((path: string): void => {
    if (!path) return
    setWorkspacePaths((current) =>
      current[0] === path ? current : [path, ...current.filter((candidate) => candidate !== path)]
    )
  }, [])

  const selectSession = useCallback((sessionId: string): void => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (session) addWorkspacePath(session.cwd)
    setSelectedId(sessionId)
  }, [addWorkspacePath])

  useEffect(() => {
    if (selectedSessionCwd) addWorkspacePath(selectedSessionCwd)
  }, [addWorkspacePath, selectedSessionCwd])

  const toggleWorkspaceCollapsed = useCallback((path: string): void => {
    setCollapsedWorkspacePaths((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }, [])

  /** Collapses or expands every listed workspace section at once (sidebar Collapse/Expand all). */
  const setWorkspacesCollapsed = useCallback(
    (paths: readonly string[], collapsed: boolean): void => {
      setCollapsedWorkspacePaths((current) => {
        const next = new Set(current)
        for (const path of paths) {
          if (collapsed) next.add(path)
          else next.delete(path)
        }
        return next.size === current.size && [...next].every((path) => current.has(path))
          ? current
          : next
      })
    },
    [],
  )

  /** Stores the optimistic title shared by first prompts in new and existing sessions. */
  const nameSessionFromFirstPrompt = useCallback(
    (session: SessionSummary, message: string): void => {
      const name = promptSessionTitle(message)
      setSessions((current) =>
        current.map((candidate) => candidate.id === session.id ? { ...candidate, name } : candidate)
      )
      const sessionPath = session.sessionPath
      if (!sessionPath) return
      setSentSessions((current) => [
        {
          id: session.id,
          cwd: session.cwd,
          name,
          sessionPath,
          updatedAt: Date.now(),
        },
        ...current.filter((recent) =>
          recent.id !== session.id && recent.sessionPath !== sessionPath
        ),
      ])
    },
    [],
  )

  /** Launches and selects a session, then sends or prepares its optional first prompt.
   *  Returns the created session summary, or null when an error prevented the operation. */
  const startAndSelectSession = useCallback(
    async (
      start: () => Promise<SessionSummary>,
      options: StartSessionOptions = {},
    ): Promise<SessionSummary | null> => {
      creatingSessionRef.current = true
      setCreatingSession(true)
      setSelectedId('')
      try {
        const session = await start()
        if (options.revealSection === false) quietSelectionIdRef.current = session.id
        await refreshSessions()
        selectSession(session.id)
        if (options.draftMessage) onDraftMessage(session.id, options.draftMessage)
        if (options.initialMessage) {
          await sendPiCommand(session.id, { type: 'prompt', message: options.initialMessage })
          nameSessionFromFirstPrompt(session, options.initialMessage)
          await refreshSessions()
          onInitialMessageSent()
        }
        return session
      } catch (cause) {
        if (options.reportErrorInDialog) throw cause
        onError(cause)
        return null
      } finally {
        creatingSessionRef.current = false
        setCreatingSession(false)
      }
    },
    [
      nameSessionFromFirstPrompt,
      onDraftMessage,
      onError,
      onInitialMessageSent,
      refreshSessions,
      selectSession,
    ],
  )

  /** Creates a session inside a workspace, selects it, and keeps the folder in the sidebar. */
  const createSessionInWorkspace = useCallback(
    async (cwd: string, options: StartSessionOptions = {}): Promise<SessionSummary | null> => {
      const session = await startAndSelectSession(
        () => createSession(cwd, options.projectName),
        { revealSection: false, ...options },
      )
      // Only a real session makes the folder worth keeping as an empty section.
      if (session) addWorkspacePath(session.cwd)
      return session
    },
    [addWorkspacePath, startAndSelectSession],
  )

  /** Selects the live session behind a row, or reopens its persisted history. */
  const openSessionRow = useCallback(
    async (row: RecentSession): Promise<void> => {
      // Opening an archived session means the user wants it back in the regular list.
      setArchivedSessionPaths((current) =>
        current.has(row.sessionPath) ? withoutPath(current, row.sessionPath) : current
      )
      const active = sessionsRef.current.find((session) =>
        session.sessionPath === row.sessionPath && session.status !== 'exited'
      )
      if (active) {
        selectSession(active.id)
        return
      }
      const session = await startAndSelectSession(() =>
        requestOpenSession(row.cwd, row.sessionPath)
      )
      if (session) addWorkspacePath(row.cwd)
    },
    [addWorkspacePath, selectSession, startAndSelectSession],
  )

  /** Opens the most recently active workspace other than the current one. */
  const activatePreviousWorkspace = useCallback((): void => {
    if (!workspacePath) return
    const previousPath = workspacePaths.find((path) =>
      path !== workspacePath
      && groups.some((group) => group.path === path && group.sessions.length > 0)
    )
    const target = groups.find((group) => group.path === previousPath)
      ?? groups.find((group) => group.path !== workspacePath && group.sessions.length > 0)
    const row = target?.sessions[0]
    if (!row) return
    void openSessionRow(row).catch(onError)
  }, [groups, onError, openSessionRow, workspacePath, workspacePaths])

  const updateSession = useCallback(
    (
      sessionId: string,
      update: Partial<Pick<SessionSummary, 'activeAgent' | 'name' | 'status'>>,
    ): void => {
      setSessions((current) =>
        current.map((session) => session.id === sessionId ? { ...session, ...update } : session)
      )
    },
    [],
  )

  /** Applies a manager-provided name consistently across live and recent session lists. */
  const renameSession = useCallback((sessionId: string, name: string): void => {
    const sessionPath = sessionsRef.current.find((session) => session.id === sessionId)?.sessionPath
    setSessions((current) =>
      current.map((session) => session.id === sessionId ? { ...session, name } : session)
    )
    if (!sessionPath) return
    setRecentSessions((current) =>
      current.map((session) => session.sessionPath === sessionPath ? { ...session, name } : session)
    )
    setSentSessions((current) =>
      current.map((session) =>
        session.id === sessionId || session.sessionPath === sessionPath
          ? { ...session, name }
          : session
      )
    )
  }, [])

  /** Renames an active session through Pi, or a history-only session through a disposable RPC. */
  const renameManagedSession = useCallback(
    async (target: SessionActionTarget, name: string): Promise<void> => {
      const normalized = name.trim()
      if (!normalized) throw new Error('Session name is required')
      if (target.sessionId) {
        await sendPiCommand(target.sessionId, { type: 'set_session_name', name: normalized })
        renameSession(target.sessionId, normalized)
      } else if (target.sessionPath) {
        await renameStoredSession(target.cwd, target.sessionPath, normalized)
      } else {
        throw new Error('Session path is unavailable')
      }
      await refreshSessions()
    },
    [refreshSessions, renameSession],
  )

  /** Stops a managed process, keeps its persisted history, and selects a nearby session. */
  const closeManagedSession = useCallback(async (sessionId: string): Promise<void> => {
    const closedWorkspacePath = sessionsRef
      .current
      .find((session) => session.id === sessionId)
      ?.cwd
    const nextId = selectedIdRef.current === sessionId
      ? nextActiveSessionId(
        sessionId,
        groupsRef.current.find((group) => group.path === closedWorkspacePath),
        sessionsRef.current,
      )
      : null
    await requestCloseSession(sessionId)
    if (selectedIdRef.current === sessionId) {
      if (nextId) selectSession(nextId)
      else setSelectedId('')
    }
    await refreshSessions()
  }, [refreshSessions, selectSession])

  /**
   * Restarts the Pi process behind a session on the same history, so Pi loads its extensions, skills,
   * prompts and models again. Opens the file directly: the session list may still show the closed process.
   */
  const reloadManagedSession = useCallback(async (sessionId: string): Promise<void> => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session?.sessionPath) throw new Error('This session has nothing saved to reload yet.')
    const { cwd, sessionPath } = session
    await requestCloseSession(sessionId)
    const reopened = await startAndSelectSession(() => requestOpenSession(cwd, sessionPath))
    if (!reopened) throw new Error('Pi could not be restarted for this session.')
  }, [startAndSelectSession])

  /** Closes the target's Pi process when it still runs; a retry after a failure skips it. */
  const closeIfRunning = useCallback(async (target: SessionActionTarget): Promise<void> => {
    const running = sessionsRef.current.some((session) =>
      session.id === target.sessionId && session.status !== 'exited'
    )
    if (running && target.sessionId) await closeManagedSession(target.sessionId)
  }, [closeManagedSession])

  /** Closes a running session, then moves its row under the section's archived list. */
  const archiveManagedSession = useCallback(
    async (target: SessionActionTarget): Promise<void> => {
      const { sessionPath } = target
      if (!sessionPath) throw new Error('Session path is unavailable')
      await closeIfRunning(target)
      setArchivedSessionPaths((current) =>
        current.has(sessionPath) ? current : new Set(current).add(sessionPath)
      )
    },
    [closeIfRunning],
  )

  /** Returns an archived row to the regular session list without opening it. */
  const unarchiveSession = useCallback((sessionPath: string): void => {
    setArchivedSessionPaths((current) =>
      current.has(sessionPath) ? withoutPath(current, sessionPath) : current
    )
  }, [])

  /** Closes a running session, then permanently deletes its history file. */
  const deleteManagedSession = useCallback(
    async (target: SessionActionTarget): Promise<void> => {
      const { sessionPath } = target
      if (!sessionPath) throw new Error('Session path is unavailable')
      await closeIfRunning(target)
      await deleteStoredSession(target.cwd, sessionPath)
      setArchivedSessionPaths((current) =>
        current.has(sessionPath) ? withoutPath(current, sessionPath) : current
      )
      setSentSessions((current) => current.filter((sent) => sent.sessionPath !== sessionPath))
      await refreshSessions()
    },
    [closeIfRunning, refreshSessions],
  )

  /**
   * Deletes a project: closes its running sessions, permanently deletes all its saved sessions,
   * optionally moves its folder to the Recycle Bin, and removes its section from the sidebar.
   */
  const deleteWorkspace = useCallback(
    async (path: string, deleteFolder: boolean): Promise<void> => {
      for (const session of sessionsRef.current) {
        if (session.cwd === path && session.status !== 'exited')
          await closeManagedSession(session.id)
      }
      await deleteProject(path, deleteFolder)
      const removedPaths = new Set(
        [...recentSessions, ...sentSessions]
          .filter((row) => row.cwd === path)
          .map((row) => row.sessionPath),
      )
      setWorkspacePaths((current) => current.filter((candidate) => candidate !== path))
      setWorkspaceNames((current) => {
        if (!(path in current)) return current
        const next = { ...current }
        delete next[path]
        return next
      })
      setCollapsedWorkspacePaths((current) =>
        current.has(path) ? withoutPath(current, path) : current
      )
      setArchivedSessionPaths((current) =>
        [...current].some((sessionPath) => removedPaths.has(sessionPath))
          ? new Set([...current].filter((sessionPath) => !removedPaths.has(sessionPath)))
          : current
      )
      setSentSessions((current) => current.filter((sent) => sent.cwd !== path))
      if (activeWorkspacePath === path) {
        window.localStorage.removeItem(ACTIVE_WORKSPACE_KEY)
        setActiveWorkspacePath('')
      }
      await refreshSessions()
    },
    [activeWorkspacePath, closeManagedSession, recentSessions, refreshSessions, sentSessions],
  )

  /** Stores a sidebar-only workspace name; an empty name restores the folder name. */
  const renameWorkspace = useCallback((path: string, name: string): void => {
    const normalized = name.trim()
    setWorkspaceNames((current) => {
      if ((current[path] ?? '') === normalized) return current
      const next = { ...current }
      if (normalized) next[path] = normalized
      else delete next[path]
      return next
    })
  }, [])

  /** Adds or replaces a pending UI request for a session. */
  const addPendingRequest = useCallback((sessionId: string, request: JsonObject): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            pendingUi: [
              ...session
                .pendingUi
                .filter((pending) => pending.id !== request.id),
              request,
            ],
          }
          : session
      )
    )
  }, [])

  /** Removes an answered UI request before the next manager reconciliation. */
  const removePendingRequest = useCallback((sessionId: string, requestId: string): void => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            pendingUi: session.pendingUi.filter((request) => request.id !== requestId),
          }
          : session
      )
    )
  }, [])

  const markSessionCompleted = useCallback((sessionId: string): void => {
    if (sessionId === selectedIdRef.current) return
    const sessionKey = sessionsRef.current.find((session) => session.id === sessionId)?.sessionPath
      ?? sessionId
    setCompletedSessionIds((current) => {
      const next = new Set(current)
      next.delete(sessionKey)
      next.add(sessionKey)
      return keepRecentCompletedSessionIds(next)
    })
  }, [])

  const selectCreatedSession = useCallback((sessionId: string): void => {
    if (!creatingSessionRef.current) return
    setSelectedId(sessionId)
    creatingSessionRef.current = false
  }, [])

  return {
    activatePreviousWorkspace,
    addPendingRequest,
    addWorkspacePath,
    archiveManagedSession,
    closeManagedSession,
    collapsedWorkspacePaths,
    completedSessionIds,
    createSessionInWorkspace,
    creatingSession,
    deleteManagedSession,
    deleteWorkspace,
    groups,
    isRefreshingSessions,
    markSessionCompleted,
    nameSessionFromFirstPrompt,
    newSessionDialogOpen,
    openSessionRow,
    refreshSessions,
    reloadManagedSession,
    removePendingRequest,
    renameManagedSession,
    renameSession,
    renameWorkspace,
    selectCreatedSession,
    selectedId,
    sessions,
    setNewSessionDialogOpen,
    setWorkspacesCollapsed,
    selectSession,
    toggleWorkspaceCollapsed,
    unarchiveSession,
    updateSession,
    workspacePath,
  }
}

/** Restores the sidebar names the user gave to workspace folders. */
function readWorkspaceNames(): Readonly<Record<string, string>> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(WORKSPACE_NAMES_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] =>
        entry[0] !== '' && typeof entry[1] === 'string' && entry[1].trim() !== ''
      ),
    )
  } catch {
    return {}
  }
}

function writeWorkspaceNames(names: Readonly<Record<string, string>>): void {
  try {
    if (Object.keys(names).length === 0) window.localStorage.removeItem(WORKSPACE_NAMES_KEY)
    else window.localStorage.setItem(WORKSPACE_NAMES_KEY, JSON.stringify(names))
  } catch {
    // localStorage may be unavailable
  }
}

function writeStringSet(key: string, values: ReadonlySet<string>): void {
  try {
    if (values.size === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify([...values]))
  } catch {
    // localStorage may be unavailable
  }
}

/** Reads the explicitly added workspace folders persisted across restarts. */
function readWorkspacePaths(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(WORKSPACE_PATHS_KEY) ?? '[]')
    return Array.isArray(value)
      ? [
        ...new Set(value.filter((path): path is string => typeof path === 'string' && path !== '')),
      ]
      : []
  } catch {
    return []
  }
}

/** Persists the explicitly added workspace folders in their section order. */
function writeWorkspacePaths(paths: readonly string[]): void {
  try {
    if (paths.length === 0) window.localStorage.removeItem(WORKSPACE_PATHS_KEY)
    else window.localStorage.setItem(WORKSPACE_PATHS_KEY, JSON.stringify(paths))
  } catch {
    // localStorage may be unavailable
  }
}

/** Restores the collapsed workspace sections persisted across restarts. */
function readCollapsedWorkspacePaths(): ReadonlySet<string> {
  return readStringSet(COLLAPSED_WORKSPACES_KEY)
}

function writeCollapsedWorkspaces(paths: ReadonlySet<string>): void {
  writeStringSet(COLLAPSED_WORKSPACES_KEY, paths)
}

/** Restores completed-session identifiers persisted across same-tab refreshes. */
function readCompletedSessionIds(): ReadonlySet<string> {
  try {
    const stored = window.sessionStorage.getItem(COMPLETED_SESSIONS_KEY)
    if (!stored) return new Set()
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set()
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return keepRecentCompletedSessionIds(ids)
  } catch {
    return new Set()
  }
}

function readStringSet(key: string): ReadonlySet<string> {
  try {
    const stored = window.localStorage.getItem(key)
    if (!stored) return new Set()
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && !!value))
  } catch {
    return new Set()
  }
}

/** Persists completed-session identifiers so they survive a page refresh within the same tab. */
function writeCompletedSessionIds(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) window.sessionStorage.removeItem(COMPLETED_SESSIONS_KEY)
    else window.sessionStorage.setItem(
        COMPLETED_SESSIONS_KEY,
        JSON.stringify([...keepRecentCompletedSessionIds(ids)]),
      )
  } catch {
    // sessionStorage may be unavailable
  }
}

function withoutPath(paths: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(paths)
  next.delete(path)
  return next
}

function keepRecentCompletedSessionIds(ids: Iterable<string>): ReadonlySet<string> {
  return new Set([...ids].slice(-MAX_COMPLETED_SESSIONS))
}
