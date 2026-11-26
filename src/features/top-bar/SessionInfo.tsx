/** Renders the session name, with a dot when Pi is active. */
export function SessionInfo({ name, active }: {
  name: string
  active: boolean
}) {
  return (
    <div className='session-top-bar-info'>
      {active && (
        <span aria-label='Pi is active' className='session-status-indicator working' role='img' />
      )}
      <strong>{name}</strong>
    </div>
  )
}
