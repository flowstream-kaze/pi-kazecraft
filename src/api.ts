import type { ReadAloudVoice } from '../shared/read-aloud-voices.ts'
import type {
  DirectoryListing,
  DirectoryPickResult,
  GitFileDiff,
  GitPushResult,
  GitResetResult,
  GitRevertResult,
  GitSnapshot,
  JsonObject,
  ManagerEvent,
  RecentSession,
  SessionSnapshot,
  SessionSummary,
  TodoItem,
  WorkspaceFile,
} from '../shared/types.ts'
import { isObject } from '../shared/is-object.ts'

const managerEventNames: readonly ManagerEvent['event'][] = [
  'session_created',
  'session_exited',
  'session_reassigned',
  'manager_connected',
  'manager_disconnected',
  'manager_status',
  'pi',
]

/** Parses and validates an event received from the backend SSE boundary. */
export function parseManagerEvent(data: string): ManagerEvent | null {
  try {
    const value: unknown = JSON.parse(data)
    if (
      !isObject(value) || value.kind !== 'event' || typeof value.event !== 'string'
      || typeof value.sessionId !== 'string'
    ) return null
    if (!managerEventNames.includes(value.event as ManagerEvent['event'])) return null
    if (
      value.sequence !== undefined
      && (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0)
    ) return null
    return value as unknown as ManagerEvent
  } catch {
    return null
  }
}

/** Subscribes to validated manager events while preserving EventSource reconnection. */
export function subscribeManagerEvents(
  onEvent: (event: ManagerEvent) => void,
  onError: () => void,
): () => void {
  const source = new EventSource('/api/events')
  source.onmessage = ({ data }) => {
    const event = parseManagerEvent(data)
    if (event) onEvent(event)
  }
  source.onerror = onError
  return () => source.close()
}

export async function listSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('/api/sessions')
}

