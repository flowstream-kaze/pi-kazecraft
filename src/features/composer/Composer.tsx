import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
} from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { JsonObject, SessionSnapshot, SessionSummary } from '../../../shared/types.ts'
import {
  attachmentAccept,
  isDocumentAttachment,
  isImageAttachment,
  maxAttachmentBytes,
  messageWithAttachments,
} from '../../../shared/attachments.ts'
import { uploadAttachment } from '../../api.ts'
import { ContextChip } from './ContextChip.tsx'
import { ModelSwitchNotice } from './ModelSwitchNotice.tsx'
import { ReplyFailureNotice } from './ReplyFailureNotice.tsx'
import type { ReplyFailure } from '../conversation/reply-failure.ts'
import { useModelSwitch } from './useModelSwitch.ts'
import { maxComposerImages, prepareComposerImage, type ComposerImage } from './composer-images.ts'
import {
  parseBuiltinCommand,
  slashMenuCommands,
  type ParsedBuiltinCommand,
} from './builtin-commands.ts'
import { isCommandDraft, isObject, readComposerDraft } from './composer-utils.ts'
import { AgentSelect } from './selects/AgentSelect.tsx'
import { BehaviorSelect } from './selects/BehaviorSelect.tsx'
import { ModelSelect } from './selects/ModelSelect.tsx'
import { ThinkingSelect } from './selects/ThinkingSelect.tsx'
import { VoiceSelect } from './selects/VoiceSelect.tsx'

