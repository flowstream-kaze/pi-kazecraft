/**
 * Banner image rules shared by the welcome and sidebar banners. Plain logic only, no browser APIs,
 * so it can be tested on its own.
 */

/** Largest stored banner; browser storage holds about 5 MB per site and other preferences share it. */
export const MAX_BANNER_DATA_URL_LENGTH = 1_500_000

/** Whether a stored value is a banner this app wrote: an image data URL within the size limit. */
export function isBannerDataUrl(value: unknown): value is string {
  return typeof value === 'string'
    && /^data:image\/(?:png|jpeg|webp|gif|svg\+xml|avif);base64,[A-Za-z0-9+/=]+$/.test(value)
    && value.length <= MAX_BANNER_DATA_URL_LENGTH
}

/** A prepared image and its size in pixels, so pages can reserve its space before it loads. */
export interface PreparedImage {
  src: string
  width: number
  height: number
}

export const WELCOME_BANNER_KEY = 'pi-kazecraft.welcome-banner'

/** Largest display size of the welcome banner. */
export const BANNER_MAX_DISPLAY = { width: 460, height: 200 }

/** Largest stored size: twice the largest display size, for high-DPI screens. */
export const WELCOME_BANNER_BOX = { width: 920, height: 400 }

/**
 * How large a banner of `width` x `height` pixels is shown: scaled down to fit 460 x 200 with its
 * proportions kept, and never scaled up, so a small image is not blurred. A column narrower than
 * the result shrinks it further through CSS (max-width: 100%).
 */
export function bannerDisplaySize(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, BANNER_MAX_DISPLAY.width / width, BANNER_MAX_DISPLAY.height / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Reads a stored welcome banner; anything malformed counts as none, so the built-in one shows. */
export function parseWelcomeBanner(raw: string | null): PreparedImage | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (typeof value !== 'object' || value === null) return null
    const { src, width, height } = value as Record<string, unknown>
    const validSize = (size: unknown) =>
      typeof size === 'number' && Number.isFinite(size) && size >= 1 && size <= 4000
    if (!isBannerDataUrl(src) || !validSize(width) || !validSize(height)) return null
    return { src, width: Math.round(width as number), height: Math.round(height as number) }
  } catch {
    return null
  }
}
