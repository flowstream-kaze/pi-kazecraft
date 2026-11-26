import { memo, type ReactNode } from 'react'
import type { JsonObject } from '../../../shared/types.ts'
import { isObject } from '../../../shared/is-object.ts'
import { Tooltip } from '../../components/Tooltip.tsx'
import { CopyButton } from './CopyButton.tsx'
import { EditButton, RewindButton } from './ForkButton.tsx'
import { Markdown } from './Markdown.tsx'
import { hasVisibleContent, messageText, reasoningTextForDisplay } from './message-display.ts'
import { decodeTokensPerSecond, formatDecodeSpeed, replyTime } from './message-usage.ts'
import { MessageFooter, ReadAloudButton, RelativeTime } from './MessageFooter.tsx'

type ForkAction = (entryId: string) => Promise<boolean>

/** Renders a visible protocol message with the default or custom presentation. */
export const MessageCard = memo(
  function MessageCard(
    { copyInResponseBar = false, message, onError, onFork, onRewind }: {
      /** The reply's response bar offers the copy action, so the card does not repeat it. */
      copyInResponseBar?: boolean
      message: JsonObject
      onError: (cause: unknown) => void
      /** Forks before a user message and places it in the composer for editing. */
      onFork: ForkAction
      /** Forks before a user message and sends it again. */
      onRewind: ForkAction
    },
  ) {
    if (message.role === 'custom' && message.customType === 'compaction')
      return <CompactionMessage message={message} />
    if (message.role === 'custom' && typeof message.customType === 'string')
      return <DefaultCustomMessage message={message} />
    return (
      <DefaultMessageCard
        copyInResponseBar={copyInResponseBar}
        message={message}
        onError={onError}
        onFork={onFork}
        onRewind={onRewind}
      />
    )
  },
)

const DefaultMessageCard = memo(
  function DefaultMessageCard(
    { copyInResponseBar, message, onError, onFork, onRewind }: {
      copyInResponseBar: boolean
      message: JsonObject
      onError: (cause: unknown) => void
      onFork: ForkAction
      onRewind: ForkAction
    },
  ) {
    const role = String(message.role)
    const timestamp = typeof message.timestamp === 'number' ? new Date(message.timestamp) : null
    const time = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null
    const text = messageText(message.content ?? message.output)
    const forkEntryId = role === 'user' && typeof message.forkEntryId === 'string'
      ? message.forkEntryId
      : undefined
    // A reply without a response bar (still streaming, or interrupted) keeps a hover copy action.
    const hoverCopyText = role !== 'user' && !copyInResponseBar ? text : ''
    const card = (
      <article className={`message ${role}`}>
        {hoverCopyText && (
          <div className='conversation-actions message-actions'>
            <CopyButton label='Copy message' onError={onError} value={hoverCopyText} />
          </div>
        )}
        <div className='content'>
          {renderContent(message.content ?? message.output, message.role, onError)}
        </div>
      </article>
    )
    if (role !== 'user') return card
    return (
      <>
        {card}
        <MessageFooter side='user'>
          {time && <RelativeTime time={time} />}
          {forkEntryId && (
            <RewindButton
              entryId={forkEntryId}
              onError={onError}
              onFork={onRewind}
            />
          )}
          {forkEntryId && <EditButton entryId={forkEntryId} onError={onError} onFork={onFork} />}
          {text && <CopyButton label='Copy message' onError={onError} value={text} />}
        </MessageFooter>
      </>
    )
  },
)

/** Renders an unknown custom message without interpreting extension-specific details. */
function DefaultCustomMessage({ message }: { message: JsonObject & { customType?: unknown } }) {
  const content = hasVisibleContent(message.content)
    ? renderContent(message.content, message.role)
    : <p>Message has no displayable content.</p>
  return (
    <article className='message custom-message'>
      <code className='custom-message-type'>{String(message.customType)}</code>
      <div className='content'>{content}</div>
    </article>
  )
}

/** Shows a compaction summary as one collapsed line; a click expands the full summary. */
function CompactionMessage({ message }: { message: JsonObject }) {
  return (
    <details className='message custom-message compaction-message'>
      <summary>
        <span className='compaction-chevron' aria-hidden='true' />
        <span>Conversation compacted</span>
        <span className='compaction-hint'>Show summary</span>
      </summary>
      <div className='content'>
        {hasVisibleContent(message.content)
          ? renderContent(message.content, message.role)
          : <p>The summary is empty.</p>}
      </div>
    </details>
  )
}

/**
 * Closes a finished assistant reply with always-visible actions: copy the reply text (never its
 * thinking), read it aloud, the decode speed the backend measured, and when it finished.
 */
export function ResponseBar(
  { message, onError, turnNumber }: {
    message: JsonObject
    onError: (cause: unknown) => void
    turnNumber?: number
  },
) {
  const speed = decodeTokensPerSecond(message)
  const time = replyTime(message)
  const text = messageText(message.content)
  return (
    <MessageFooter side='assistant'>
      {text && <CopyButton label='Copy reply' onError={onError} value={text} />}
      {text && <ReadAloudButton text={text} onError={onError} />}
      {speed !== undefined && (
        <Tooltip label='Decode speed: how fast the model wrote this reply'>
          <span className='message-footer-meta'>{formatDecodeSpeed(speed)}</span>
        </Tooltip>
      )}
      {time && (
        <RelativeTime
          detail={turnNumber === undefined ? undefined : `Turn ${turnNumber}`}
          time={time}
        />
      )}
    </MessageFooter>
  )
}

/** Renders message content in protocol order, including visible thinking. */
function renderContent(
  content: unknown,
  role: unknown,
  onError?: (cause: unknown) => void,
): ReactNode {
  if (typeof content === 'string')
    return <Markdown copyablePre={role === 'assistant'} onError={onError}>{content}</Markdown>
  if (!Array.isArray(content)) return null
  return (
    <>
      {content.map((part, contentIndex) => {
        if (isImageContent(part))
          return (
            <img
              alt={`Attached image ${contentIndex + 1}`}
              className='message-image'
              key={`image-${contentIndex}`}
              src={`data:${part.mimeType};base64,${part.data}`}
            />
          )
        if (!isObject(part)) return null
        if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim())
          return (
            <ReasoningBlock
              copyablePre={role === 'assistant'}
              key={`reasoning-${contentIndex}`}
              onError={onError}
            >
              {reasoningTextForDisplay(role, part.thinking)}
            </ReasoningBlock>
          )
        if (part.type === 'text' && typeof part.text === 'string')
          return (
            <Markdown
              copyablePre={role === 'assistant'}
              key={`text-${contentIndex}`}
              onError={onError}
            >
              {part.text}
            </Markdown>
          )
        return null
      })}
    </>
  )
}

/** Presents thinking directly in the thread with a subtle hierarchy. */
function ReasoningBlock(
  { children, copyablePre, live = false, onError }: {
    children: string
    copyablePre: boolean
    live?: boolean
    onError?: (cause: unknown) => void
  },
) {
  return (
    <div className={`reasoning${live ? ' conversation-entry' : ''}`}>
      <Markdown copyablePre={copyablePre} onError={onError}>{children}</Markdown>
    </div>
  )
}

function isImageContent(value: unknown): value is JsonObject & { data: string; mimeType: string } {
  return isObject(value) && value.type === 'image' && typeof value.data === 'string' && typeof value
        .mimeType === 'string'
    && /^image\/(?:gif|jpeg|png|webp)$/.test(value.mimeType)
}
