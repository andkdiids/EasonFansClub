import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { SignJWT } from 'jose'

process.env.MOBILE_ACCESS_TOKEN_SECRET = randomBytes(48).toString('hex')

const observed = {
  pageUsers: [] as (string | undefined)[],
  historyUsers: [] as string[],
  drawUsers: [] as string[],
  recycleUsers: [] as string[],
  recycleAllUsers: [] as string[],
}
let webCookieUserId: string | null = null
const revokedUserIds = new Set<string>()

function sessionUser(id: string) {
  return { id, uid: 42, username: id, nickname: id, role: 'USER' as const }
}

const prismaFixture = {
  mobileAuthSession: {
    findFirst: async ({ where }: { where: { id: string; userId: string; revokedAt: null; expiresAt: { gt: Date } } }) => {
      assert.equal(where.id, `session-${where.userId}`)
      assert.equal(where.revokedAt, null)
      assert.ok(where.expiresAt.gt instanceof Date)
      return revokedUserIds.has(where.userId) ? null : { userId: where.userId }
    },
  },
  user: {
    findFirst: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      uid: 42,
      nickname: where.id,
      nicknameModerationStatus: 'APPROVED',
      nicknameViolationDisplay: null,
      avatarUrl: null,
      Profile: null,
    }),
  },
}

const pageData = {
  moduleName: '天使的礼物',
  moduleSubtitle: '活动记录',
  isAuthenticated: true,
  user: { id: 'mobile-user-a', balance: 127, todayCount: 1, totalCount: 4 },
  campaign: {
    id: 'campaign-1', title: '本期主题', subtitle: null, description: null, status: 'ACTIVE',
    startsAt: null, endsAt: null, drawCost: 27, dailyDrawLimit: null, totalDrawLimit: null,
    prizePoolValid: true,
    collection: {
      visibleBadges: [], visibleOwnedCount: 0, visibleTotalCount: 0,
      collectionComplete: false, hiddenRevealedCount: 0, collectionRewardRevealed: false,
    },
  },
  campaignOptions: [{ id: 'campaign-1', title: '本期主题', status: 'ACTIVE', startsAt: null, endsAt: null, drawCost: 27, visualUrl: null }],
  upcomingCampaign: null,
  history: [],
  historyHasMore: false,
}

const draw = {
  id: 'draw-1', campaignId: 'campaign-1', campaignTitle: '本期主题', drawCost: 27,
  prizeType: 'POINTS', prizeName: '药房找零', badge: null, rewardAmount: 5,
  resultType: 'POINTS_REWARD', isNewBadge: false, isDuplicate: false, duplicateQuantity: 0,
  balanceBefore: 127, balanceAfter: 105, drawAt: '2026-10-26T00:00:00.000Z',
}

const pharmacyModule = {
  PharmacyError: class PharmacyError extends Error {
    constructor(readonly code: string, message: string, readonly status = 400, readonly details?: unknown) { super(message) }
  },
  getPharmacyPageData: async (userId: string) => {
    observed.pageUsers.push(userId)
    return pageData
  },
  getPharmacyHistoryPage: async (userId: string) => {
    observed.historyUsers.push(userId)
    return { items: [], page: 1, pageSize: 10, hasMore: false }
  },
  executePharmacyDraws: async (input: { userId: string }) => {
    observed.drawUsers.push(input.userId)
    return { duplicateRequest: false, draws: [draw], draw, balance: 105, duplicateTotal: 0, duplicateRequired: null }
  },
  recyclePharmacyDuplicates: async (input: { userId: string }) => {
    observed.recycleUsers.push(input.userId)
    return { recycle: { campaignId: 'campaign-1' }, balance: 127 }
  },
  recycleAllPharmacyDuplicates: async (input: { userId: string }) => {
    observed.recycleAllUsers.push(input.userId)
    return { recycle: { campaignId: 'campaign-1' }, balance: 127 }
  },
}

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
let pageRoute: typeof import('../app/api/angel-gift/route')
let historyRoute: typeof import('../app/api/angel-gift/history/route')
let recycleRoute: typeof import('../app/api/angel-gift/recycle/route')
let recycleAllRoute: typeof import('../app/api/angel-gift/recycle/all/route')

