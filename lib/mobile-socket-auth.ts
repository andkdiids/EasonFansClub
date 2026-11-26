import { resolveMobileAccess } from '@/lib/mobile-auth'

/**
 * Native clients cannot present the browser session cookie, so the summary
 * WebSocket channel accepts the same mobile Bearer access token the REST API
 * already trusts. Only the summary channel is opened to Bearer auth: the duel
 * and undercover channels stay cookie-only browser transports.
 */

export const MOBILE_SOCKET_PATH = '/ws'

/** A bearer-authenticated socket is re-verified at least this often. */
export const MOBILE_SOCKET_SESSION_MAX_MS = 30 * 60_000

/** Close code the client treats as "refresh the access token, then reconnect". */
export const MOBILE_SOCKET_REAUTH_CLOSE_CODE = 4001

export type MobileSocketIdentity = {
  userId: string
  sessionId: string
}

type MobileAccessResolver = (request: Request) => Promise<{ claims: { userId: string; sessionId: string } } | null>

export function hasBearerAuthorization(request: Request) {
  const header = request.headers.get('authorization') || ''
  return /^Bearer\s+\S+/i.test(header)
}

/**
 * Bearer auth is attempted only on the summary channel and only when the
 * request actually carries an Authorization header. An invalid Bearer token
 * never falls back to a cookie, matching `resolveRequestAuth`.
 */
export function shouldAttemptMobileSocketAuth(input: { path: string; authorization?: string | null }) {
  if (input.path !== MOBILE_SOCKET_PATH) return false
  return /^Bearer\s+\S+/i.test(input.authorization || '')
}

export async function authorizeMobileSocket(
  request: Request,
  resolveAccess: MobileAccessResolver = resolveMobileAccess as MobileAccessResolver,
): Promise<MobileSocketIdentity | null> {
  const access = await resolveAccess(request)
  if (!access) return null
  const { userId, sessionId } = access.claims
  if (!userId || !sessionId) return null
  return { userId, sessionId }
}
