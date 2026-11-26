/** Browser side of the text sizes: localStorage and the document's CSS variables. */
import {
  DEFAULT_FONT_SIZES,
  FONT_SIZE_KEYS,
  FONT_SIZES_STORAGE_KEY,
  type FontSizes,
  fontSizeVariable,
  parseFontSizes,
} from './font-sizes.ts'

export function readFontSizes(): FontSizes {
  try {
    return parseFontSizes(window.localStorage.getItem(FONT_SIZES_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_FONT_SIZES }
  }
}

export function storeFontSizes(sizes: FontSizes) {
  try {
    window.localStorage.setItem(FONT_SIZES_STORAGE_KEY, JSON.stringify(sizes))
  } catch {
    // Storage can be unavailable (private window, quota); the sizes still apply for this visit.
  }
}

export function applyFontSizes(root: HTMLElement, sizes: FontSizes) {
  for (const key of FONT_SIZE_KEYS) root.style.setProperty(fontSizeVariable(key), `${sizes[key]}px`)
}
