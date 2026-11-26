import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import {
  commitChanges,
  discardChanges,
  getGitFileDiff,
  getGitSnapshot,
  openExplorer,
  openTerminal,
  pushCommits,
  resetGitCommit,
  restartManager,
  revertGitCommit,
  sendPiCommand,
  subscribeManagerEvents,
} from './api.ts'
import type {
  GitSnapshot,
  JsonObject,
  ManagerRuntimeStatus,
  SessionSummary,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'
import { Composer } from './features/composer/Composer.tsx'
import { PlanPanel } from './features/plan/PlanPanel.tsx'
import { setTabAttention, tabUnwatched } from './features/notifications/tab-attention.ts'
import { ToastStack, type Toast } from './features/notifications/ToastStack.tsx'
import { sessionActivity, type PiConnection } from './features/conversation/activity.ts'
import { type ReplyFailure, replyFailureFrom } from './features/conversation/reply-failure.ts'
import { Conversation } from './features/conversation/Conversation.tsx'
import {
  nextConversationView,
  type ConversationView,
} from './features/conversation/conversation-view.ts'
import { useConversationRuntime } from './features/conversation/useConversationRuntime.ts'
import { AskUserQuestionDialog, ExtensionDialog } from './features/dialogs/Dialogs.tsx'
import {
  isAgentSelector,
  isAskUserQuestionDialog,
  isBlockingDialog,
  type UiDialog,
} from './features/dialogs/dialog-protocol.ts'
import {
  clampRightSidebarWidth,
  isRightWidget,
  readRightSidebarWidth,
  type RightWidget,
} from './features/right-sidebar/right-sidebar.ts'
import { PanelIcon } from './components/PanelIcon.tsx'
import { RightSidebar } from './features/right-sidebar/RightSidebar.tsx'
import { SessionTopBar } from './features/top-bar/SessionTopBar.tsx'
import { Tooltip } from './components/Tooltip.tsx'
import { NewSessionDialog } from './features/workspace/NewSessionDialog.tsx'
import { useWorkspaceSessions } from './features/workspace/useWorkspaceSessions.ts'
import { WorkspaceSidebar } from './features/workspace/WorkspaceSidebar.tsx'
import {
  clampWorkspaceSidebarWidth,
  readWorkspaceSidebarCollapsed,
  readWorkspaceSidebarWidth,
} from './features/workspace/workspace-sidebar.ts'
import { CommandPalette, type PaletteCommand } from './features/commands/CommandPalette.tsx'
import {
  commandDefinitions,
  defaultShortcuts,
  lastAssistantText,
  migrateLegacyShortcut,
  rightWidgetFromCommand,
  shortcutFromEvent,
  type CommandId,
} from './features/commands/command-registry.ts'
import {
  applyFontSizes,
  readFontSizes,
  storeFontSizes,
} from './features/settings/font-size-storage.ts'
import { readSidebarBanner, storeSidebarBanner } from './features/workspace/sidebar-banner.ts'
import {
  finishedSoundKind,
  type NotificationSoundKind,
} from './features/notifications/notification-sounds.ts'
import {
  playChime,
  readNotificationSounds,
  storeNotificationSounds,
  unlockNotificationSounds,
} from './features/notifications/sound-player.ts'
import { WelcomeBanner } from './components/WelcomeBanner.tsx'
import { SettingsPanel, type SettingsTabId } from './features/settings/SettingsPanel.tsx'
import {
  describeSessionStats,
  findModel,
  type ParsedBuiltinCommand,
} from './features/composer/builtin-commands.ts'
import { ManagerRuntimeNotice } from './features/manager/ManagerRuntimeNotice.tsx'
import {
  allThemes,
  applyThemePalette,
  deleteTheme,
  duplicateTheme,
  persistThemePreferences,
  readThemePreferences,
  renameTheme,
  resetTheme,
  resolveActiveTheme,
  setActiveTheme,
  shadowForMode,
  updateThemeColor,
  type ThemeVariable,
} from './features/settings/themes.ts'
import {
  analyzeSession,
  type SessionAnalysisTarget,
} from './features/session-analysis/session-analysis.ts'
import './features/commands/commands.css'

const emptyAgentOptions: string[] = []
const gitRefreshDelayMs = 250
const managerUnavailableMessage = 'Pi manager is unavailable'
const managerUnavailableToastDelayMs = 1_000
/** Orchestrates workspace state, Pi events, and UI panels. */
function App() {
  // Workspace and sessions
  const [compactingSessionIds, setCompactingSessionIds] = useState<ReadonlySet<string>>(new Set())
  /** Sessions whose last message got no reply, and why (shown above the message box). */
  const [replyFailures, setReplyFailures] = useState<Readonly<Record<string, ReplyFailure>>>({})
  /** The failed reply of a run still in progress; a later reply (a retry) clears it. */
  const pendingReplyFailuresRef = useRef(new Map<string, ReplyFailure>())
  const dismissReplyFailure = useCallback((sessionId: string): void => {
    setReplyFailures((current) => {
      if (!(sessionId in current)) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  // Conversation and Pi lifecycle
  const [piConnection, setPiConnection] = useState<PiConnection>('connecting')
  const [managerRuntimeStatus, setManagerRuntimeStatus] = useState<ManagerRuntimeStatus>({
    state: 'disconnected',
    canRestart: false,
  })
  const [conversationView, setConversationView] = useState<ConversationView>(() => {
    const stored = window.localStorage.getItem('pi-livecraft.conversation-view')
    if (stored === 'detailed' || stored === 'simple-expanded') return 'detailed'
    if (stored === 'semi-detailed') return 'semi-detailed'
    if (stored === 'simple') return 'simple'
    return window.localStorage.getItem('pi-livecraft.detailed-view') === 'false'
      ? 'simple'
      : 'detailed'
  })
  const selectConversationView = useCallback((view: ConversationView) => {
    setConversationView(view)
    window.localStorage.setItem('pi-livecraft.conversation-view', view)
  }, [])

  // Dialogs and notifications
  const [agentOptions, setAgentOptions] = useState<Record<string, string[]>>({})
  const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({})
  const [agentOptionsLoading, setAgentOptionsLoading] = useState<Record<string, boolean>>({})
  const agentOptionsLoadingRef = useRef(agentOptionsLoading)
  useEffect(() => {
    agentOptionsLoadingRef.current = agentOptionsLoading
  }, [agentOptionsLoading])
  const [dialog, setDialog] = useState<UiDialog | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  // Workspace tools and sidebars
  const [workspaceSidebarWidth, setWorkspaceSidebarWidth] = useState(() =>
    readWorkspaceSidebarWidth(window.localStorage.getItem('pi-livecraft.workspace-sidebar-width'))
  )
  const [workspaceSidebarCollapsed, setWorkspaceSidebarCollapsed] = useState(() =>
    readWorkspaceSidebarCollapsed(
      window.localStorage.getItem('pi-livecraft.workspace-sidebar-collapsed'),
    )
  )
  const [gitSnapshot, setGitSnapshot] = useState<GitSnapshot | null>(null)
  const [activeRightWidget, setActiveRightWidget] = useState<RightWidget | null>(
    readActiveRightWidget,
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readRightSidebarWidth(
      window.localStorage.getItem('pi-livecraft.right-sidebar-width') ?? window
        .localStorage
        .getItem('pi-livecraft.git-sidebar-width'),
    )
  )
  const [rightSidebarHidden, setRightSidebarHidden] = useState(() =>
    window.localStorage.getItem('pi-livecraft.right-sidebar-hidden') === 'true'
  )
  /** Whether the "Your messages" list, opened from the top bar, is shown. */
  const [messageNavigatorOpen, setMessageNavigatorOpen] = useState(false)
  const closeMessageNavigator = useCallback(() => setMessageNavigatorOpen(false), [])

  // Preferences and commands
  const [themePreferences, setThemePreferences] = useState(() => readThemePreferences())
  const activeTheme = useMemo(() => resolveActiveTheme(themePreferences), [themePreferences])
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>('themes')

  // Transient UI requests and measurements
  type LoadingPhase = 'hidden' | 'entering' | 'visible' | 'exiting'
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('hidden')
  const [requestedSelect, setRequestedSelect] = useState<'agent' | 'model' | 'thinking' | null>(
    null,
  )
  const [submitRequest, setSubmitRequest] = useState(0)
  const [focusComposerRequest, setFocusComposerRequest] = useState(0)
  const [composerDraftRequest, setComposerDraftRequest] = useState<
    { id: string; message: string; sessionId: string }
  >()
  const [scrollToBottomRequest, setScrollToBottomRequest] = useState(0)
  const [conversationNavigation, setConversationNavigation] = useState<
    { id: number; target: SessionAnalysisTarget }
  >()
  const [shortcuts, setShortcuts] = useState(() => readShortcuts())
  const [terminalCommand, setTerminalCommand] = useState(() => readTerminalCommand())
  const [newSessionDialogMode, setNewSessionDialogMode] = useState<'session' | 'project'>(
    'session',
  )
  const [sidebarBanner, setSidebarBanner] = useState(() => readSidebarBanner())
  const [notificationSounds, setNotificationSounds] = useState(() => readNotificationSounds())
  const notificationSoundsRef = useRef(notificationSounds)
  notificationSoundsRef.current = notificationSounds
  useEffect(() => unlockNotificationSounds(), [])
  const [fontSizes, setFontSizes] = useState(() => readFontSizes())
  useEffect(() => applyFontSizes(document.documentElement, fontSizes), [fontSizes])

  // Workspace and session synchronization
  const selectedIdRef = useRef(window.localStorage.getItem('pi-livecraft.selected-session') ?? '')
  const replayPiEventRef = useRef<
    (sessionId: string, event: JsonObject, sequence?: number) => void
  >(() => undefined)
  const replayPiEvent = useCallback(
    (sessionId: string, event: JsonObject, sequence?: number): void => {
      replayPiEventRef.current(sessionId, event, sequence)
    },
    [],
  )

  // UI and capability synchronization
  const loadingTimerRef = useRef<number>(0)
  const gitRefreshVersionRef = useRef(0)
  const gitRefreshTimerRef = useRef<number | undefined>(undefined)
  const agentResponsesSentRef = useRef(new Set<string>())

  const dismissingRef = useRef(new Set<string>())
  const pendingManagerUnavailableToastsRef = useRef(new Map<string, number>())

  // Notifications
  /** Marks a toast as dismissing, then removes it after the exit animation. */
  const startDismissal = useCallback((id: string) => {
    if (dismissingRef.current.has(id)) return
    dismissingRef.current.add(id)
    setToasts((current) =>
      current.map((toast) => toast.id === id ? { ...toast, dismissing: true } : toast)
    )
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
      dismissingRef.current.delete(id)
    }, 160)
  }, [])

  const showToast = useCallback(
    (kind: Toast['kind'], message: string, sessionId: string | null = selectedIdRef.current) => {
      const toast = { id: crypto.randomUUID(), kind, message, sessionId }
      const publish = () => {
        pendingManagerUnavailableToastsRef.current.delete(toast.id)
        setToasts((current) => [...current, toast])
        window.setTimeout(
          () => startDismissal(toast.id),
          kind === 'error' ? 5000 : 3000,
        )
      }
      if (kind === 'error' && message === managerUnavailableMessage) {
        const timer = window.setTimeout(publish, managerUnavailableToastDelayMs)
        pendingManagerUnavailableToastsRef.current.set(toast.id, timer)
        return
      }
      publish()
    },
    [startDismissal],
  )
  const clearManagerUnavailableToasts = useCallback(() => {
    for (const timer of pendingManagerUnavailableToastsRef.current.values()) {
      window.clearTimeout(timer)
    }
    pendingManagerUnavailableToastsRef.current.clear()
    setToasts((current) => current.filter((toast) => toast.message !== managerUnavailableMessage))
  }, [])
  useEffect(() => () => {
    for (const timer of pendingManagerUnavailableToastsRef.current.values()) {
      window.clearTimeout(timer)
    }
  }, [])

  /** Removes a toast after explicit dismissal or automatic timeout. */
  const dismissToast = useCallback((id: string) => startDismissal(id), [startDismissal])

  /** Restores visible dialogs and resolves stale agent selectors that block manager restart. */
  const handleSessionsRefreshed = useCallback((nextSessions: SessionSummary[]): void => {
    // Restore user-facing dialogs (excludes agent selectors which are handled silently)
    const pending = nextSessions
      .flatMap((session) =>
        session.pendingUi.map((request) => ({ sessionId: session.id, request }))
      )
      .find(({ request }) => !isAgentSelector(request))
    setDialog((current) =>
      pending
        ?? (current && nextSessions.some(({ id }) => id === current.sessionId) ? current : null)
    )
    // Resolve stale agent selectors that were missed during an SSE disconnect.
    // Options are fetched on demand when the user opens the dropdown.
    for (const session of nextSessions) {
      for (const request of session.pendingUi) {
        if (!isAgentSelector(request)) continue
        const key = `${session.id}:${request.id}`
        if (agentResponsesSentRef.current.has(key)) continue
        agentResponsesSentRef.current.add(key)
        void sendPiCommand(session.id, {
          type: 'extension_ui_response',
          id: request.id,
          cancelled: true,
        })
          .catch((cause) => {
            agentResponsesSentRef.current.delete(key)
            showToast('error', messageOf(cause))
          })
      }
    }
  }, [showToast])
  const handleWorkspaceSelected = useCallback((): void => {
    setGitSnapshot(null)
    setActiveRightWidget(null)
  }, [])
  const handleSessionDraft = useCallback((sessionId: string, message: string): void => {
    setComposerDraftRequest({ id: crypto.randomUUID(), message, sessionId })
  }, [])
  const handleInitialMessageSent = useCallback(
    (): void => setScrollToBottomRequest((current) => current + 1),
    [],
  )
  const handleWorkspaceError = useCallback(
    (cause: unknown): void => showToast('error', messageOf(cause)),
    [showToast],
  )
  const {
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
  } = useWorkspaceSessions({
    onDraftMessage: handleSessionDraft,
    onError: handleWorkspaceError,
    onInitialMessageSent: handleInitialMessageSent,
    onSessionsRefreshed: handleSessionsRefreshed,
    onWorkspaceSelected: handleWorkspaceSelected,
  })
  // Only the sidebar's New project opens the dialog in project mode; every other way opens it
  // as New session, so the mode resets whenever the dialog closes.
  useEffect(() => {
    if (!newSessionDialogOpen) setNewSessionDialogMode('session')
  }, [newSessionDialogOpen])
  selectedIdRef.current = selectedId

  // Browser tab attention
  /** Whether the session on screen settled while nobody was watching the tab. */
  const [hiddenSessionCompleted, setHiddenSessionCompleted] = useState(false)
  /**
   * Badges the favicon while a completed session stays unopened, mirroring the sidebar markers.
   * Completions of sessions that no longer exist are ignored so the badge cannot get stuck.
   */
  const unseenCompletion = hiddenSessionCompleted
    || [...completedSessionIds].some((id) =>
      sessions.some((session) => (session.sessionPath ?? session.id) === id)
    )
  useEffect(() => setTabAttention(unseenCompletion), [unseenCompletion])
  useEffect(() => {
    const clearHiddenCompletion = () => {
      if (!document.hidden) setHiddenSessionCompleted(false)
    }
    document.addEventListener('visibilitychange', clearHiddenCompletion)
    window.addEventListener('focus', clearHiddenCompletion)
    return () => {
      document.removeEventListener('visibilitychange', clearHiddenCompletion)
      window.removeEventListener('focus', clearHiddenCompletion)
    }
  }, [])

  const {
    activity,
    addOptimisticUserMessage,
    addPendingSteering,
    clearActivity,
    flushLiveUpdates,
    handlePiEvent,
    liveMessages,
    observedRequestDurations,
    observedToolDurations,
    pendingSteering,
    plan,
    refreshSnapshot,
    removeLiveMessage,
    removePendingSteering,
    resetEventSequence,
    snapshot,
    snapshotSessionId,
    toolExecutions,
  } = useConversationRuntime(selectedId, handleWorkspaceError, replayPiEvent)
  const handleForkConversation = useCallback(async (entryId: string): Promise<boolean> => {
    const response = await sendPiCommand(selectedId, { type: 'fork', entryId })
    const data = isObject(response.data) ? response.data : undefined
    if (data?.cancelled === true) return false
    if (typeof data?.text === 'string') {
      setComposerDraftRequest({
        id: crypto.randomUUID(),
        message: data.text,
        sessionId: selectedId,
      })
    }
    await Promise.all([refreshSnapshot(selectedId), refreshSessions()])
    return true
  }, [refreshSessions, refreshSnapshot, selectedId])

  const visibleToasts = toasts.filter((toast) =>
    toast.sessionId === null || toast.sessionId === selectedId
  )

  // Sidebar preferences
  const updateWorkspaceSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampWorkspaceSidebarWidth(width)
    window.localStorage.setItem('pi-livecraft.workspace-sidebar-width', String(nextWidth))
    setWorkspaceSidebarWidth(nextWidth)
  }, [])

  const toggleWorkspaceSidebar = useCallback(() => {
    const nextCollapsed = !workspaceSidebarCollapsed
    window.localStorage.setItem(
      'pi-livecraft.workspace-sidebar-collapsed',
      String(nextCollapsed),
    )
    setWorkspaceSidebarCollapsed(nextCollapsed)
  }, [workspaceSidebarCollapsed])

  const updateRightSidebarWidth = useCallback((width: number) => {
    const nextWidth = clampRightSidebarWidth(width)
    window.localStorage.setItem('pi-livecraft.right-sidebar-width', String(nextWidth))
    setRightSidebarWidth(nextWidth)
  }, [])

  /** Hides or shows the whole tools sidebar, rail included, and remembers the choice. */
  const setRightSidebarHiddenPreference = useCallback((hidden: boolean) => {
    window.localStorage.setItem('pi-livecraft.right-sidebar-hidden', String(hidden))
    setRightSidebarHidden(hidden)
  }, [])

  const openRightWidget = useCallback((widget: RightWidget) => {
    window.localStorage.setItem('pi-livecraft.right-sidebar-widget', widget)
    setActiveRightWidget(widget)
    // A widget opened from the palette or a shortcut brings a hidden sidebar back.
    setRightSidebarHiddenPreference(false)
  }, [setRightSidebarHiddenPreference])

  // Theme preferences
  const selectTheme = useCallback((id: string) => {
    setThemePreferences((current) => setActiveTheme(current, id))
  }, [])

  const duplicateActiveTheme = useCallback(() => {
    setThemePreferences((current) => {
      const source = resolveActiveTheme(current)
      const duplicated = duplicateTheme(current, source.id, `${source.name} custom`)
      const created = duplicated.themes.at(-1)
      return created ? setActiveTheme(duplicated, created.id) : duplicated
    })
  }, [])

  const renameSelectedTheme = useCallback((id: string, name: string) => {
    setThemePreferences((current) => renameTheme(current, id, name))
  }, [])

  const updateSelectedThemeColor = useCallback(
    (id: string, variable: ThemeVariable, color: string) => {
      setThemePreferences((current) => updateThemeColor(current, id, variable, color))
    },
    [],
  )

  const deleteSelectedTheme = useCallback((id: string) => {
    setThemePreferences((current) => deleteTheme(current, id))
  }, [])

  const resetSelectedTheme = useCallback((id: string) => {
    setThemePreferences((current) => resetTheme(current, id))
  }, [])

  useEffect(() => {
    persistThemePreferences(themePreferences)
  }, [themePreferences])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = activeTheme.mode
    applyThemePalette(root, activeTheme.palette)
    const shadows = shadowForMode(activeTheme.mode)
    root.style.setProperty('--shadow', shadows.shadow)
    root.style.setProperty('--shadow-soft', shadows['shadow-soft'])
  }, [activeTheme])

  // Dialogs
  /** Clears an answered request immediately, then reconciles all pending requests with the manager. */
  const closeDialog = useCallback((closedDialog: UiDialog) => {
    const requestId = closedDialog.request.id
    setDialog((current) =>
      current?.sessionId === closedDialog.sessionId && current.request.id === requestId
        ? null
        : current
    )
    if (typeof requestId === 'string') removePendingRequest(closedDialog.sessionId, requestId)
    void refreshSessions()
  }, [refreshSessions, removePendingRequest])

  // Workspace capabilities
  /** Refreshes Git state for the current directory. Throws when requested so callers can handle the error. */
  const refreshGit = useCallback(async (cwd = workspacePath, notifyOnError = false) => {
    if (gitRefreshTimerRef.current !== undefined) {
      window.clearTimeout(gitRefreshTimerRef.current)
      gitRefreshTimerRef.current = undefined
    }
    const version = ++gitRefreshVersionRef.current
    // Before any workspace is opened there is no repository to ask about.
    if (!cwd) {
      setGitSnapshot(null)
      return
    }
    try {
      const nextSnapshot = await getGitSnapshot(cwd)
      if (version === gitRefreshVersionRef.current) setGitSnapshot(nextSnapshot)
    } catch (cause) {
      if (notifyOnError && version === gitRefreshVersionRef.current) throw cause
    }
  }, [workspacePath])
  /** Schedules one Git refresh for a burst of completed tools. */
  const scheduleGitRefresh = useCallback((cwd = workspacePath): void => {
    if (gitRefreshTimerRef.current !== undefined)
      window.clearTimeout(gitRefreshTimerRef.current)
    gitRefreshTimerRef.current = window.setTimeout(() => {
      gitRefreshTimerRef.current = undefined
      void refreshGit(cwd)
    }, gitRefreshDelayMs)
  }, [refreshGit, workspacePath])

  /** Sends /agent to Pi, intercepts the resulting selector silently, and caches its options. */
  const fetchAgentOptions = useCallback((sessionId: string) => {
    if (agentOptionsLoadingRef.current[sessionId] || agentOptions[sessionId]) return
    setAgentOptionsLoading((current) => ({ ...current, [sessionId]: true }))
    void sendPiCommand(sessionId, { type: 'prompt', message: '/agent' })
      .catch((cause) => {
        setAgentOptionsLoading((current) => ({ ...current, [sessionId]: false }))
        showToast('error', messageOf(cause))
      })
  }, [agentOptions, showToast])

  /** Activates an agent directly without opening the interactive selector. */
  const activateAgent = useCallback((sessionId: string, agentName: string) => {
    if (agentBusy[sessionId]) return
    setAgentBusy((current) => ({ ...current, [sessionId]: true }))
    void sendPiCommand(sessionId, { type: 'prompt', message: `/agent ${agentName}` })
      .then(() => refreshSnapshot(sessionId))
      .catch((cause) => showToast('error', messageOf(cause)))
      .finally(() => setAgentBusy((current) => ({ ...current, [sessionId]: false })))
  }, [agentBusy, refreshSnapshot, showToast])

  // Initial application synchronization
  useEffect(() => {
    void refreshGit()
    return () => {
      if (gitRefreshTimerRef.current !== undefined) {
        window.clearTimeout(gitRefreshTimerRef.current)
        gitRefreshTimerRef.current = undefined
      }
    }
  }, [refreshGit])

  // Selected session synchronization
  useEffect(() => setConversationNavigation(undefined), [selectedId])

  // Pi event stream
  /** Routes a live or replayed Pi event through cross-feature effects before the conversation runtime. */
  const handleManagerPiEvent = useCallback(
    (sessionId: string, event: JsonObject, sequence?: number): void => {
      if (event.type === 'session_info_changed') {
        const name = typeof event.name === 'string' && event.name.trim()
          ? event.name.trim()
          : 'New session'
        renameSession(sessionId, name)
      }
      if (event.type === 'agent_start') {
        updateSession(sessionId, { status: 'running' })
        pendingReplyFailuresRef.current.delete(sessionId)
        dismissReplyFailure(sessionId)
      }
      // A reply that ended in an error is remembered until the run settles: Pi may still compact
      // and retry, and a successful reply after it means there is nothing to report.
      if (
        event.type === 'message_end' && isObject(event.message)
        && event.message.role === 'assistant'
      ) {
        const failure = replyFailureFrom(event.message)
        if (failure) pendingReplyFailuresRef.current.set(sessionId, failure)
        else if (event.message.stopReason !== 'aborted')
          pendingReplyFailuresRef.current.delete(sessionId)
      }
      if (event.type === 'agent_settled') {
        const failure = pendingReplyFailuresRef.current.get(sessionId)
        pendingReplyFailuresRef.current.delete(sessionId)
        if (failure) setReplyFailures((current) => ({ ...current, [sessionId]: failure }))
        updateSession(sessionId, { status: 'idle' })
        markSessionCompleted(sessionId)
        if (tabUnwatched() && sessionId === selectedIdRef.current)
          setHiddenSessionCompleted(true)
      }
      if (event.type === 'compaction_start')
        setCompactingSessionIds((current) => new Set(current).add(sessionId))
      if (event.type === 'compaction_end')
        setCompactingSessionIds((current) => {
          if (!current.has(sessionId)) return current
          const next = new Set(current)
          next.delete(sessionId)
          return next
        })
      if (
        event.type === 'auto_retry_end' && event.success === false && typeof event
            .finalError === 'string'
      ) {
        showToast(
          'error',
          `Provider connection failed after retries: ${event.finalError}`,
          sessionId,
        )
      }
      if (event.type === 'tool_execution_end') scheduleGitRefresh()
      if (
        event.type === 'extension_ui_request' && event.method === 'setStatus'
        && event.statusKey === 'agent'
      ) {
        updateSession(sessionId, {
          activeAgent: typeof event.activeAgent === 'string' ? event.activeAgent : undefined,
        })
      }
      if (
        event.type === 'extension_ui_request' && isBlockingDialog(event) && !isAgentSelector(event)
      ) {
        // Commit batched assistant deltas before a blocking dialog covers the conversation.
        if (sessionId === selectedIdRef.current) flushLiveUpdates()
        if (typeof event.id === 'string') addPendingRequest(sessionId, event)
        if (sessionId === selectedIdRef.current) clearActivity()
      }
      if (event.type === 'extension_ui_request') {
        if (
          event.method === 'notify' || (event.method === 'setStatus' && event.statusKey === 'agent')
        ) selectCreatedSession(sessionId)
        if (event.method === 'notify' && typeof event.message === 'string')
          showToast(event.notifyType === 'error' ? 'error' : 'notice', event.message, sessionId)
        // Intercept agent selector silently when Livecraft requested the options list.
        if (isAgentSelector(event) && agentOptionsLoadingRef.current[sessionId]) {
          const options = event.options.filter((o): o is string => typeof o === 'string')
          setAgentOptions((current) => ({ ...current, [sessionId]: options }))
          setAgentOptionsLoading((current) => ({ ...current, [sessionId]: false }))
          void sendPiCommand(sessionId, {
            type: 'extension_ui_response',
            id: event.id,
            cancelled: true,
          })
            .catch((cause) => showToast('error', messageOf(cause)))
          return
        }
        if (isAgentSelector(event)) {
          // Pi-initiated selector (e.g. user typed /agent in Pi terminal) — show as normal dialog.
          if (isBlockingDialog(event)) setDialog({ sessionId, request: event })
          return
        }
        if (isBlockingDialog(event)) setDialog({ sessionId, request: event })
      }

      const selected = sessionId === selectedIdRef.current
      handlePiEvent(sessionId, event, sequence)
      if (selected && event.type === 'agent_settled')
        setFocusComposerRequest((current) => current + 1)
    },
    [
      addPendingRequest,
      clearActivity,
      dismissReplyFailure,
      flushLiveUpdates,
      handlePiEvent,
      markSessionCompleted,
      scheduleGitRefresh,
      renameSession,
      selectCreatedSession,
      showToast,
      updateSession,
    ],
  )
  replayPiEventRef.current = handleManagerPiEvent

  /** Plays the notification chime a live Pi event calls for, if that sound is turned on. */
  const playEventSound = useCallback((sessionId: string, event: JsonObject): void => {
    const preferences = notificationSoundsRef.current
    let kind: NotificationSoundKind | null = null
    if (event.type === 'agent_settled') {
      kind = finishedSoundKind(sessionId, selectedIdRef.current, !tabUnwatched())
    } else if (
      event.type === 'extension_ui_request' && isBlockingDialog(event) && !isAgentSelector(event)
    ) {
      kind = 'input'
    }
    if (kind && preferences.enabled[kind]) playChime(kind, preferences.volume)
  }, [])

  useEffect(() =>
    subscribeManagerEvents((managerEvent) => {
      if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'manager_disconnected'
      ) {
        setPiConnection(managerEvent.event === 'manager_connected' ? 'connected' : 'disconnected')
        if (managerEvent.event === 'manager_connected') clearManagerUnavailableToasts()
        clearActivity()
      }
      if (managerEvent.event === 'manager_status' && isManagerRuntimeStatus(managerEvent.data))
        setManagerRuntimeStatus(managerEvent.data)
      if (
        managerEvent.event === 'manager_connected' || managerEvent.event === 'session_created'
        || managerEvent.event === 'session_exited' || managerEvent.event === 'session_reassigned'
      ) void refreshSessions()
      if (managerEvent.event === 'pi' && isObject(managerEvent.data)) {
        handleManagerPiEvent(
          managerEvent.sessionId,
          managerEvent.data,
          managerEvent.sequence,
        )
        // Sounds come only from this live stream: replayed events (reopening a session, catching
        // up after a reconnect) go through handleManagerPiEvent alone and stay silent.
        playEventSound(managerEvent.sessionId, managerEvent.data)
      }
    }, () => {
      resetEventSequence()
      setPiConnection('connecting')
      clearActivity()
      showToast('error', 'Connection to backend lost; retrying.')
    }), [
    clearActivity,
    clearManagerUnavailableToasts,
    handleManagerPiEvent,
    playEventSound,
    refreshSessions,
    resetEventSequence,
    showToast,
  ])

  // Selected session and loading state
  const selectedSession = sessions.find((session) => session.id === selectedId)
  const selectedSessionId = selectedSession?.id
  const selectedSessionStatus = selectedSession?.status
  const activeWorkspaceRows = useMemo(
    () =>
      groups.find((group) => group.path === workspacePath)?.sessions
        ?? groups[0]?.sessions
        ?? [],
    [groups, workspacePath],
  )
  const selectedRowIndex = activeWorkspaceRows.findIndex((row) =>
    row.id === selectedId || row.sessionPath === selectedSession?.sessionPath
  )

  /** Moves the selection inside the active workspace section. */
  const selectSiblingSession = useCallback((offset: number): void => {
    const index = selectedRowIndex === -1 && offset > 0 ? -1 : selectedRowIndex
    const target = activeWorkspaceRows[index + offset]
    if (!target) return
    void openSessionRow(target).catch((cause) => showToast('error', messageOf(cause)))
  }, [activeWorkspaceRows, openSessionRow, selectedRowIndex, showToast])
  const sessionIsLoading = Boolean(selectedSessionId && snapshotSessionId !== selectedSessionId)

  // Manages loading overlay fade-in / fade-out around snapshot refresh.
  useEffect(() => {
    window.clearTimeout(loadingTimerRef.current)
    if (!selectedSessionId) {
      setLoadingPhase('hidden')
      return
    }
    if (sessionIsLoading) {
      setLoadingPhase('entering')
      loadingTimerRef.current = window.setTimeout(() => setLoadingPhase('visible'), 200)
    } else {
      setLoadingPhase('exiting')
      loadingTimerRef.current = window.setTimeout(() => setLoadingPhase('hidden'), 200)
    }
    return () => window.clearTimeout(loadingTimerRef.current)
  }, [selectedSessionId, sessionIsLoading])

  const displayedActivity = selectedSession?.id && compactingSessionIds.has(selectedSession.id)
    ? { kind: 'compacting' as const }
    : selectedSession
    ? sessionActivity(activity, selectedSession.status, piConnection)
    : null

  // Composer and session lifecycle
  const handleConversationError = useCallback(
    (cause: unknown) => showToast('error', messageOf(cause)),
    [showToast],
  )
  const handleComposerAgentChange = useCallback(
    (agent: string) => activateAgent(selectedId, agent),
    [activateAgent, selectedId],
  )
  /** Executes a composer command and synchronizes capabilities affected by it. */
  const handleComposerCommand = useCallback(async (command: JsonObject) => {
    const result = await sendPiCommand(selectedId, command)
    await refreshSnapshot(selectedId)
    if (command.type === 'compact') showToast('notice', 'Session compacted.')
    return result
  }, [refreshSnapshot, selectedId, showToast])
  /** Sends the current draft with the behavior supported by the active session. */
  const handleComposerSend = useCallback(
    async (
      message: string,
      images: JsonObject[],
      behavior: 'steer' | 'followUp',
      isCommand: boolean,
    ) => {
      const command: JsonObject = { type: 'prompt', message, images }
      const isSteering = !isCommand && selectedSessionStatus === 'running' && behavior === 'steer'
      if (selectedSessionStatus === 'running') command.streamingBehavior = behavior
      if (isSteering) addPendingSteering(message)
      const optimisticId = !isSteering && !isCommand ? addOptimisticUserMessage(message) : undefined
      try {
        await sendPiCommand(selectedId, command)
        const sentSession = sessions.find((session) => session.id === selectedId)
        const shouldNameSession = !isCommand && sentSession?.name === 'New session'
          && !snapshot
            .messages
            .some((entry) => entry.role === 'user')
        if (sentSession && shouldNameSession) nameSessionFromFirstPrompt(sentSession, message)
        await refreshSessions()
        setScrollToBottomRequest((current) => current + 1)
      } catch (cause) {
        if (optimisticId) removeLiveMessage(optimisticId)
        if (isSteering) removePendingSteering(message)
        throw cause
      }
    },
    [
      addOptimisticUserMessage,
      addPendingSteering,
      nameSessionFromFirstPrompt,
      refreshSessions,
      removeLiveMessage,
      removePendingSteering,
      selectedId,
      selectedSessionStatus,
      sessions,
      snapshot.messages,
    ],
  )

  /** Forks before a user message, then sends that message again from the restored point. */
  const handleRewindConversation = useCallback(async (entryId: string): Promise<boolean> => {
    const response = await sendPiCommand(selectedId, { type: 'fork', entryId })
    const data = isObject(response.data) ? response.data : undefined
    if (data?.cancelled === true || typeof data?.text !== 'string' || !data.text.trim())
      return false
    await Promise.all([refreshSnapshot(selectedId), refreshSessions()])
    await handleComposerSend(data.text, [], 'followUp', false)
    return true
  }, [handleComposerSend, refreshSessions, refreshSnapshot, selectedId])
  const handleComposerAbort = useCallback(() => sendPiCommand(selectedId, { type: 'abort' }), [
    selectedId,
  ])
  const handleComposerSelectOpened = useCallback(() => setRequestedSelect(null), [])
  const analysisAvailable = selectedSession !== undefined
    && snapshotSessionId === selectedSession.id
  const sessionAnalysis = useMemo(() =>
    !analysisAvailable || activeRightWidget !== 'analysis'
      ? null
      : analyzeSession(snapshot.messages, snapshot.stats, selectedSession.status === 'running', {
        requestDurations: observedRequestDurations,
        toolDurations: observedToolDurations,
        toolExecutions,
      }), [
    activeRightWidget,
    analysisAvailable,
    observedRequestDurations,
    observedToolDurations,
    selectedSession,
    snapshot.messages,
    snapshot.stats,
    toolExecutions,
  ])
  const questionnaire = dialog && isAskUserQuestionDialog(dialog.request) ? dialog : null
  const questionnaireSession = questionnaire
    ? sessions.find((session) => session.id === questionnaire.sessionId)
    : undefined
  const questionnaireInComposer = questionnaire?.sessionId === selectedId
    && snapshotSessionId === selectedId
  const openQuestionnaireSession = questionnaireSession && questionnaireSession.id !== selectedId
    ? () => selectSession(questionnaireSession.id)
    : undefined

  const markComposerDraftApplied = useCallback((id: string) => {
    setComposerDraftRequest((current) => current?.id === id ? undefined : current)
  }, [])

  // Commands and keyboard shortcuts
  /** Executes a productivity command in the context of the active session. */
  const executeCommand = useCallback((id: CommandId): void => {
    const rightWidget = rightWidgetFromCommand(id)
    if (rightWidget) {
      if (
        (rightWidget === 'analysis' && !analysisAvailable)
        || (rightWidget === 'git' && !gitSnapshot?.repository)
      ) return
      openRightWidget(rightWidget)
      return
    }
    if (id === 'open-palette') {
      setCommandPaletteOpen(true)
      return
    }
    if (id === 'open-settings') {
      setSettingsInitialTab('themes')
      setSettingsOpen(true)
      return
    }
    if (id === 'open-terminal') {
      void openTerminal(workspacePath, terminalCommand).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
    if (id === 'new-session') {
      setNewSessionDialogOpen(true)
      return
    }
    if (id === 'send') {
      setSubmitRequest((current) => current + 1)
      return
    }
    if (id === 'abort' && selectedId) {
      void sendPiCommand(selectedId, { type: 'abort' }).catch((cause) =>
        showToast('error', messageOf(cause))
      )
      return
    }
    if (id === 'open-agent' || id === 'open-model' || id === 'open-thinking') {
      setRequestedSelect(id === 'open-agent' ? 'agent' : id === 'open-model' ? 'model' : 'thinking')
      return
    }
    if (id === 'copy-last-response') {
      const text = lastAssistantText(snapshot.messages)
      if (!text) {
        showToast('notice', 'No assistant response to copy.')
        return
      }
      void navigator
        .clipboard
        .writeText(text)
        .then(() => showToast('notice', 'Last response copied.'))
        .catch((cause) => showToast('error', messageOf(cause)))
      return
    }
    if (id === 'workspace-previous') {
      activatePreviousWorkspace()
      return
    }
    if (id === 'focus-composer') {
      setFocusComposerRequest((current) => current + 1)
      return
    }
    if (id === 'next-session' || id === 'previous-session') {
      selectSiblingSession(id === 'next-session' ? 1 : -1)
      return
    }
    if (id === 'toggle-conversation-view') {
      setConversationView((current) => {
        const next = nextConversationView(current)
        window.localStorage.setItem('pi-livecraft.conversation-view', next)
        return next
      })
      return
    }
    if (id === 'open-explorer') {
      void openExplorer(workspacePath).catch((cause) => showToast('error', messageOf(cause)))
      return
    }
  }, [
    activatePreviousWorkspace,
    gitSnapshot?.repository,
    openRightWidget,
    selectSiblingSession,
    selectedId,
    analysisAvailable,
    setNewSessionDialogOpen,
    showToast,
    snapshot.messages,
    terminalCommand,
    workspacePath,
  ])

  /**
   * Runs one of Pi's built-in terminal commands typed in the chatbox. Pi accepts these only in its TUI, so
   * each maps to the matching RPC command or to this app's own UI. Throwing puts the draft back.
   */
  const handleBuiltinCommand = useCallback(async (command: ParsedBuiltinCommand): Promise<void> => {
    if (command.kind === 'terminal-only') {
      showToast('notice', `/${command.name} only works in Pi's terminal. ${command.hint}`)
      return
    }
    const { args, name } = command
    const session = sessions.find((candidate) => candidate.id === selectedId)
    switch (name) {
      case 'model': {
        if (!args) {
          setRequestedSelect('model')
          return
        }
        const model = findModel(
          snapshot.models.flatMap((item) =>
            typeof item.provider === 'string' && typeof item.id === 'string'
              ? [{
                id: item.id,
                name: typeof item.name === 'string' ? item.name : undefined,
                provider: item.provider,
              }]
              : []
          ),
          args,
        )
        if (!model)
          throw new Error(`No single model matches “${args}”. Type /model to pick one.`)
        await handleComposerCommand({
          type: 'set_model',
          provider: model.provider,
          modelId: model.id,
        })
        showToast('notice', `Model set to ${model.name ?? model.id}.`)
        return
      }
      case 'thinking': {
        if (!args) {
          setRequestedSelect('thinking')
          return
        }
        await handleComposerCommand({ type: 'set_thinking_level', level: args.toLowerCase() })
        showToast('notice', `Thinking set to ${args.toLowerCase()}.`)
        return
      }
      case 'compact':
        await handleComposerCommand(
          args ? { type: 'compact', customInstructions: args } : { type: 'compact' },
        )
        return
      case 'new':
        setNewSessionDialogOpen(true)
        return
      case 'name':
        if (!args) {
          showToast('notice', `This session is called “${session?.name ?? 'New session'}”.`)
          return
        }
        if (!session) throw new Error('No session is selected.')
        await renameManagedSession(
          {
            cwd: session.cwd,
            name: session.name,
            sessionId: session.id,
            sessionPath: session.sessionPath,
          },
          args,
        )
        showToast('notice', `Session renamed to “${args}”.`)
        return
      case 'session': {
        const response = await sendPiCommand(selectedId, { type: 'get_session_stats' })
        const stats = isObject(response.data) ? response.data : {}
        showToast('notice', describeSessionStats(stats, session?.name ?? 'New session'))
        return
      }
      case 'fork': {
        const response = await sendPiCommand(selectedId, { type: 'get_fork_messages' })
        const messages = isObject(response.data) && Array.isArray(response.data.messages)
          ? response.data.messages.filter(isObject)
          : []
        const last = messages.at(-1)
        if (!last || typeof last.entryId !== 'string') {
          showToast('notice', 'There is no message to fork from yet.')
          return
        }
        if (await handleForkConversation(last.entryId))
          showToast('notice', 'Forked before your last message; it is back in the chatbox.')
        return
      }
      case 'copy':
        executeCommand('copy-last-response')
        return
      case 'export': {
        if (args && !/\.html?$/i.test(args))
          throw new Error('Only HTML export is available here; give a path ending in .html.')
        const response = await sendPiCommand(
          selectedId,
          args ? { type: 'export_html', outputPath: args } : { type: 'export_html' },
        )
        const path = isObject(response.data) ? response.data.path : undefined
        showToast('notice', typeof path === 'string' ? `Exported to ${path}` : 'Session exported.')
        return
      }
      case 'reload': {
        if (!session) throw new Error('No session is selected.')
        if (session.status === 'running') throw new Error('Wait for Pi to finish before reloading.')
        await reloadManagedSession(session.id)
        showToast(
          'notice',
          'Pi restarted for this session; extensions, skills and prompts are reloaded.',
        )
        return
      }
      case 'settings':
      case 'hotkeys':
        setSettingsInitialTab(name === 'hotkeys' ? 'shortcuts' : 'themes')
        setSettingsOpen(true)
        return
    }
  }, [
    executeCommand,
    handleComposerCommand,
    handleForkConversation,
    reloadManagedSession,
    renameManagedSession,
    selectedId,
    sessions,
    setNewSessionDialogOpen,
    showToast,
    snapshot.models,
  ])

  /** Why the sidebar's Reload button cannot run /reload right now; undefined when it can. */
  const reloadUnavailable = (() => {
    const session = sessions.find((candidate) => candidate.id === selectedId)
    if (!session || session.status === 'exited') return 'Open a session to reload Pi for it'
    if (session.status === 'running') return 'Wait for Pi to finish before reloading'
    if (!session.sessionPath) return 'This session has nothing saved to reload yet'
    return undefined
  })()

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const selectedIndex = selectedRowIndex
    const rowCount = activeWorkspaceRows.length
    return commandDefinitions.map((definition) => {
      const rightWidget = rightWidgetFromCommand(definition.id)
      const unavailableWidget = (rightWidget === 'analysis' && !analysisAvailable)
        || (rightWidget === 'git' && !gitSnapshot?.repository)
      return {
        ...definition,
        shortcut: shortcuts[definition.id],
        disabled: unavailableWidget
          || ([
              'send',
              'abort',
              'open-thinking',
              'open-model',
              'open-agent',
              'copy-last-response',
            ] as CommandId[])
              .includes(definition.id) && !selectedSession
          || (definition.id === 'abort' && selectedSession?.status !== 'running')
          || (definition.id === 'workspace-previous'
            && (!workspacePath
              || !groups.some((group) =>
                group.path !== workspacePath && group.sessions.length > 0
              )))
          || (definition.id === 'next-session' && selectedIndex >= rowCount - 1)
          || (definition.id === 'previous-session' && selectedIndex <= 0),
        onExecute: () => executeCommand(definition.id),
      }
    })
  }, [
    activeWorkspaceRows.length,
    executeCommand,
    gitSnapshot?.repository,
    groups,
    selectedRowIndex,
    selectedSession,
    analysisAvailable,
    shortcuts,
    workspacePath,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement && (target
          .isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        && event.key !== 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey
      ) return
      const shortcut = shortcutFromEvent(event)
      const command = (Object.entries(shortcuts) as [CommandId, string | undefined][])
        .find(([, value]) => value === shortcut)
        ?.[0]
      if (!command) return
      if (
        event.key === 'Escape' && (commandPaletteOpen || settingsOpen || dialog || document
          .querySelector(
            '[aria-modal="true"],.composer-select-content,[data-radix-select-content],.slash-commands',
          ))
      ) return
      event.preventDefault()
      executeCommand(command)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, dialog, executeCommand, settingsOpen, shortcuts])

  /** Positions the conversation on the element chosen from session analysis. */
  const navigateToAnalysisTarget = useCallback((target: SessionAnalysisTarget): void => {
    if (target.kind === 'tool' || target.kind === 'turn') {
      setConversationView('detailed')
      window.localStorage.setItem('pi-livecraft.conversation-view', 'detailed')
    }
    setConversationNavigation((current) => ({ id: (current?.id ?? 0) + 1, target }))
  }, [])

  // Right sidebar composition
  /** Actions pinned to the right rail without an associated panel. */
  const railActions = useMemo(() => [
    {
      key: 'explorer',
      icon: (
        <svg aria-hidden='true' viewBox='0 0 24 24' width='18' height='18'>
          <path
            d='M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='1.8'
          />
          <path
            d='M3 9h18'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='1.8'
          />
        </svg>
      ),
      label: 'Open folder',
      onClick: () => {
        void openExplorer(workspacePath).catch((cause) => showToast('error', messageOf(cause)))
      },
    },
  ], [showToast, workspacePath])

  // Application layout
  const rightPanelVisible = activeRightWidget === 'todo'
    || (activeRightWidget === 'analysis' && sessionAnalysis !== null)
    || (activeRightWidget === 'git' && gitSnapshot?.repository === true)
  const conversationShown = selectedSession !== undefined
    && (snapshotSessionId === selectedSession.id || loadingPhase === 'exiting')
  const expandRightSidebarButton = rightSidebarHidden && (
    <Tooltip label='Show tools sidebar'>
      <button
        aria-expanded={false}
        aria-label='Show tools sidebar'
        className={`right-sidebar-expand${conversationShown ? '' : ' floating'}`}
        onClick={() => setRightSidebarHiddenPreference(false)}
        type='button'
      >
        <PanelIcon side='right' />
      </button>
    </Tooltip>
  )
  const messageNavigatorLabel = messageNavigatorOpen ? 'Hide your messages' : 'Show your messages'
  const messageNavigatorButton = (
    <Tooltip label={messageNavigatorLabel}>
      <button
        aria-label={messageNavigatorLabel}
        aria-pressed={messageNavigatorOpen}
        className='session-top-bar-button'
        data-message-navigator-toggle
        onClick={() => setMessageNavigatorOpen((open) => !open)}
        type='button'
      >
        <svg aria-hidden='true' viewBox='0 0 24 24'>
          <path d='M4 5.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3.5 3v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z' />
          <path d='M20 9.5h.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H20v2.5L17 17.5h-4' />
          <path d='M6 9h7M6 11.5h4.5' />
        </svg>
      </button>
    </Tooltip>
  )

  return (
    <div
      className={`app-shell ${workspaceSidebarCollapsed ? 'workspace-sidebar-collapsed ' : ''}${
        rightSidebarHidden
          ? ''
          : rightPanelVisible
          ? 'right-sidebar-visible'
          : 'right-sidebar-collapsed'
      }`}
      style={{
        '--right-sidebar-width': `${rightSidebarWidth}px`,
        '--workspace-sidebar-width': `${workspaceSidebarWidth}px`,
      } as CSSProperties}
    >
      <WorkspaceSidebar
        bannerImage={sidebarBanner}
        collapsed={workspaceSidebarCollapsed}
        onChangeBanner={() => {
          setSettingsInitialTab('sidebar')
          setSettingsOpen(true)
        }}
        onReload={() => handleBuiltinCommand({ kind: 'run', name: 'reload', args: '' })}
        reloadUnavailable={reloadUnavailable}
        collapsedWorkspacePaths={collapsedWorkspacePaths}
        compactingSessionIds={compactingSessionIds}
        completedSessionIds={completedSessionIds}
        groups={groups}
        isRefreshing={isRefreshingSessions}
        sessions={sessions}
        selectedId={selectedId}
        width={workspaceSidebarWidth}
        onAddWorkspace={addWorkspacePath}
        onArchiveSession={archiveManagedSession}
        onCloseSession={closeManagedSession}
        onDeleteSession={deleteManagedSession}
        onDeleteWorkspace={deleteWorkspace}
        onRenameWorkspace={renameWorkspace}
        onUnarchiveSession={unarchiveSession}
        onCreateInWorkspace={(path) => createSessionInWorkspace(path).then(() => undefined)}
        onNewProject={() => {
          setNewSessionDialogMode('project')
          setNewSessionDialogOpen(true)
        }}
        onNewSession={() => {
          setNewSessionDialogMode('session')
          setNewSessionDialogOpen(true)
        }}
        onOpenSession={openSessionRow}
        onSetWorkspacesCollapsed={setWorkspacesCollapsed}
        onError={(cause) => showToast('error', messageOf(cause))}
        onOpenSettings={() => setSettingsOpen(true)}
        onRenameSession={renameManagedSession}
        onToggleWorkspaceCollapsed={toggleWorkspaceCollapsed}
        onResize={updateWorkspaceSidebarWidth}
        onToggleCollapsed={toggleWorkspaceSidebar}
      />

      <main className={`workspace${conversationShown ? ' has-top-bar' : ''}`}>
        {!conversationShown && expandRightSidebarButton}
        <ManagerRuntimeNotice
          activeSession={sessions.some(({ status }) =>
            status === 'running' || status === 'starting'
          )}
          status={managerRuntimeStatus}
          onError={(cause) => showToast('error', messageOf(cause))}
          onRestart={restartManager}
        />
        {selectedSession
          ? (
            <>
              {conversationShown && (
                <>
                  <SessionTopBar
                    actions={
                      <>
                        {messageNavigatorButton}
                        {expandRightSidebarButton}
                      </>
                    }
                    compacting={displayedActivity?.kind === 'compacting'}
                    running={selectedSession.status === 'running'}
                    session={selectedSession}
                  />
                  <Conversation
                    activity={displayedActivity}
                    agentName={selectedSession.activeAgent}
                    conversationView={conversationView}
                    key={selectedSession.id}
                    liveMessages={liveMessages}
                    messages={snapshot.messages}
                    navigationRequest={conversationNavigation}
                    messageNavigatorOpen={messageNavigatorOpen}
                    onMessageNavigatorClose={closeMessageNavigator}
                    onError={handleConversationError}
                    onFork={handleForkConversation}
                    onRewind={handleRewindConversation}
                    pendingSteering={pendingSteering}
                    repositoryRoot={gitSnapshot?.root}
                    scrollToBottomRequest={scrollToBottomRequest}
                    workingDirectory={selectedSession.cwd}
                    toolDurations={observedToolDurations}
                    toolExecutions={toolExecutions}
                  />
                  <div className='composer-area'>
                    {/* A finished plan stops tracking as soon as Pi settles its turn. */}
                    {plan && (selectedSession.status === 'running' || !plan.complete) && (
                      <PlanPanel
                        key={selectedSession.id}
                        plan={plan}
                        running={selectedSession.status === 'running'}
                        sessionId={selectedSession.id}
                      />
                    )}
                    {questionnaire && questionnaireInComposer && (
                      <AskUserQuestionDialog
                        canMinimize
                        dialog={questionnaire}
                        key={String(
                          questionnaire
                            .request
                            .id,
                        )}
                        sessionName={selectedSession.name}
                        onClose={() => closeDialog(questionnaire)}
                        onError={(cause) => showToast('error', messageOf(cause))}
                      />
                    )}
                    <ToastStack onDismiss={dismissToast} toasts={visibleToasts} />
                    <Composer
                      key={selectedSession.id}
                      session={selectedSession}
                      snapshot={snapshot}
                      agentBusy={Boolean(agentBusy[selectedSession.id])}
                      agentOptions={agentOptions[selectedSession.id] ?? emptyAgentOptions}
                      agentOptionsLoading={Boolean(agentOptionsLoading[selectedSession.id])}
                      selectedAgent={selectedSession.activeAgent ?? ''}
                      onAgentChange={handleComposerAgentChange}
                      onRequestAgentOptions={() => fetchAgentOptions(selectedSession.id)}
                      onCommand={handleComposerCommand}
                      onBuiltinCommand={handleBuiltinCommand}
                      commands={snapshot.commands}
                      agentLoading={snapshotSessionId !== selectedSession.id}
                      focusRequest={focusComposerRequest}
                      draftRequest={composerDraftRequest?.sessionId === selectedSession.id
                        ? composerDraftRequest
                        : undefined}
                      onDraftApplied={markComposerDraftApplied}
                      replyFailure={replyFailures[selectedSession.id]}
                      onDismissReplyFailure={() => dismissReplyFailure(selectedSession.id)}
                      showAgentSelector={snapshotSessionId !== selectedSession.id
                        || snapshot.commands.some((command) => command.name === 'agent')}
                      running={selectedSession.status === 'running'}
                      onSend={handleComposerSend}
                      onAbort={handleComposerAbort}
                      onError={handleConversationError}
                      requestedSelect={requestedSelect}
                      onSelectOpened={handleComposerSelectOpened}
                      submitRequest={submitRequest}
                    />
                  </div>
                </>
              )}
              {loadingPhase !== 'hidden' && (
                <>
                  <section
                    aria-busy={loadingPhase !== 'exiting' ? true : undefined}
                    aria-live={loadingPhase !== 'exiting' ? 'polite' : undefined}
                    className={`welcome session-loading session-loading-${loadingPhase}`}
                  >
                    <WelcomeBanner floating />
                    <h1>Connecting to Pi…</h1>
                    <p>Loading the session and its capabilities.</p>
                    <span aria-hidden='true' className='session-loading-indicator' />
                  </section>
                  {loadingPhase !== 'exiting' && (
                    <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
                  )}
                </>
              )}
            </>
          )
          : creatingSession
          ? (
            <>
              <section className='welcome' aria-busy='true'>
                <WelcomeBanner floating />
                <h1>Starting new session…</h1>
                <p>Initializing Pi and its agents.</p>
                <span aria-hidden='true' className='session-loading-indicator' />
              </section>
              <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
            </>
          )
          : (
            <>
              <section className='welcome'>
                <WelcomeBanner />
                <h1>Your personal AI in a browser.</h1>
                <p>Start a session or open one from your projects.</p>
                <button
                  className='welcome-action'
                  onClick={() => setNewSessionDialogOpen(true)}
                  type='button'
                >
                  ＋ New session
                </button>
              </section>
              <ToastStack onDismiss={dismissToast} standalone toasts={visibleToasts} />
            </>
          )}
      </main>

      {!rightSidebarHidden && (
        <RightSidebar
          activeSessionId={selectedId}
          conversationView={conversationShown ? conversationView : undefined}
          onCollapse={() => setRightSidebarHiddenPreference(true)}
          onConversationViewChange={selectConversationView}
          activeWidget={activeRightWidget}
          analysis={sessionAnalysis}
          analysisAvailable={analysisAvailable}
          compactingSessionIds={compactingSessionIds}
          completedSessionIds={completedSessionIds}
          onAnalysisNavigate={navigateToAnalysisTarget}
          onResize={updateRightSidebarWidth}
          snapshot={gitSnapshot?.repository ? gitSnapshot : null}
          sessions={sessions}
          width={rightSidebarWidth}
          workspacePath={workspacePath}
          railActions={railActions}
          onCommit={async (message) => {
            await commitChanges(workspacePath, message)
          }}
          onDiscard={async (path) => {
            await discardChanges(workspacePath, path)
          }}
          onPush={() => pushCommits(workspacePath)}
          onFileSelect={(path, commitHash) => getGitFileDiff(workspacePath, path, commitHash)}
          onRefresh={() => refreshGit(workspacePath, true)}
          onReset={async (hash) => {
            return await resetGitCommit(workspacePath, hash)
          }}
          onRevert={async (hash) => {
            return await revertGitCommit(workspacePath, hash)
          }}
          onTodoNavigateSession={(link) => {
            const active = sessions.find((session) =>
              session.status !== 'exited'
              && (session.id === link.id || session.sessionPath === link.sessionPath)
            )
            if (active) {
              selectSession(active.id)
            } else {
              const savedRow = groups.flatMap((group) => group.sessions).find((session) =>
                session.sessionPath === link.sessionPath
              )
              void openSessionRow(
                savedRow ?? {
                  cwd: link.cwd || workspacePath,
                  id: link.id,
                  name: link.name,
                  sessionPath: link.sessionPath,
                  updatedAt: Date.now(),
                },
              )
                .catch((cause) => showToast('error', messageOf(cause)))
            }
          }}
          onTodoSendPrompt={(message) =>
            createSessionInWorkspace(workspacePath, { initialMessage: message })}
          onTodoStartSession={(message) =>
            createSessionInWorkspace(workspacePath, { draftMessage: message })}
          onWidgetSelect={(widget) =>
            setActiveRightWidget((current) => {
              const next = current === widget ? null : widget
              window.localStorage.setItem('pi-livecraft.right-sidebar-widget', next ?? 'none')
              return next
            })}
        />
      )}

      {newSessionDialogOpen && (
        <NewSessionDialog
          mode={newSessionDialogMode}
          projects={groups}
          onClose={() => setNewSessionDialogOpen(false)}
          onError={(cause) => showToast('error', messageOf(cause))}
          onCreate={async (path, name) => {
            const session = await createSessionInWorkspace(path, {
              projectName: path ? undefined : name || 'General',
              reportErrorInDialog: true,
              revealSection: true,
            })
            if (!session)
              throw new Error('Session could not be started. Check the project name and folder.')
            if (path && name) renameWorkspace(session.cwd, name)
            setNewSessionDialogOpen(false)
          }}
        />
      )}
      {questionnaire && !questionnaireInComposer && (
        <AskUserQuestionDialog
          canMinimize={false}
          key={String(
            questionnaire
              .request
              .id,
          )}
          dialog={questionnaire}
          sessionName={questionnaireSession?.name}
          onClose={() => closeDialog(questionnaire)}
          onError={(cause) => showToast('error', messageOf(cause))}
          onOpenSession={openQuestionnaireSession}
        />
      )}
      {dialog && !questionnaire && (
        <ExtensionDialog
          dialog={dialog}
          onClose={() => closeDialog(dialog)}
          onError={(cause) => showToast('error', messageOf(cause))}
        />
      )}
      {commandPaletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          initialTab={settingsInitialTab}
          definitions={commandDefinitions}
          shortcuts={shortcuts}
          terminalCommand={terminalCommand}
          fontSizes={fontSizes}
          notificationSounds={notificationSounds}
          onNotificationSoundsChange={(preferences) => {
            setNotificationSounds(preferences)
            storeNotificationSounds(preferences)
          }}
          bannerImage={sidebarBanner}
          onBannerChange={(image) => {
            storeSidebarBanner(image)
            setSidebarBanner(image)
          }}
          onFontSizesChange={(sizes) => {
            setFontSizes(sizes)
            storeFontSizes(sizes)
          }}
          themes={allThemes(themePreferences)}
          activeThemeId={activeTheme.id}
          onChange={(id, shortcut) => {
            const next = { ...shortcuts, [id]: shortcut }
            setShortcuts(next)
            window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(next))
          }}
          onTerminalCommandChange={(value) => {
            setTerminalCommand(value)
            window.localStorage.setItem('pi-livecraft.terminal-command', value)
          }}
          onSelectTheme={selectTheme}
          onDuplicateTheme={duplicateActiveTheme}
          onRenameTheme={renameSelectedTheme}
          onUpdateThemeColor={updateSelectedThemeColor}
          onDeleteTheme={deleteSelectedTheme}
          onResetTheme={resetSelectedTheme}
          onReset={() => {
            setShortcuts(defaultShortcuts)
            window.localStorage.setItem('pi-livecraft.shortcuts', JSON.stringify(defaultShortcuts))
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

/** Lit une éventuelle ancienne liste invalide sans empêcher l'ouverture de l'application. */
function readShortcuts(): Partial<Record<CommandId, string>> {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem('pi-livecraft.shortcuts') ?? 'null',
    )
    if (!isObject(value)) return defaultShortcuts
    const primaryModifier = navigator.platform.toLowerCase().includes('mac') ? 'meta' : 'ctrl'
    const stored = Object
      .entries(value)
      .filter(([key, shortcut]) =>
        key !== 'send' && commandDefinitions.some((definition) => definition.id === key)
        && typeof shortcut === 'string'
      )
      .map(([key, shortcut]) => [key, migrateLegacyShortcut(shortcut as string, primaryModifier)])
    return { ...defaultShortcuts, ...Object.fromEntries(stored) } as Partial<
      Record<CommandId, string>
    >
  } catch {
    return defaultShortcuts
  }
}

function readTerminalCommand(): string {
  const stored = window.localStorage.getItem('pi-livecraft.terminal-command')
  return stored && stored.trim() && stored.includes('{cwd}') ? stored : ''
}

/** Restores the last-selected right sidebar widget, falling back to git when not collapsed. */
function readActiveRightWidget(): RightWidget | null {
  const stored = window.localStorage.getItem('pi-livecraft.right-sidebar-widget')
  if (isRightWidget(stored)) return stored
  if (stored === 'none') return null
  return window.localStorage.getItem('pi-livecraft.git-sidebar-collapsed') === 'true' ? null : 'git'
}

function isManagerRuntimeStatus(value: unknown): value is ManagerRuntimeStatus {
  if (!isObject(value) || typeof value.canRestart !== 'boolean' || typeof value.state !== 'string')
    return false
  return value.state === 'checking' || value.state === 'current' || value.state === 'stale' || value
        .state === 'restarting'
    || value.state === 'disconnected' || value.state === 'unknown'
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default App
