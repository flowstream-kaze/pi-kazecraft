/**
 * Keeps web pages from other sites out of the backend. The backend listens on 127.0.0.1 only, but
 * a page from any site open in the browser can still send requests there: a form or `fetch` with a
 * plain-text body needs no permission, and a site can point its own domain name at 127.0.0.1 (DNS
 * rebinding). Either could start a Pi command, write Pi's memory or open files. So:
 *
 * - the Host must be a local address, which defeats DNS rebinding;
 * - a request that changes something must come from a local page: a browser marks a cross-site
 *   request with `Origin` and `Sec-Fetch-Site`, and those must not name another site.
 *
 * Tools that are not browsers (scripts, the launcher) send neither header and are let through,
 * as they could reach the files directly anyway.
 */
const localHostnames = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const readOnlyMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

type Headers = Record<string, string | string[] | undefined>

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

function isLocalHostname(hostname: string): boolean {
  return localHostnames.has(hostname.toLowerCase())
}

/** The hostname of a Host header ("127.0.0.1:5173", "[::1]:43121", "localhost"). */
export function hostnameOf(host: string): string {
  const value = host.trim()
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1)
  return value.split(':')[0]
}

/** Why a request is refused, or null when it may go on. */
export function refusalReason(method: string, headers: Headers): string | null {
  const host = header(headers, 'host')
  if (host && !isLocalHostname(hostnameOf(host))) return 'Requests must be addressed to this PC'

  if (readOnlyMethods.has(method.toUpperCase())) return null

  const site = header(headers, 'sec-fetch-site')
  if (site === 'cross-site') return 'Requests from other websites are not accepted'
  const origin = header(headers, 'origin')
  if (origin !== undefined) {
    if (origin === 'null') return 'Requests from other websites are not accepted'
    let hostname: string
    try {
      hostname = new URL(origin).hostname
    } catch {
      return 'Requests from other websites are not accepted'
    }
    // URL keeps the brackets of an IPv6 hostname ("[::1]"), which the local list includes.
    if (!isLocalHostname(hostname)) return 'Requests from other websites are not accepted'
  }
  return null
}
