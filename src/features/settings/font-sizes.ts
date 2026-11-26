/** User-adjustable text sizes, applied as CSS variables on the document root. */

export const FONT_SIZE_KEYS = ['message', 'reasoning', 'code', 'composer'] as const
export type FontSizeKey = (typeof FONT_SIZE_KEYS)[number]
export type FontSizes = Record<FontSizeKey, number>

export const FONT_SIZE_LABELS: Record<FontSizeKey, string> = {
  message: 'Messages',
  reasoning: 'Thinking',
  code: 'Code',
  composer: 'Input box',
}

export const DEFAULT_FONT_SIZES: FontSizes = {
  message: 16,
  reasoning: 12,
  code: 12,
  composer: 16,
}

export const MIN_FONT_SIZE = 10
export const MAX_FONT_SIZE = 24
export const FONT_SIZES_STORAGE_KEY = 'pi-livecraft.font-sizes'

/** The CSS variable each size sets; the stylesheets fall back to the defaults when it is missing. */
export const fontSizeVariable = (key: FontSizeKey) => `--font-size-${key}`

/** Rounds a size to a whole pixel inside the allowed range, or returns undefined for a non-number. */
export function clampFontSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

/** Reads stored sizes; missing, malformed or out-of-range values fall back to (or are clamped near) the defaults. */
export function parseFontSizes(raw: string | null): FontSizes {
  let value: unknown
  try {
    value = JSON.parse(raw ?? 'null')
  } catch {
    return { ...DEFAULT_FONT_SIZES }
  }
  const stored = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const sizes = { ...DEFAULT_FONT_SIZES }
  for (const key of FONT_SIZE_KEYS) {
    const size = clampFontSize(stored[key])
    if (size !== undefined) sizes[key] = size
  }
  return sizes
}
