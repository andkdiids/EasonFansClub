import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { SignJWT } from 'jose'

process.env.MOBILE_ACCESS_TOKEN_SECRET = randomBytes(48).toString('hex')

let webCookieUserId: string | null = null
const followedPairs = new Set<string>()
const friendshipPairs = new Set<string>()
let blocked = false
let targetLookups = 0
let missingTargetId: string | null = null

function pair(a: string, b: string) { return `${a}:${b}` }
function sessionUser(id: string) { return { id, uid: 42, username: id, nickname: id, role: 'USER' as const } }

const prismaFixture = {
  mobileAuthSession: {
    findFirst: async ({ where }: { where: { id: string; userId: string; revokedAt: null; expiresAt: { gt: Date } } }) => {
      assert.equal(where.id, `session-${where.userId}`)
      assert.equal(where.revokedAt, null)
      assert.ok(where.expiresAt.gt instanceof Date)
      return { userId: where.userId }
    },
  },
  user: {
    findFirst: async ({ where }: { where: { id: string } }) => {
      targetLookups += 1
      if (where.id === missingTargetId) return null
      return {
        id: where.id,
        uid: 42,
        nickname: where.id,
        nicknameModerationStatus: 'APPROVED',
        nicknameViolationDisplay: null,
        avatarUrl: null,
        Profile: null,
      }
    },
  },
  follow: {
    findUnique: async ({ where }: { where: { followerId_followingId: { followerId: string; followingId: string } } }) => {
      const { followerId, followingId } = where.followerId_followingId
      return followedPairs.has(pair(followerId, followingId)) ? { id: pair(followerId, followingId) } : null
    },
    count: async ({ where }: { where: { followerId?: string; followingId?: string } }) =>
      where.followingId === 'empty-target' || where.followerId === 'empty-target'
        ? 0
        : where.followingId === 'target' ? 12 : where.followerId === 'target' ? 9 : 0,
  },
  block: {
    findFirst: async () => blocked ? { id: 'block-1' } : null,
  },
  friendship: {
    findUnique: async ({ where }: { where: { userAId_userBId: { userAId: string; userBId: string } } }) => {
      const { userAId, userBId } = where.userAId_userBId
      return friendshipPairs.has(pair(userAId, userBId)) ? { id: 'friendship-1' } : null
    },
  },
}

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
let route: typeof import('../app/api/users/[userId]/relationship/route')

before(async () => {
  (Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaFixture }
    if (request === '@/lib/auth') return {
      getCurrentUser: async () => webCookieUserId ? sessionUser(webCookieUserId) : null,
      getCurrentUserById: async (id: string) => sessionUser(id),
      isAuthServiceUnavailableError: () => false,
    }
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => false }
    return originalLoad.call(this, request, parent, isMain)
  }
  try { route = await import('../app/api/users/[userId]/relationship/route') }
  finally { (Module as unknown as { _load: typeof originalLoad })._load = originalLoad }
})

beforeEach(() => {
  webCookieUserId = null
  followedPairs.clear()
  friendshipPairs.clear()
  blocked = false
  targetLookups = 0
  missingTargetId = null
})

async function bearer(userId: string) {
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ sid: `session-${userId}`, typ: 'mobile_access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('ecfc').setAudience('ecfc-mobile')
    .setSubject(userId).setIssuedAt(now).setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(process.env.MOBILE_ACCESS_TOKEN_SECRET))
  return { authorization: `Bearer ${token}` }
}

function request(headers: HeadersInit = {}) {
  return new Request('https://ecfc.fans/api/users/target/relationship', { headers })
}

function context(userId = 'target') { return { params: Promise.resolve({ userId }) } }

test('relationship endpoint rejects anonymous and malformed Bearer before profile lookup', async () => {
  assert.equal((await route.GET(request(), context())).status, 401)
  webCookieUserId = 'cookie-viewer'
  assert.equal((await route.GET(request({ authorization: 'Bearer invalid' }), context())).status, 401)
  assert.equal(targetLookups, 0)
})

test('valid Mobile Bearer returns real relationship and counts from the authenticated viewer', async () => {
  followedPairs.add(pair('viewer-a', 'target'))
  followedPairs.add(pair('target', 'viewer-a'))
  friendshipPairs.add(pair('target', 'viewer-a'))
  const response = await route.GET(request(await bearer('viewer-a')), context())
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') || '', /private, no-store/)
  assert.match(response.headers.get('vary') || '', /authorization/i)
  assert.deepEqual(await response.json(), {
    relationship: { state: 'MUTUAL', viewerFollowsTarget: true, targetFollowsViewer: true, blocked: false, canMessage: true },
    counts: { followers: 12, following: 9 },
  })
})

test('Web Cookie remains supported and blocked users cannot message', async () => {
  webCookieUserId = 'web-viewer'
  blocked = true
  const response = await route.GET(request({ cookie: 'eason_session=fixture' }), context())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.relationship.state, 'BLOCKED')
  assert.equal(payload.relationship.canMessage, false)
})

test('self profile is authenticated and reports the SELF relationship state', async () => {
  const response = await route.GET(request(await bearer('target')), context('target'))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.relationship, {
    state: 'SELF',
    viewerFollowsTarget: false,
    targetFollowsViewer: false,
    blocked: false,
    canMessage: false,
  })
})

test('non-followed profiles and zero-count profiles return real zero values', async () => {
  const response = await route.GET(request(await bearer('viewer-a')), context('empty-target'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    relationship: { state: 'NONE', viewerFollowsTarget: false, targetFollowsViewer: false, blocked: false, canMessage: false },
    counts: { followers: 0, following: 0 },
  })
})

test('one-way follow states distinguish followed from following', async () => {
  followedPairs.add(pair('viewer-a', 'target'))
  const following = await route.GET(request(await bearer('viewer-a')), context())
  assert.equal((await following.json()).relationship.state, 'FOLLOWING')

  followedPairs.clear()
  followedPairs.add(pair('target', 'viewer-a'))
  const followed = await route.GET(request(await bearer('viewer-a')), context())
  assert.equal((await followed.json()).relationship.state, 'FOLLOWED_BY')
})

test('missing or invisible target does not expose relationship counts', async () => {
  missingTargetId = 'missing-target'
  const response = await route.GET(request(await bearer('viewer-a')), context('missing-target'))
  const responseBody = await response.clone().json()
  assert.equal(response.status, 404, `unexpected response: ${response.status} ${JSON.stringify(responseBody)}; lookups=${targetLookups}`)
  assert.deepEqual(await response.json(), { message: '用户不存在或不可见' })
})
