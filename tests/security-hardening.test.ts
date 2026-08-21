import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isCrossSiteRequest } from '../lib/csrf'
import { classifySessionAuthority } from '../lib/client-auth'

const read = (path: string) => readFileSync(path, 'utf8')

test('CSRF only rejects explicit cross-site browser writes', () => {
  const sameOrigin = new Request('https://ecfc.fans/api/posts', {
    method: 'POST',
    headers: { Origin: 'https://ecfc.fans', 'Sec-Fetch-Site': 'same-origin' },
  })
  const crossSite = new Request('https://ecfc.fans/api/posts', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
  })
  const nativeClient = new Request('https://ecfc.fans/api/posts', { method: 'POST' })

  assert.equal(isCrossSiteRequest(sameOrigin), false)
  assert.equal(isCrossSiteRequest(crossSite), true)
  assert.equal(isCrossSiteRequest(nativeClient), false)
})

test('security middleware and rate limits are centralized', () => {
  const middleware = read('middleware.ts')
  const security = read('lib/security.ts')
  const login = read('app/api/auth/login/route.ts')
  assert.match(middleware, /CSRF_BLOCKED/)
  assert.match(middleware, /isStateChangingMethod\(request\.method\)/)
  assert.match(security, /rateLimitLog\.upsert/)
  assert.match(security, /count: \{ increment: 1 \}/)
  assert.match(security, /Retry-After/)
  assert.match(security, /api:\$\{request\.method\.toUpperCase\(\)\}/)
  assert.match(login, /action: 'LOGIN_FAILED'/)
  assert.doesNotMatch(login, /console\.(log|warn|error)\([^\n]*password/)
})

test('current-user APIs use explicit minimized DTOs', () => {
  const profile = read('app/api/users/me/route.ts')
  const session = read('app/api/auth/me/route.ts')
  assert.match(profile, /Profile: \{\s*select:/)
  assert.doesNotMatch(profile, /Profile:\s*true/)
  assert.doesNotMatch(profile, /role:\s*true/)
  assert.doesNotMatch(profile, /points:\s*true/)
  assert.doesNotMatch(profile, /ipRegion:\s*true/)
  assert.doesNotMatch(profile, /\.\.\.user/)
  assert.match(session, /session = user\s*\n\s*\? \{ id: user\.id, uid: user\.uid, nickname: user\.nickname, avatarUrl: user\.avatarUrl \}/)
  assert.doesNotMatch(session, /role: user\.role|experience: user\.experience|canPlayFullMusic/)
})

test('private resources are owner-scoped and check-in is race-safe', () => {
  const messages = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  const notifications = read('app/api/notifications/route.ts')
  const checkin = read('app/api/checkin/route.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(messages, /id: conversationId, ConversationParticipant: \{ some: \{ userId, isDeleted: false \} \}/)
  assert.match(messages, /senderId: user\.id/)
  assert.match(notifications, /recipientId: guard\.user\.id/)
  assert.match(schema, /@@unique\(\[userId, checkinDateKey\]\)/)
  assert.match(checkin, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(checkin, /error\.code === 'P2002'/)
  assert.match(checkin, /getRandomCheckInPoints\(\)/)
  assert.match(checkin, /getRandomCheckInExperience\(\)/)
})

test('search, uploads, admin routes and realtime have abuse boundaries', () => {
  const search = read('app/api/search/route.ts')
  const uploads = read('app/api/uploads/content-image/route.ts')
  const admin = read('app/api/admin/admins/route.ts')
  const server = read('server.ts')
  assert.match(search, /keyword\.length < 2/)
  assert.match(search, /enforceApiRateLimit/)
  assert.doesNotMatch(search, /phone: true|email: true|experience: true|lastActiveAt: true/)
  assert.match(uploads, /sharp\(buffer/)
  assert.match(uploads, /randomUUID\(\)/)
  assert.match(admin, /requireAdmin\('admin_manage'\)/)
  assert.match(server, /maxPayload = 4096/)
  assert.match(server, /maxConnectionsPerUser = 8/)
  assert.match(server, /heartbeatIntervalMs = 30_000/)
})

test('client auth keeps 403/429/5xx as non-logout states', () => {
  assert.equal(classifySessionAuthority(403, { user: null }), 'unknown')
  assert.equal(classifySessionAuthority(429, { user: null }), 'unknown')
  assert.equal(classifySessionAuthority(500, { user: null }), 'unknown')
  assert.equal(classifySessionAuthority(401, { user: null }), 'invalid')
})
