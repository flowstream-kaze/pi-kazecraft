// 920 x 307 JPEG, shown at 460 px wide: twice the display size, so it stays sharp on high-DPI screens.
import { useState } from 'react'
import defaultBanner from '../assets/welcome-banner.jpg'
import { bannerDisplaySize } from './banner-image.ts'
import { useWelcomeBanner } from './welcome-banner-store.ts'

/**
 * The app's banner, used wherever the app introduces itself: the welcome screen, the loading
 * screens and an empty session. It is the user's image from Settings → Banners when one is set,
 * else the built-in cat on a golden π. Any image keeps its proportions within 460 x 200 px (and
 * the column's width); its stored size reserves the space before it loads. `floating` adds the
 * gentle float the loading screens use while they wait.
 */
export function WelcomeBanner({ floating = false }: { floating?: boolean }) {
  const stored = useWelcomeBanner()
  // A stored image the browser cannot show falls back to the built-in banner instead of a broken one.
  const [failedSrc, setFailedSrc] = useState('')
  const custom = stored && stored.src !== failedSrc ? stored : null
  const width = custom?.width ?? 920
  const height = custom?.height ?? 307
  const display = bannerDisplaySize(width, height)
  return (
    <img
      alt={custom ? 'Banner' : 'A Pi Coding Agent: a cat asleep on a golden π'}
      className={`welcome-banner${floating ? ' brand-mark-loading' : ''}`}
      decoding='async'
      height={height}
      onError={() => {
        if (custom) setFailedSrc(custom.src)
      }}
      src={custom?.src ?? defaultBanner}
      style={{ width: `${display.width}px`, aspectRatio: `${width} / ${height}` }}
      width={width}
    />
  )
}
