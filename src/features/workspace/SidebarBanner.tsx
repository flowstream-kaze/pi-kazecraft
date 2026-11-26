/**
 * The sidebar banner: the user's image, or the built-in Pi banner drawn in the theme's colours so it
 * follows every theme without an image file.
 */
export function SidebarBanner({ image }: { image: string | null }) {
  if (image) return <img alt='Sidebar banner' className='sidebar-banner-image' src={image} />
  return <DefaultBanner />
}

export function DefaultBanner() {
  return (
    <svg
      aria-label='Pi Local AI'
      className='sidebar-banner-default'
      role='img'
      viewBox='2 0 132 44'
      xmlns='http://www.w3.org/2000/svg'
    >
      <defs>
        <linearGradient id='sidebar-banner-mark' x1='0' x2='1' y1='0' y2='1'>
          <stop offset='0' stopColor='var(--accent)' />
          <stop offset='1' stopColor='color-mix(in srgb, var(--accent) 62%, var(--secondary))' />
        </linearGradient>
      </defs>
      {/* The mark: a rounded tile with cat ears, drawn as one shape so the gradient runs through it. */}
      <path
        d='M3 17.5 5 4.6c.2-1.3 1.7-1.9 2.7-1L14.6 10h10.8l6.9-6.4c1-.9 2.5-.3 2.7 1L37 17.5V33a9 9 0 0 1-9 9H12a9 9 0 0 1-9-9Z'
        fill='url(#sidebar-banner-mark)'
      />
      {/* Inner ears, a lighter tint of the tile. */}
      <path
        d='m7.3 8.2-1.1 6.4 5.4-4Zm25.4 0 1.1 6.4-5.4-4Z'
        fill='var(--on-accent)'
        fillOpacity='0.32'
      />
      {/* π drawn as paths so it looks the same in every font. */}
      <g
        fill='none'
        stroke='var(--on-accent)'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='3'
        transform='translate(-0.5 6)'
      >
        <path d='M11 15.5c2-1.6 4-2 6.5-2H30' />
        <path d='M16.5 14v15' />
        <path d='M24.5 14v12.5c0 2 .9 3 2.6 3 1 0 1.9-.4 2.6-1' />
      </g>
      <text
        dominantBaseline='central'
        fill='var(--ink)'
        fontFamily='inherit'
        fontSize='18'
        fontWeight='650'
        letterSpacing='-0.02em'
        lengthAdjust='spacingAndGlyphs'
        // A fixed width keeps the mark and name centred whatever font the system substitutes.
        textLength='84'
        x='48'
        y='24'
      >
        Pi Local AI
      </text>
    </svg>
  )
}
