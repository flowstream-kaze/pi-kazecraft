import { useEffect, useState } from 'react'
import { Tooltip } from '../../components/Tooltip.tsx'

interface BranchButtonProps {
  entryId: string
  onError: (cause: unknown) => void
  /** Forks before the message; resolves false when Pi cancels the fork. */
  onFork: (entryId: string) => Promise<boolean>
}

const actions = {
  edit: {
    idle: 'Edit message',
    busy: 'Opening the message for editing',
    done: 'Edit it in the composer',
    cancelled: 'Edit cancelled',
    icon: (
      <path
        d='M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5ZM9 4l3 3'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    ),
  },
  rewind: {
    idle: 'Rewind and resend',
    busy: 'Rewinding',
    done: 'Sent again',
    cancelled: 'Rewind cancelled',
    icon: (
      <>
        <path d='M3.5 8a4.5 4.5 0 1 0 1.4-3.3' strokeLinecap='round' />
        <path d='M4.5 1.8v3h3' strokeLinecap='round' strokeLinejoin='round' />
      </>
    ),
  },
} as const

/**
 * Forks the Pi session before a user message. Editing places the prompt in the composer;
 * rewinding sends it again so the conversation continues from that point.
 */
function BranchButton(
  { action, entryId, onError, onFork }: BranchButtonProps & { action: keyof typeof actions },
) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'idle' | 'done' | 'cancelled'>('idle')
  const copy = actions[action]

  useEffect(() => {
    if (status === 'idle') return
    const timeout = window.setTimeout(() => setStatus('idle'), 1500)
    return () => window.clearTimeout(timeout)
  }, [status])

  async function run(): Promise<void> {
    setBusy(true)
    try {
      setStatus(await onFork(entryId) ? 'done' : 'cancelled')
    } catch (cause) {
      onError(cause)
    } finally {
      setBusy(false)
    }
  }

  const label = busy ? copy.busy : status === 'idle' ? copy.idle : copy[status]
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        className='conversation-action-button'
        disabled={busy}
        onClick={() => void run()}
        type='button'
      >
        <svg aria-hidden='true' fill='none' stroke='currentColor' viewBox='0 0 16 16'>
          {copy.icon}
        </svg>
      </button>
    </Tooltip>
  )
}

export function EditButton(props: BranchButtonProps) {
  return <BranchButton action='edit' {...props} />
}

export function RewindButton(props: BranchButtonProps) {
  return <BranchButton action='rewind' {...props} />
}