export async function restartManager(): Promise<void> {
  await request<void>('/api/manager/restart', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/** Lists resumable sessions from every workspace; each result carries its own `cwd`. */
export async function listRecentSessions(): Promise<RecentSession[]> {
  return request<RecentSession[]>('/api/sessions/recent')
}

export async function listDirectories(path: string): Promise<DirectoryListing> {
  return request<DirectoryListing>(`/api/directories?path=${encodeURIComponent(path)}`)
}

/** Opens the host's native folder dialog, starting near the current workspace when provided. */
export async function pickDirectory(cwd?: string): Promise<DirectoryPickResult> {
  return request<DirectoryPickResult>('/api/directories/pick', {
    method: 'POST',
    body: JSON.stringify({ cwd }),
  })
}

export type ModelSwitchStatus =
  | { managed: false }
  | { managed: true; state: 'ready' | 'starting' | 'stopping' | 'unloaded'; busy: boolean }

/** Where a model stands in llama-swap; `managed: false` when its server loads nothing on demand. */
export async function getModelSwitchStatus(
  provider: string,
  model: string,
): Promise<ModelSwitchStatus> {
  const query = `provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`
  return request<ModelSwitchStatus>(`/api/model-switch?${query}`)
}

/** Starts loading a model in llama-swap without sending it a message. */
export async function preloadModel(provider: string, model: string): Promise<void> {
  await request<{ managed: boolean }>('/api/model-switch/preload', {
    method: 'POST',
    body: JSON.stringify({ provider, model }),
  })
}

/** Saves a document into the workspace's attachment folder and returns where it was saved. */
export async function uploadAttachment(cwd: string, file: File): Promise<string> {
  const query = `cwd=${encodeURIComponent(cwd)}&name=${encodeURIComponent(file.name)}`
  const { path } = await request<{ path: string }>(`/api/attachments?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  return path
}

export async function openExplorer(cwd: string): Promise<void> {
  await request<void>('/api/explorer', {
    method: 'POST',
    body: JSON.stringify({ cwd }),
  })
}

export async function getGitSnapshot(cwd: string): Promise<GitSnapshot> {
  return request<GitSnapshot>(`/api/git?cwd=${encodeURIComponent(cwd)}`)
}

export async function getGitFileDiff(
  cwd: string,
  path: string,
  commitHash?: string,
): Promise<GitFileDiff> {
  const commit = commitHash ? `&commit=${encodeURIComponent(commitHash)}` : ''
  return request<GitFileDiff>(
    `/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}${commit}`,
  )
}

export async function getWorkspaceFile(cwd: string, path: string): Promise<WorkspaceFile> {
  return request<WorkspaceFile>(
    `/api/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
  )
}

/** Which of the names a reply mentions are existing files, with their full paths. */
export async function findMentionedFiles(
  cwd: string,
  mentions: string[],
): Promise<{ text: string; path: string }[]> {
  const result = await request<{ files: { text: string; path: string }[] }>(
    '/api/files/mentions',
    { method: 'POST', body: JSON.stringify({ cwd, mentions }) },
  )
  return result.files
}

/** Opens File Explorer on the folder holding a file, with the file selected. */
export async function revealWorkspaceFile(cwd: string, path: string): Promise<void> {
  await request<void>('/api/files/reveal', {
    method: 'POST',
    body: JSON.stringify({ cwd, path }),
  })
}

export async function openWorkspaceFile(cwd: string, path: string): Promise<void> {
  await request<void>('/api/files/open', {
    method: 'POST',
    body: JSON.stringify({ cwd, path }),
  })
}

export async function getWorkspaceFilePath(
  cwd: string,
  path: string,
): Promise<{ absolutePath: string; path: string }> {
  return request<{ absolutePath: string; path: string }>(
    `/api/files/path?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
  )
}

export async function getTodos(cwd: string): Promise<TodoItem[]> {
  return request<TodoItem[]>(`/api/todos?cwd=${encodeURIComponent(cwd)}`)
}

export async function updateTodos(cwd: string, todos: TodoItem[]): Promise<TodoItem[]> {
  return request<TodoItem[]>('/api/todos', {
    method: 'PUT',
    body: JSON.stringify({ cwd, todos }),
  })
}

export async function openTerminal(cwd: string, template: string): Promise<void> {
  await request<void>('/api/terminal', {
    method: 'POST',
    body: JSON.stringify({ cwd, template }),
  })
}

export async function commitChanges(cwd: string, message: string): Promise<void> {
  await request<void>('/api/git/commit', {
    method: 'POST',
    body: JSON.stringify({ cwd, message }),
  })
}

export async function pushCommits(cwd: string): Promise<GitPushResult> {
  return request<GitPushResult>('/api/git/push', {
    method: 'POST',
    body: JSON.stringify({ cwd }),
  })
}

export async function discardChanges(cwd: string, path?: string): Promise<void> {
  await request<void>('/api/git/discard', {
    method: 'POST',
    body: JSON.stringify({ cwd, path }),
  })
}

export async function resetGitCommit(cwd: string, hash: string): Promise<GitResetResult> {
  return request<GitResetResult>('/api/git/reset', {
    method: 'POST',
    body: JSON.stringify({ cwd, hash }),
  })
}

export async function revertGitCommit(cwd: string, hash: string): Promise<GitRevertResult> {
  return request<GitRevertResult>('/api/git/revert', {
    method: 'POST',
    body: JSON.stringify({ cwd, hash }),
  })
}

export async function createSession(cwd: string, projectName?: string): Promise<SessionSummary> {
  return request<SessionSummary>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(projectName === undefined ? { cwd } : { projectName }),
  })
}

export async function openSession(cwd: string, sessionPath: string): Promise<SessionSummary> {
  return request<SessionSummary>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ cwd, sessionPath }),
  })
}

export async function closeSession(sessionId: string): Promise<void> {
  await request<void>(`/api/sessions/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function renameSession(
  cwd: string,
  sessionPath: string,
  name: string,
): Promise<void> {
  await request<void>('/api/sessions/rename', {
    method: 'POST',
    body: JSON.stringify({ cwd, name, sessionPath }),
  })
}

/** Permanently deletes a closed session's history file. */
export async function deleteSession(cwd: string, sessionPath: string): Promise<void> {
  await request<void>('/api/sessions/delete', {
    method: 'POST',
    body: JSON.stringify({ cwd, sessionPath }),
  })
}

/** The agent's global memory and skills, for Settings → Memory. */
export interface AgentMemory {
  path: string
  content: string
  /** The starting text offered for an empty memory. */
  template: string
  skillsPath: string
  skills: { name: string; description: string; path: string }[]
}

export async function getAgentMemory(): Promise<AgentMemory> {
  return request('/api/memory')
}

export async function saveAgentMemory(content: string): Promise<void> {
  await request('/api/memory', { method: 'PUT', body: JSON.stringify({ content }) })
}

/** A model Pi knows, as Settings → Models shows it. */
export interface CatalogModel {
  provider: string
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  images: boolean
  reasoning: boolean
  /** Whether llama-swap has it loaded right now (managed: false when it is not behind llama-swap). */
  swap: ModelSwitchStatus
}

export async function listModelCatalog(): Promise<{
  models: CatalogModel[]
  defaultModel: { provider: string; id: string } | null
}> {
  return request('/api/models')
}

/** Makes a model the one new Pi sessions start with. */
export async function setDefaultModel(provider: string, model: string): Promise<void> {
  await request('/api/models/default', {
    method: 'POST',
    body: JSON.stringify({ provider, model }),
  })
}

/** The folder new named projects are created in, and the host's path separator. */
export async function getProjectsRoot(): Promise<{ path: string; separator: string }> {
  return request('/api/projects/root')
}

/** What deleting a project removes: its saved sessions, and whether its folder may be recycled. */
export interface ProjectDeleteInfo {
  sessionCount: number
  folderDeletable: boolean
  /** The folder no longer exists; only the sidebar entry is left. */
  missing?: boolean
}

export async function getProjectDeleteInfo(cwd: string): Promise<ProjectDeleteInfo> {
  return request<ProjectDeleteInfo>(`/api/projects/delete-info?cwd=${encodeURIComponent(cwd)}`)
}

export async function deleteProject(
  cwd: string,
  deleteFolder: boolean,
): Promise<{ deletedSessions: number; folderRecycled: boolean }> {
  return request('/api/projects/delete', {
    method: 'POST',
    body: JSON.stringify({ cwd, deleteFolder }),
  })
}

export async function getSnapshot(sessionId: string): Promise<SessionSnapshot> {
  return request<SessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}/snapshot`)
}

/** Configuration for an isolated Pi prompt execution. */
export interface RunPromptOptions {
  prompt: string
  systemPrompt?: string
  thinkingLevel?: string
  model?: { provider: string; modelId: string }
  extensions?: string[]
  tools?: string[]
  /** Disable automatic AGENTS.md/CLAUDE.md loading (default true). Set false to provide your own context. */
  includeContextFiles?: boolean
}

/** Runs a prompt in an isolated Pi process with caller-controlled configuration. */
export async function runPrompt(sessionId: string, options: RunPromptOptions): Promise<string> {
  const result = await request<{ text: string }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/run-prompt`,
    {
      method: 'POST',
      body: JSON.stringify(options),
    },
  )
  return result.text
}

export async function sendPiCommand(sessionId: string, command: JsonObject): Promise<JsonObject> {
  return request<JsonObject>(`/api/sessions/${encodeURIComponent(sessionId)}/commands`, {
    method: 'POST',
    body: JSON.stringify(command),
  })
}

export async function readAloudAudio(
  text: string,
  signal: AbortSignal,
  voice: ReadAloudVoice,
): Promise<ArrayBuffer> {
  const response = await fetch('/api/read-aloud', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  })
  if (!response.ok) {
    const value: unknown = await response.json()
    throw new Error(
      isObject(value) && typeof value.error === 'string'
        ? value.error
        : 'Read aloud could not read this passage',
    )
  }
  return response.arrayBuffer()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: typeof init?.body === 'string'
      ? { 'Content-Type': 'application/json', ...init.headers }
      : init?.headers,
  })
  const value: unknown = await response.json()
  if (!response.ok) {
    const message = isObject(value) && typeof value.error === 'string'
      ? value.error
      : `Request failed (${response.status})`
    throw new Error(message)
  }
  return value as T
}
