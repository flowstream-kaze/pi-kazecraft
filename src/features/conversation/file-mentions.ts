/**
 * Which inline code in a reply could name a file, before asking the backend whether it exists.
 * Plain logic only, for tests; the backend applies the same rule (server/features/file-links).
 */
export function looksLikeFileMention(text: string): boolean {
  const value = text.trim()
  if (!value || value.length > 400 || /[\r\n<>"|?*]/.test(value)) return false
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false // a URL
  if (/^(\\\\|\/\/)/.test(value)) return false // a network path
  return /\.[a-z\d]{1,10}$/i.test(value)
}
