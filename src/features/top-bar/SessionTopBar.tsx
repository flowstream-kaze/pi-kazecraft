import type { ReactNode } from 'react'
import type { SessionSummary } from '../../../shared/types.ts'
import { SessionInfo } from './SessionInfo.tsx'

/**
 * Heads the open conversation with its name; context usage lives in the
 * composer's Context chip. `actions` holds controls placed at the right edge.
 */
export function SessionTopBar(
  { actions, compacting, running, session }: {
    actions?: ReactNode
    compacting: boolean
    running: boolean
    session: SessionSummary
  },
) {
  return (
    <header aria-label='Session information' className='session-top-bar'>
      {compacting
        ? (
          <div
            aria-label='Compaction in progress'
            className='session-top-bar-compacting'
            role='status'
          >
            <span aria-hidden='true' className='session-top-bar-spinner' /> Compacting…
          </div>
        )
        : <SessionInfo active={running} name={session.name} />}
      {actions && <div className='session-top-bar-end'>{actions}</div>}
    </header>
  )
}
