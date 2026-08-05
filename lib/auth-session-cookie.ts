import { getSessionCookieDeletionOptions, authCookieName, type SessionCookieOptions } from './auth-cookie'

type CookieHeaderResponse = { headers: Headers }

function serializeCookie(name: string, value: string, options: SessionCookieOptions) {
  let header = `${name}=${value}`
  if (options.domain) header += `; Domain=${options.domain}`
  if (options.path) header += `; Path=${options.path}`
  if (options.expires) header += `; Expires=${options.expires.toUTCString()}`
  if (typeof options.maxAge === 'number') header += `; Max-Age=${options.maxAge}`
  if (options.httpOnly) header += '; HttpOnly'
  if (options.secure) header += '; Secure'
  if (options.sameSite) header += `; SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`
  return header
}

/** Clear the pre-domain host-only variant left by older deployments. */
export function appendLegacyHostCookieDeletion(response: CookieHeaderResponse, request: Request) {
  const options = { ...getSessionCookieDeletionOptions(request) }
  delete options.domain
  response.headers.append('Set-Cookie', serializeCookie(authCookieName, '', options))
}
