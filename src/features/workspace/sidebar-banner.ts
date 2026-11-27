/** The sidebar's banner: the built-in Pi banner, or an image the user chose (kept as a data URL). */

export const SIDEBAR_BANNER_KEY = 'pi-kazecraft.sidebar-banner'

import {
  isBannerDataUrl,
  MAX_BANNER_DATA_URL_LENGTH,
  type PreparedImage,
} from '../../components/banner-image.ts'

export { isBannerDataUrl, type PreparedImage } from '../../components/banner-image.ts'

/** Images are scaled down to this box before they are stored; the sidebar shows them far smaller. */
const MAX_BANNER_WIDTH = 1200
const MAX_BANNER_HEIGHT = 400

/** Image types the banner accepts (what browsers display in an `<img>`). */
export const BANNER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'

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
  return (await prepareImage(file, { width: MAX_BANNER_WIDTH, height: MAX_BANNER_HEIGHT })).src
}

/**
 * Turns a chosen file into a data URL no larger than `box`, keeping its proportions. Raster images
 * are scaled down (never up) and saved as WebP, or PNG where WebP export is missing; SVG is kept as
 * is. The returned size is the stored image's own size (for an SVG without one, a 3:1 default).
 */
export async function prepareImage(
  file: File,
  box: { width: number; height: number },
): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  const original = await readAsDataUrl(file)
  const image = await loadImage(original)
  const naturalWidth = image.naturalWidth || 0
  const naturalHeight = image.naturalHeight || 0
  if (file.type === 'image/svg+xml') {
    // An SVG without width/height reports no size; give it a banner-like box instead.
    const width = naturalWidth || box.width
    const height = naturalHeight || Math.round(box.width / 3)
    const scale = Math.min(1, box.width / width, box.height / height)
    return {
      src: checkedSize(original),
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    }
  }
  if (!naturalWidth || !naturalHeight)
    throw new Error('This image has no size the browser can read.')
  const scale = Math.min(1, box.width / naturalWidth, box.height / naturalHeight)
  if (scale === 1 && original.length <= MAX_BANNER_DATA_URL_LENGTH) {
    return { src: original, width: naturalWidth, height: naturalHeight }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize the image.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  // WebP keeps transparency and stays small; PNG is the fallback where WebP export is missing.
  const webp = canvas.toDataURL('image/webp', 0.9)
  return {
    src: checkedSize(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')),
    width: canvas.width,
    height: canvas.height,
  }
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
