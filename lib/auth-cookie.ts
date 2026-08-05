/**
 * Shared session-cookie constants.
 *
 * Keep this module dependency-free so it can be imported by the Edge
 * middleware as well as the server-side authentication service.
 */
export const authCookieName = 'eason_fans_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
export const authCookieDomain = '.ecfc.fans'
export const authCookieHost = authCookieDomain.slice(1)

export type SessionCookieOptions = {
  domain?: string
  path?: string
  expires?: Date
  maxAge?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
}

export function isAuthCookieHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\.+/, '')
  return normalized === authCookieHost || normalized.endsWith(`.${authCookieHost}`)
}

function getRequestHostname(request?: Request) {
  if (!request) return ''

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const hostHeader = request.headers.get('host')?.split(',')[0]?.trim()
  const hostCandidate = forwardedHost || hostHeader

  if (hostCandidate) {
    try {
      return new URL(`http://${hostCandidate}`).hostname.toLowerCase()
    } catch {
      // Fall back to the URL below when a proxy sends a malformed host value.
    }
  }

  try {
    return new URL(request.url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function getSessionCookieOptions(request?: Request) {
  const forwardedProtocol = request?.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const requestUsesHttps = request
    ? forwardedProtocol
      ? forwardedProtocol === 'https'
      : new URL(request.url).protocol === 'https:'
    : false

  const hostname = getRequestHostname(request)
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  // Max-Age/Expires make the cookie survive a browser or webview restart;
  // Secure keeps that persistent credential restricted to HTTPS in production.
  const secure = localHost ? false : process.env.NODE_ENV === 'production' || requestUsesHttps
  // Lax is sufficient for same-site apex/www navigation and is accepted by
  // mobile browsers and embedded browsers. Keep the value identical for
  // login, registration, and deletion so the browser treats the cookie as
  // one persistent session.
  const sameSite = 'lax' as const
  // A Domain attribute is valid only for ecfc.fans and its subdomains. A
  // preview/alternate host must receive a host-only cookie; browsers reject a
  // cookie whose Domain does not match the response host.
  const domain = !localHost && isAuthCookieHost(hostname) ? authCookieDomain : undefined

  return {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    ...(domain ? { domain } : {}),
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  }
}

export function getSessionCookieDeletionOptions(request?: Request) {
  return {
    ...getSessionCookieOptions(request),
    maxAge: 0,
    expires: new Date(0),
  }
}
