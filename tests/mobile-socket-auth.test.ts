import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MOBILE_SOCKET_PATH,
  MOBILE_SOCKET_REAUTH_CLOSE_CODE,
  MOBILE_SOCKET_SESSION_MAX_MS,
  authorizeMobileSocket,
  hasBearerAuthorization,
  shouldAttemptMobileSocketAuth,
} from '../lib/mobile-socket-auth'

const read = (path: string) => readFileSync(path, 'utf8')

function requestWith(headers: Record<string, string>) {
  return new Request('https://ecfc.fans/ws', { headers })
}

test('bearer auth is only attempted on the summary channel', () => {
  assert.equal(MOBILE_SOCKET_PATH, '/ws')
  assert.equal(shouldAttemptMobileSocketAuth({ path: '/ws', authorization: 'Bearer token-1' }), true)
  assert.equal(shouldAttemptMobileSocketAuth({ path: '/ws', authorization: 'bearer token-1' }), true)
  assert.equal(shouldAttemptMobileSocketAuth({ path: '/ws', authorization: null }), false)
  assert.equal(shouldAttemptMobileSocketAuth({ path: '/ws', authorization: 'Basic abc' }), false)
  assert.equal(shouldAttemptMobileSocketAuth({ path: '/ws/duel', authorization: 'Bearer token-1' }), false)
  assert.equal(shouldAttemptMobileSocketAuth({ path: '/ws/undercover', authorization: 'Bearer token-1' }), false)
  assert.equal(shouldAttemptMobileSocketAuth({ path: '/ws/undercover-chat', authorization: 'Bearer token-1' }), false)
})

test('hasBearerAuthorization reads the raw header without trusting other schemes', () => {
  assert.equal(hasBearerAuthorization(requestWith({ authorization: 'Bearer abc.def.ghi' })), true)
  assert.equal(hasBearerAuthorization(requestWith({ authorization: 'Token abc' })), false)
  assert.equal(hasBearerAuthorization(requestWith({})), false)
})

test('authorizeMobileSocket returns the session identity and rejects invalid tokens', async () => {
  const valid = await authorizeMobileSocket(requestWith({ authorization: 'Bearer ok' }), async () => ({
    claims: { userId: 'user-1', sessionId: 'session-1' },
  }))
  assert.deepEqual(valid, { userId: 'user-1', sessionId: 'session-1' })

  const rejected = await authorizeMobileSocket(requestWith({ authorization: 'Bearer bad' }), async () => null)
  assert.equal(rejected, null)

  // A resolver that fails the session check must never produce a user.
  const partial = await authorizeMobileSocket(requestWith({ authorization: 'Bearer partial' }), async () => ({
    claims: { userId: '', sessionId: '' },
  }))
  assert.equal(partial, null)
})

test('native sockets cannot live forever: a re-authorization close code exists', () => {
  assert.equal(MOBILE_SOCKET_REAUTH_CLOSE_CODE, 4001)
  assert.equal(MOBILE_SOCKET_SESSION_MAX_MS, 30 * 60_000)
})

test('the production server wires bearer auth into the upgrade path only for /ws', () => {
  const server = read('server.ts')
  assert.match(server, /import \{[\s\S]*?authorizeMobileSocket,[\s\S]*?\} from '\.\/lib\/mobile-socket-auth'/)
  assert.match(server, /const mobileAttempted = shouldAttemptMobileSocketAuth\(\{[\s\S]*?path: url\.pathname,[\s\S]*?authorization: firstHeader\(request\.headers\.authorization\),/)
  assert.match(server, /if \(mobileAttempted\) \{[\s\S]*?authorizeMobileSocket\(webRequest\)/)
  assert.match(server, /rejectUpgrade\(socket, 401, 'Unauthorized', url\.pathname\)[\s\S]*?return null[\s\S]*?\}/)
  assert.match(server, /mobileSessionId: mobileIdentity\.sessionId/)
  assert.match(server, /socket\.close\(MOBILE_SOCKET_REAUTH_CLOSE_CODE, 'session-refresh'\)/)
  assert.match(server, /if \(reauthTimer\) clearTimeout\(reauthTimer\)/)
  // Cookie sessions keep the Origin/CSRF gate; the bearer path cannot be
  // driven by another site, so it authenticates on the token alone.
  assert.match(server, /if \(!mobileAttempted && !hasValidRequestOrigin\(webRequest\)\)/)
  // The mobile bearer path must stay scoped to the summary channel.
  assert.match(server, /channel: 'summary' as const,[\s\S]*?mobileSessionId/)
})
