/**
 * A window with one side panel marked, shared by both sidebar toggles: `left` for the session
 * sidebar, `right` for the tools sidebar. The same icon opens and closes its sidebar.
 */
export function PanelIcon({ side }: { side: 'left' | 'right' }) {
  const divider = side === 'left' ? 9.5 : 14.5
  const notch = side === 'left' ? 'M5.75 8.5h1.5M5.75 11.5h1.5' : 'M16.75 8.5h1.5M16.75 11.5h1.5'
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='17'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.6'
      viewBox='0 0 24 24'
      width='17'
    >
      <rect height='16' rx='3.5' width='18' x='3' y='4' />
      <path d={`M${divider} 4v16`} />
      <path d={notch} />
    </svg>
  )
}
