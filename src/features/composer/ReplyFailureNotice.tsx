import type { ReplyFailure } from '../conversation/reply-failure.ts'

/**
 * Says why the last message got no reply, above the message box, until it is dismissed or the
 * next message is sent. Uses the model-switch notice's look in its failed state.
 */
export function ReplyFailureNotice(
  { failure, modelName, onDismiss }: {
    failure: ReplyFailure
    modelName: string
    onDismiss: () => void
  },
) {
  const name = modelName || 'The model'
  const sizes = failure.requested && failure.limit
    ? ` It holds about ${failure.requested.toLocaleString()} tokens; the limit is ${failure.limit.toLocaleString()}.`
    : ''
  return (
    <div className='model-switch-notice failed reply-failure-notice' role='alert'>
      <div className='model-switch-line'>
        <span className='model-switch-text'>
          {failure.kind === 'too-long'
            ? (
              <>
                <strong>No reply: this conversation is too long for {name}.</strong>
                {sizes}{' '}
                Pi could not shorten it, so nothing was sent back. Switch back to a model with a
                larger context, or start a new session.
              </>
            )
            : (
              <>
                <strong>No reply: {name} returned an error.</strong>{' '}
                <span className='reply-failure-detail'>{failure.detail}</span>
              </>
            )}
        </span>
        <button
          aria-label='Dismiss'
          className='model-switch-dismiss'
          onClick={onDismiss}
          type='button'
        >
          ×
        </button>
      </div>
    </div>
  )
}