before(async () => {
  (Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaFixture }
    if (request === '@/lib/auth') return {
      getCurrentUser: async () => webCookieUserId ? sessionUser(webCookieUserId) : null,
      getCurrentUserById: async (id: string) => sessionUser(id),
      isAuthServiceUnavailableError: () => false,
    }
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => false }
    if (request === '@/lib/pharmacy') return pharmacyModule
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    ;[pageRoute, historyRoute, recycleRoute, recycleAllRoute] = await Promise.all([
      import('../app/api/angel-gift/route'),
      import('../app/api/angel-gift/history/route'),
      import('../app/api/angel-gift/recycle/route'),
      import('../app/api/angel-gift/recycle/all/route'),
    ])
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

beforeEach(() => {
  for (const values of Object.values(observed)) values.length = 0
  webCookieUserId = null
  revokedUserIds.clear()
})

async function bearer(userId: string, lifetimeSeconds = 300) {
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ sid: `session-${userId}`, typ: 'mobile_access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('ecfc')
    .setAudience('ecfc-mobile')
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(new TextEncoder().encode(process.env.MOBILE_ACCESS_TOKEN_SECRET))
  return { authorization: `Bearer ${token}` }
}

function request(path: string, method: 'GET' | 'POST', headers: HeadersInit = {}, body?: unknown) {
  const requestHeaders = new Headers(headers)
  if (body !== undefined) requestHeaders.set('content-type', 'application/json')
  return new Request(`https://ecfc.fans${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('public Angel Gift status stays readable while private endpoints reject anonymous and invalid Bearer tokens', async () => {
  assert.equal((await pageRoute.GET(request('/api/angel-gift', 'GET'))).status, 200)
  const endpoints = [
    () => historyRoute.GET(request('/api/angel-gift/history?campaignId=campaign-1', 'GET')),
    () => pageRoute.POST(request('/api/angel-gift', 'POST', {}, { campaignId: 'campaign-1', idempotencyKey: 'anon' })),
    () => recycleRoute.POST(request('/api/angel-gift/recycle', 'POST', {}, { campaignId: 'campaign-1', idempotencyKey: 'anon' })),
    () => recycleAllRoute.POST(request('/api/angel-gift/recycle/all', 'POST', {}, { idempotencyKey: 'anon' })),
  ]
  for (const invoke of endpoints) assert.equal((await invoke()).status, 401)

  webCookieUserId = 'cookie-user'
  assert.equal((await pageRoute.GET(request('/api/angel-gift', 'GET', { authorization: 'Bearer invalid' }))).status, 401)
  assert.equal((await historyRoute.GET(request('/api/angel-gift/history?campaignId=campaign-1', 'GET', await bearer('expired-user', -60)))).status, 401)
  revokedUserIds.add('revoked-user')
  assert.equal((await pageRoute.GET(request('/api/angel-gift', 'GET', await bearer('revoked-user')))).status, 401)
  assert.equal((await pageRoute.GET(request('/api/angel-gift', 'GET', { authorization: 'Bearer\tinvalid' }))).status, 401)
  assert.deepEqual(observed.pageUsers, [undefined])
  assert.deepEqual(observed.historyUsers, [])
  assert.deepEqual(observed.drawUsers, [])
  assert.deepEqual(observed.recycleUsers, [])
  assert.deepEqual(observed.recycleAllUsers, [])
})

test('all Angel Gift route handlers preserve the Web Cookie session path', async () => {
  webCookieUserId = 'web-cookie-user'
  const cookie = { cookie: 'eason_session=fixture-cookie' }
  const responses = [
    await pageRoute.GET(request('/api/angel-gift', 'GET', cookie)),
    await historyRoute.GET(request('/api/angel-gift/history?campaignId=campaign-1', 'GET', cookie)),
    await pageRoute.POST(request('/api/angel-gift', 'POST', cookie, { campaignId: 'campaign-1', idempotencyKey: 'web-draw', drawCount: 1 })),
    await recycleRoute.POST(request('/api/angel-gift/recycle', 'POST', cookie, { campaignId: 'campaign-1', idempotencyKey: 'web-recycle' })),
    await recycleAllRoute.POST(request('/api/angel-gift/recycle/all', 'POST', cookie, { idempotencyKey: 'web-recycle-all' })),
  ]
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200])
  assert.deepEqual(observed.pageUsers, ['web-cookie-user', 'web-cookie-user', 'web-cookie-user', 'web-cookie-user'])
  assert.deepEqual(observed.historyUsers, ['web-cookie-user'])
  assert.deepEqual(observed.drawUsers, ['web-cookie-user'])
  assert.deepEqual(observed.recycleUsers, ['web-cookie-user'])
  assert.deepEqual(observed.recycleAllUsers, ['web-cookie-user'])
})

test('Mobile Bearer owns the user identity for reads and writes; request userId never reaches business services', async () => {
  const headers = await bearer('mobile-user-a')
  const pageResponse = await pageRoute.GET(request('/api/angel-gift?campaignId=campaign-1&userId=mobile-user-b', 'GET', headers))
  const historyResponse = await historyRoute.GET(request('/api/angel-gift/history?campaignId=campaign-1&page=2&userId=mobile-user-b', 'GET', headers))
  const drawResponse = await pageRoute.POST(request('/api/angel-gift', 'POST', headers, {
    userId: 'mobile-user-b', campaignId: 'campaign-1', idempotencyKey: 'mobile-draw', drawCount: 1,
  }))
  const recycleResponse = await recycleRoute.POST(request('/api/angel-gift/recycle', 'POST', headers, {
    userId: 'mobile-user-b', campaignId: 'campaign-1', idempotencyKey: 'mobile-recycle',
  }))
  const recycleAllResponse = await recycleAllRoute.POST(request('/api/angel-gift/recycle/all', 'POST', headers, {
    userId: 'mobile-user-b', idempotencyKey: 'mobile-recycle-all',
  }))

  assert.deepEqual([pageResponse.status, historyResponse.status, drawResponse.status, recycleResponse.status, recycleAllResponse.status], [200, 200, 200, 200, 200])
  assert.deepEqual(observed.pageUsers, ['mobile-user-a', 'mobile-user-a', 'mobile-user-a', 'mobile-user-a'])
  assert.deepEqual(observed.historyUsers, ['mobile-user-a'])
  assert.deepEqual(observed.drawUsers, ['mobile-user-a'])
  assert.deepEqual(observed.recycleUsers, ['mobile-user-a'])
  assert.deepEqual(observed.recycleAllUsers, ['mobile-user-a'])
  assert.match(pageResponse.headers.get('vary') || '', /cookie/i)
  assert.match(pageResponse.headers.get('vary') || '', /authorization/i)
  assert.match(historyResponse.headers.get('vary') || '', /authorization/i)
})

test('Bearer identity takes precedence over a different Cookie identity', async () => {
  webCookieUserId = 'cookie-user-b'
  const response = await pageRoute.GET(request('/api/angel-gift', 'GET', await bearer('mobile-user-a')))
  assert.equal(response.status, 200)
  assert.deepEqual(observed.pageUsers, ['mobile-user-a'])
})