/** Provides user input and session commands while reflecting the current Pi state. */
export const Composer = memo(function Composer({
  session,
  snapshot,
  agentBusy,
  agentOptions,
  agentOptionsLoading,
  selectedAgent,
  agentLoading,
  showAgentSelector,
  onAgentChange,
  onRequestAgentOptions,
  onCommand,
  onBuiltinCommand,
  commands,
  running,
  onSend,
  onAbort,
  onError,
  requestedSelect,
  onSelectOpened,
  submitRequest = 0,
  focusRequest,
  draftRequest,
  onDraftApplied,
  replyFailure,
  onDismissReplyFailure,
}: {
  session: SessionSummary
  snapshot: SessionSnapshot
  agentBusy: boolean
  agentOptions: string[]
  agentOptionsLoading: boolean
  selectedAgent: string
  agentLoading: boolean
  showAgentSelector: boolean
  onAgentChange: (agent: string) => void
  onRequestAgentOptions: () => void
  onCommand: (command: JsonObject) => Promise<JsonObject>
  /** Runs one of Pi's built-in terminal commands, which Pi does not accept over RPC. */
  onBuiltinCommand: (command: ParsedBuiltinCommand) => Promise<void>
  commands: JsonObject[]
  running: boolean
  onSend: (
    message: string,
    images: JsonObject[],
    behavior: 'steer' | 'followUp',
    isCommand: boolean,
  ) => Promise<void>
  onAbort: () => Promise<JsonObject>
  onError: (cause: unknown) => void
  requestedSelect?: 'agent' | 'model' | 'thinking' | null
  onSelectOpened?: () => void
  submitRequest?: number
  focusRequest?: number
  draftRequest?: { id: string; message: string }
  onDraftApplied?: (id: string) => void
  /** Why the last message got no reply, if it did not. */
  replyFailure?: ReplyFailure
  onDismissReplyFailure?: () => void
}) {
  const draftStorageKey = `pi-kazecraft.composer-draft.${session.id}`
  const [message, setMessage] = useState(() => readComposerDraft(draftStorageKey))
  const [images, setImages] = useState<ComposerImage[]>([])
  const [preparingImages, setPreparingImages] = useState(false)
  /** Documents already saved in the session folder; the message names their paths when sent. */
  const [documents, setDocuments] = useState<{ id: string; name: string; path: string }[]>([])
  const [uploadingDocuments, setUploadingDocuments] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [openSelect, setOpenSelect] = useState<'agent' | 'model' | 'thinking' | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null)
  const draftPersistTimerRef = useRef<number>(0)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashIndex, setSlashIndex] = useState(-1)
  const [behavior, setBehavior] = useState<'steer' | 'followUp'>('steer')
  const model = isObject(snapshot.state?.model) ? snapshot.state.model : null
  const currentModel = model && typeof model.id === 'string' && typeof model.provider === 'string'
    ? `${model.provider}/${model.id}`
    : ''
  const selectedModel = snapshot.models.find((item) =>
    `${item.provider}/${item.id}` === currentModel
  )
  const modelInput = selectedModel?.input ?? model?.input
  const supportsImages = Array.isArray(modelInput) && modelInput.includes('image')
  const modelSwitch = useModelSwitch()
  const trackModelSwitch = modelSwitch.track
  /** Picking a model starts loading it right away, with a notice while it loads. */
  const handleModelCommand = useCallback(async (command: JsonObject): Promise<JsonObject> => {
    const result = await onCommand(command)
    if (
      command.type === 'set_model' && typeof command.provider === 'string'
      && typeof command.modelId === 'string'
    ) {
      const picked = snapshot.models.find((item) =>
        item.provider === command.provider && item.id === command.modelId
      )
      const name = typeof picked?.name === 'string' ? picked.name : command.modelId
      trackModelSwitch(command.provider, command.modelId, name, { preload: true })
    }
    return result
  }, [onCommand, snapshot.models, trackModelSwitch])
  const thinking = typeof snapshot.state?.thinkingLevel === 'string'
    ? snapshot.state.thinkingLevel
    : 'off'
  // Keep a ref to the latest draft so stable callbacks can read it without re-creating on every keystroke.
  const messageRef = useRef(message)
  messageRef.current = message
  /** Pi's own commands plus the built-in terminal commands this app runs itself. */
  const allCommands = useMemo(() => slashMenuCommands(commands), [commands])
  const hasAttachments = images.length > 0 || documents.length > 0
  const attachmentsBusy = preparingImages || uploadingDocuments > 0
  const builtinPending = hasAttachments ? null : parseBuiltinCommand(message, commands)
  const piCommandPending = isCommandDraft(message, commands)
  const commandPending = piCommandPending || builtinPending !== null

  // Stable open-change handlers so memoized selects never re-render on a keystroke.
  const handleAgentOpenChange = useCallback(
    (open: boolean) => setOpenSelect(open ? 'agent' : null),
    [],
  )
  const handleModelOpenChange = useCallback(
    (open: boolean) => setOpenSelect(open ? 'model' : null),
    [],
  )
  const handleThinkingOpenChange = useCallback(
    (open: boolean) => setOpenSelect(open ? 'thinking' : null),
    [],
  )

  useEffect(() => {
    if (submitRequest > 0) formRef.current?.requestSubmit()
  }, [submitRequest])

  // oxlint-disable react-hooks/exhaustive-deps
  useEffect(() => {
    if ((focusRequest ?? 0) > 0) textareaRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    if (!requestedSelect) return
    if (requestedSelect === 'agent' && agentOptions.length === 0) {
      onRequestAgentOptions()
      return
    }
    setOpenSelect(requestedSelect)
    const trigger = requestedSelect === 'agent'
      ? agentTriggerRef.current
      : requestedSelect === 'model'
      ? modelTriggerRef.current
      : thinkingTriggerRef.current
    trigger?.focus()
    onSelectOpened?.()
  }, [onSelectOpened, requestedSelect, agentOptions.length, onRequestAgentOptions])

  useEffect(() => {
    if (!draftRequest) return
    setDraftMessage(draftRequest.message)
    textareaRef.current?.focus()
    onDraftApplied?.(draftRequest.id)
  }, [draftRequest, onDraftApplied])

  // Place the caret at the end when the browser restores focus on refresh.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea && document.activeElement === textarea) {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }
  }, [])

  /** Persists the draft to storage, tolerating unavailable storage (private browsing). */
  const persistDraft = useCallback((text: string): void => {
    try {
      if (text) window.localStorage.setItem(draftStorageKey, text)
      else window.localStorage.removeItem(draftStorageKey)
    } catch {
      // Storage can be unavailable in private browsing; the in-memory draft still works.
    }
  }, [draftStorageKey])

  // Flush the pending draft on unmount so switching sessions within the debounce window cannot drop the write.
  useEffect(() => {
    return () => {
      if (draftPersistTimerRef.current) {
        window.clearTimeout(draftPersistTimerRef.current)
        persistDraft(messageRef.current)
      }
    }
  }, [persistDraft])

  /** Available commands filtered by the text after the slash. */
  const filteredCommands = allCommands.filter((command) =>
    slashOpen && String(command.name).toLowerCase().includes(slashFilter.toLowerCase())
  )

  useLayoutEffect(() => {
    const selectedCommand = formRef.current?.querySelector<HTMLElement>(
      '.slash-commands [aria-selected="true"]',
    )
    selectedCommand?.scrollIntoView({ block: 'nearest' })
  }, [slashFilter, slashIndex])

  useEffect(() => {
    if (!slashOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      const dropdown = formRef.current?.querySelector<HTMLElement>('.slash-commands')
      if (dropdown?.contains(event.target)) return
      setSlashOpen(false)
      setSlashIndex(-1)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [slashOpen])

  /** Updates the visible draft immediately and persists it on a debounce so typing never blocks on storage I/O. */
  const setDraftMessage = useCallback((nextMessage: string): void => {
    setMessage(nextMessage)
    messageRef.current = nextMessage
    window.clearTimeout(draftPersistTimerRef.current)
    draftPersistTimerRef.current = window.setTimeout(() => {
      persistDraft(nextMessage)
      draftPersistTimerRef.current = 0
    }, 400)
  }, [persistDraft])

  /** Inserts the selected slash command into the textarea and closes the popover. */
  const selectSlashCommand = useCallback((name: string): void => {
    setDraftMessage(`/${name} `)
    setSlashOpen(false)
    setSlashIndex(-1)
  }, [setDraftMessage])

  /** Sends text and images in the same RPC command, restoring the draft on failure. */
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const nextMessage = message.trim()
    if (attachmentsBusy || (!nextMessage && !hasAttachments)) return
    if (images.length > 0 && !supportsImages) {
      onError('The selected model does not accept images.')
      return
    }
    setSubmitting(true)
    setDraftMessage('')
    setImages([])
    setDocuments([])
    // The message itself makes llama-swap load the model if it is not loaded; say so while it does.
    if (
      !builtinPending && model && typeof model.provider === 'string' && typeof model.id === 'string'
    ) {
      const name = typeof selectedModel?.name === 'string' ? selectedModel.name : model.id
      if (modelSwitch.current?.key !== `${model.provider}/${model.id}`)
        trackModelSwitch(model.provider, model.id, name)
    }
    try {
      if (builtinPending) {
        await onBuiltinCommand(builtinPending)
        return
      }
      await onSend(
        messageWithAttachments(nextMessage, documents.map(({ path }) => path)),
        images.map(({ data, mimeType }) => ({ type: 'image', data, mimeType })),
        behavior,
        piCommandPending && documents.length === 0,
      )
    } catch (cause) {
      setDraftMessage(nextMessage)
      setImages(images)
      setDocuments(documents)
      onError(cause)
    } finally {
      setSubmitting(false)
    }
  }

  /** Prepares pasted images locally to bound the HTTP body and context sent to the model. */
  async function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith('image/')
    )
    if (files.length === 0 || submitting) return
    event.preventDefault()
    const pastedText = event.clipboardData.getData('text/plain')
    const { selectionEnd, selectionStart } = event.currentTarget
    if (pastedText)
      setDraftMessage(
        `${message.slice(0, selectionStart)}${pastedText}${message.slice(selectionEnd)}`,
      )

    await addImages(files)
  }

  /** Prepares images locally to bound the HTTP body and context sent to the model. */
  async function addImages(files: File[]): Promise<void> {
    const remaining = maxComposerImages - images.length
    if (remaining <= 0) {
      onError(`A message can contain at most ${maxComposerImages} images.`)
      return
    }
    setPreparingImages(true)
    try {
      const prepared = await Promise.all(files.slice(0, remaining).map(prepareComposerImage))
      const accepted = prepared.filter((image): image is ComposerImage => image !== null)
      setImages((current) => [...current, ...accepted].slice(0, maxComposerImages))
      if (accepted.length !== files.length)
        onError(`Some images could not be prepared (maximum: ${maxComposerImages}).`)
    } catch (cause) {
      onError(cause)
    } finally {
      setPreparingImages(false)
    }
  }

  /**
   * Handles files from the attach button: images join the message, documents are saved into the
   * session folder so Pi can open them, and anything else is reported.
   */
  async function attachFiles(files: File[]): Promise<void> {
    if (files.length === 0 || submitting) return
    const imageFiles = files.filter(isImageAttachment)
    const documentFiles = files.filter((file) =>
      !isImageAttachment(file) && isDocumentAttachment(file.name)
    )
    const rejected = files.filter((file) =>
      !isImageAttachment(file) && !isDocumentAttachment(file.name)
    )
    if (rejected.length > 0) {
      onError(`Pi cannot read ${rejected.map((file) => file.name).join(', ')}.`)
    }
    if (imageFiles.length > 0) {
      if (supportsImages) await addImages(imageFiles)
      else onError(
          'The selected model does not accept images; choose one that does to attach pictures.',
        )
    }
    await Promise.all(documentFiles.map(async (file) => {
      if (file.size > maxAttachmentBytes) {
        onError(`${file.name} is larger than ${maxAttachmentBytes / 1024 / 1024} MB.`)
        return
      }
      setUploadingDocuments((count) => count + 1)
      try {
        const path = await uploadAttachment(session.cwd, file)
        setDocuments((current) => [...current, { id: crypto.randomUUID(), name: file.name, path }])
      } catch (cause) {
        onError(cause)
      } finally {
        setUploadingDocuments((count) => count - 1)
      }
    }))
    textareaRef.current?.focus()
  }

  return (
    <form
      className='composer'
      onSubmit={(event) => void submit(event)}
      ref={formRef}
    >
      {images.length > 0 && (
        <div aria-label='Images to send' className='composer-images'>
          {images.map((image, index) => (
            <div className='composer-image' key={image.id}>
              <img
                alt={`Image ${index + 1} to send`}
                src={`data:${image.mimeType};base64,${image.data}`}
              />
              <button
                aria-label={`Remove image ${index + 1}`}
                disabled={submitting}
                onClick={() => setImages((current) => current.filter(({ id }) => id !== image.id))}
                type='button'
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {modelSwitch.current && (
        <ModelSwitchNotice
          change={modelSwitch.current}
          onDismiss={modelSwitch.dismiss}
        />
      )}
      {replyFailure && !modelSwitch.current && (
        <ReplyFailureNotice
          failure={replyFailure}
          modelName={String(
            snapshot
              .models
              .find((item) => `${item.provider}/${item.id}` === replyFailure.model)
              ?.name ?? '',
          )}
          onDismiss={() => onDismissReplyFailure?.()}
        />
      )}
      {(documents.length > 0 || uploadingDocuments > 0) && (
        <div aria-label='Files to send' className='composer-documents'>
          {documents
            .map((document) => (
              <Tooltip
                key={document.id}
                label={document
                  .path}
              >
                <div className='composer-document'>
                  <FileIcon />
                  <span>
                    {document
                      .name}
                  </span>
                  <button
                    aria-label={`Remove ${document.name}`}
                    disabled={submitting}
                    onClick={() =>
                      setDocuments((current) =>
                        current
                          .filter(({ id }) =>
                            id !== document
                              .id
                          )
                      )}
                    type='button'
                  >
                    ×
                  </button>
                </div>
              </Tooltip>
            ))}
          {uploadingDocuments > 0 && (
            <div className='composer-document uploading' role='status'>
              <FileIcon />
              <span>Adding {uploadingDocuments} file{uploadingDocuments === 1 ? '' : 's'}…</span>
            </div>
          )}
        </div>
      )}
      {slashOpen && filteredCommands.length > 0 && (
        <div className='slash-commands' role='listbox'>
          {filteredCommands.map((command, index) => (
            <div
              aria-selected={index === slashIndex}
              className={`slash-command-item${index === slashIndex ? ' selected' : ''}`}
              key={String(command.name)}
              onClick={() => selectSlashCommand(String(command.name))}
              onMouseDown={(event) => event.preventDefault()}
              role='option'
            >
              <span className='slash-command-name'>/{String(command.name)}</span>
              {typeof command.description === 'string' && (
                <span className='slash-command-desc'>{command.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <textarea
        aria-label='Message'
        disabled={submitting}
        onPaste={(event) => void handlePaste(event)}
        ref={textareaRef}
        value={message}
        onChange={(event) => {
          const next = event.target.value
          setDraftMessage(next)
          if (next.startsWith('/') && allCommands.length > 0) {
            setSlashOpen(true)
            setSlashFilter(next.slice(1))
            setSlashIndex(0)
          } else {
            setSlashOpen(false)
          }
        }}
        onKeyDown={(event) => {
          if (slashOpen && filteredCommands.length > 0) {
            if (event.key === 'Escape') {
              event.preventDefault()
              setSlashOpen(false)
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSlashIndex((index) => Math.min(index + 1, filteredCommands.length - 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSlashIndex((index) => Math.max(index - 1, 0))
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              const target = slashIndex >= 0 ? filteredCommands[slashIndex] : filteredCommands[0]
              // Enter on a command already typed in full runs it rather than inserting it again.
              if (
                event.key === 'Enter' && target
                && message.trim().toLowerCase() === `/${String(target.name).toLowerCase()}`
              ) {
                setSlashOpen(false)
                event.currentTarget.form?.requestSubmit()
                return
              }
              if (target) selectSlashCommand(String(target.name))
              return
            }
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        placeholder='Ask Pi…  / for commands'
        rows={3}
      />
      <div className='composer-footer'>
        <div className='composer-actions'>
          <div className='composer-tools'>
            {showAgentSelector && (
              <AgentSelect
                agentOptions={agentOptions}
                selectedAgent={selectedAgent}
                agentLoading={agentLoading}
                agentBusy={agentBusy || agentOptionsLoading}
                onAgentChange={onAgentChange}
                onRequestOptions={onRequestAgentOptions}
                open={openSelect === 'agent'}
                onOpenChange={handleAgentOpenChange}
                triggerRef={agentTriggerRef}
              />
            )}
            <Tooltip label='Attach images, PDF, Word, Excel or text files'>
              <button
                aria-label='Attach files'
                className='composer-attach'
                disabled={submitting}
                onClick={() => fileInputRef.current?.click()}
                type='button'
              >
                <svg
                  aria-hidden='true'
                  fill='none'
                  stroke='currentColor'
                  strokeLinecap='round'
                  strokeWidth='2'
                  viewBox='0 0 24 24'
                >
                  <path d='M12 5v14M5 12h14' />
                </svg>
              </button>
            </Tooltip>
            <input
              accept={attachmentAccept}
              aria-hidden='true'
              hidden
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                void attachFiles(files)
              }}
              ref={fileInputRef}
              tabIndex={-1}
              type='file'
            />
            <ModelSelect
              models={snapshot.models}
              currentModel={currentModel}
              onCommand={handleModelCommand}
              onError={onError}
              open={openSelect === 'model'}
              onOpenChange={handleModelOpenChange}
              triggerRef={modelTriggerRef}
            />
            <ThinkingSelect
              thinking={thinking}
              onCommand={onCommand}
              onError={onError}
              open={openSelect === 'thinking'}
              onOpenChange={handleThinkingOpenChange}
              triggerRef={thinkingTriggerRef}
            />
            <VoiceSelect />
            <ContextChip stats={snapshot.stats} />
            {running && <BehaviorSelect behavior={behavior} onChange={setBehavior} />}
          </div>
          <div className='composer-primary-actions'>
            <span className='composer-stop-slot'>
              {running && (
                <Tooltip label='Stop generation'>
                  <button
                    aria-label='Stop generation'
                    className='icon-button danger'
                    onClick={() => void onAbort().catch(onError)}
                    type='button'
                  >
                    <svg aria-hidden='true' viewBox='0 0 16 16'>
                      <rect height='8' rx='1.5' width='8' x='4' y='4' />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </span>
            <Tooltip label={commandPending ? 'Run command (Enter)' : 'Send message (Enter)'}>
              <button
                aria-label={commandPending ? 'Run command' : 'Send message'}
                className={`icon-button send${commandPending ? ' command' : ''}`}
                disabled={submitting || attachmentsBusy || (!message.trim() && !hasAttachments)}
                type='submit'
              >
                {commandPending
                  ? (
                    <svg aria-hidden='true' viewBox='0 0 16 16'>
                      <path d='M9.2 1.5 3.5 8.4h3.2l-.3 6.1 6.1-7.4H9.1l.1-5.6Z' />
                    </svg>
                  )
                  : (
                    <svg aria-hidden='true' viewBox='0 0 16 16'>
                      <path d='m2.5 2.5 11 5.5-11 5.5 1.8-5.1L9 8 4.3 7.6z' />
                    </svg>
                  )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </form>
  )
})

function FileIcon() {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      stroke='currentColor'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
    >
      <path d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z' />
      <path d='M14 3v5h5' />
    </svg>
  )
}
