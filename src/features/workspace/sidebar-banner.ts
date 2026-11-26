/** The sidebar's banner: the built-in Pi banner, or an image the user chose (kept as a data URL). */

export const SIDEBAR_BANNER_KEY = 'pi-livecraft.sidebar-banner'

/** Largest stored banner; browser storage holds about 5 MB per site and other preferences share it. */
export const MAX_BANNER_DATA_URL_LENGTH = 1_500_000

/** Images are scaled down to this box before they are stored; the sidebar shows them far smaller. */
const MAX_BANNER_WIDTH = 1200
const MAX_BANNER_HEIGHT = 400

/** Image types the banner accepts (what browsers display in an `<img>`). */
export const BANNER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'

/** Whether a stored value is a banner this app wrote: an image data URL within the size limit. */
export function isBannerDataUrl(value: unknown): value is string {
  return typeof value === 'string'
    && /^data:image\/(?:png|jpeg|webp|gif|svg\+xml|avif);base64,[A-Za-z0-9+/=]+$/.test(value)
    && value.length <= MAX_BANNER_DATA_URL_LENGTH
}

export function readSidebarBanner(): string | null {
  try {
    const value = window.localStorage.getItem(SIDEBAR_BANNER_KEY)
    return isBannerDataUrl(value) ? value : null
  } catch {
    return null
  }
}

/** Stores the banner, or removes it (back to the built-in banner) for `null`. */
export function storeSidebarBanner(dataUrl: string | null): void {
  if (dataUrl === null) {
    try {
      window.localStorage.removeItem(SIDEBAR_BANNER_KEY)
    } catch {
      // Nothing stored, nothing to remove.
    }
    return
  }
  try {
    window.localStorage.setItem(SIDEBAR_BANNER_KEY, dataUrl)
  } catch {
    throw new Error('The browser could not save this image. Try a smaller one.')
  }
}

/**
 * Turns a chosen file into a banner data URL. Raster images larger than the banner box are
 * scaled down (a GIF keeps its animation only when it is already small enough); SVG is kept as is.
 */
export async function prepareBannerImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  const original = await readAsDataUrl(file)
  if (file.type === 'image/svg+xml') return checkedSize(original)
  const image = await loadImage(original)
  const scale = Math.min(
    1,
    MAX_BANNER_WIDTH / image.naturalWidth,
    MAX_BANNER_HEIGHT / image.naturalHeight,
  )
  if (scale === 1 && original.length <= MAX_BANNER_DATA_URL_LENGTH) return original
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize the image.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  // WebP keeps transparency and stays small; PNG is the fallback where WebP export is missing.
  const webp = canvas.toDataURL('image/webp', 0.9)
  return checkedSize(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'))
}

function checkedSize(dataUrl: string): string {
  if (!isBannerDataUrl(dataUrl)) {
    throw new Error('This image is too large for a banner. Choose one under about 1 MB.')
  }
  return dataUrl
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The image could not be read.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('This file is not an image the browser can show.'))
    image.src = source
  })
}
