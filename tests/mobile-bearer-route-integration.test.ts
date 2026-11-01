import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { SignJWT } from 'jose'

// Exercise the real route handlers and real mobile JWT/session guards against
// an in-memory fixture. No production database, storage, or network is used.
process.env.MOBILE_ACCESS_TOKEN_SECRET = randomBytes(48).toString('hex')

type Principal = { id: string; uid: number; nickname: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' }
type FeedbackFixture = {
  findUnique: (input?: { where?: Record<string, unknown> }) => Promise<unknown>
  findUniqueOrThrow: (input: { where: { id: string } }) => Promise<Record<string, unknown>>
  findMany: (input?: unknown) => Promise<unknown[]>
  create?: (input: { data: { userId: string; title: string; content: string } }) => Promise<{ id: string }>
  createMany?: (input: unknown) => Promise<{ count: number }>
}
const principals = new Map<string, Principal>([
  ['user-a', { id: 'user-a', uid: 1001, nickname: '用户甲', role: 'USER' }],
  ['admin-a', { id: 'admin-a', uid: 1002, nickname: '管理员甲', role: 'ADMIN' }],
])
const sessions = new Set(['session-user-a', 'session-admin-a'])
const writes: Array<{ userId: string; title: string; content: string }> = []
const permissionChecks: string[] = []
const exchanges: Array<{ userId: string; materialId: string; idempotencyKey: string; quantity: number }> = []
const feedbackImageUploads: string[] = []
let nextFeedbackId = 0

type PrismaFixture = Record<string, unknown> & {
  feedback: FeedbackFixture
  $transaction<T>(operation: (tx: PrismaFixture) => Promise<T>): Promise<T>
}

function principalFor(id: string) {
  return principals.get(id) || { id, uid: 0, nickname: id, role: 'USER' as const }
}

const now = new Date('2026-11-01T00:00:00.000Z')
const prismaFixture: PrismaFixture = {
  mobileAuthSession: {
    findFirst: async ({ where }: { where: { id: string; userId: string; revokedAt: null; expiresAt: { gt: Date } } }) => {
      assert.equal(where.revokedAt, null)
      assert.ok(where.expiresAt.gt instanceof Date)
      return sessions.has(where.id) && where.id === `session-${where.userId}` ? { userId: where.userId } : null
    },
  },
  user: {
    findFirst: async ({ where }: { where: { id: string } }) => {
      const user = principalFor(where.id)
      return { ...user, nicknameModerationStatus: 'APPROVED', nicknameViolationDisplay: null, avatarUrl: null, Profile: null, status: 'ACTIVE', isDeleted: false }
    },
    findUnique: async () => ({ email: null, emailVerifiedAt: null, securityQuestionRecoveryEnabled: false, UserSecurityQuestion: null }),
    findMany: async () => [],
  },
  adminPermission: {
    findMany: async ({ where }: { where: { userId: string; enabled: boolean } }) => {
      permissionChecks.push(where.userId)
      return where.userId === 'admin-a' ? [{ permissionKey: 'post_manage' }] : []
    },
  },
  board: {
    findMany: async () => [{ id: 'board-announcements', name: '公告区', slug: 'announcements', description: '', postCount: 0 }],
  },
  post: {
    findMany: async () => [],
    count: async () => 0,
  },
  rateLimitLog: {
    upsert: async () => ({ count: 1, expiresAt: new Date(Date.now() + 60_000) }),
    deleteMany: async () => ({ count: 0 }),
  },
  feedback: {
    findUnique: async () => null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const row = writes.find((item) => item.title === where.id) || writes.at(-1)
      const id = where.id
      return {
        id,
        title: row?.title || 'Android App · 问题反馈',
        type: 'BUG',
        content: row?.content || '这是用于验证登录状态的反馈内容。',
        contact: null,
        status: 'OPEN',
        adminUnread: true,
        userUnread: false,
        lastReplyAt: now,
        lastUserReplyAt: now,
        lastAdminReplyAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        moderationStatus: 'APPROVED',
        User: { id: row?.userId || 'user-a', uid: 1001, nickname: '用户甲', usernameModerationStatus: 'APPROVED', nicknameModerationStatus: 'APPROVED', nicknameViolationDisplay: null, avatarUrl: null, Profile: null },
        FeedbackAttachment: [],
        FeedbackReply: [],
      }
    },
    findMany: async () => [],
  },
  feedbackReply: {},
  feedbackAttachment: {},
  $transaction: async <T>(operation: (tx: PrismaFixture) => Promise<T>) => operation(prismaFixture),
}

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
let feedbackRoute: typeof import('../app/api/feedback/route')
let feedbackImageRoute: typeof import('../app/api/uploads/feedback-image/route')
let accountSecurityRoute: typeof import('../app/api/account/security/route')
let redemptionListRoute: typeof import('../app/api/material-redemptions/me/route')
let redemptionExchangeRoute: typeof import('../app/api/material-redemptions/[materialId]/exchange/route')
let forumDiscoverRoute: typeof import('../app/api/forum/discover/route')

before(async () => {
  (Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaFixture }
    if (request === '@/lib/auth') return {
      getCurrentUser: async () => null,
      getCurrentUserById: async (id: string) => principalFor(id),
      isAuthServiceUnavailableError: () => false,
    }
    if (request === '@/lib/account-security') return {
      getAccountSecuritySettings: async () => ({ enableSecurityQuestionRecovery: true }),
      getSecurityQuestionRecoveryAvailability: ({ globalEnabled, userEnabled, questionCount }: { globalEnabled: boolean; userEnabled: boolean; questionCount: number }) => ({ available: globalEnabled && userEnabled && questionCount > 0, reason: null }),
    }
    if (request === '@/lib/material-redemptions') return {
      listOwnMaterialRedemptionOrders: async (userId: string) => [{ id: 'order-1', ownerId: userId }],
      exchangeMaterialRedemption: async (userId: string, materialId: string, input: { idempotencyKey: string; quantity: number }) => {
        exchanges.push({ userId, materialId, ...input })
        return { duplicate: false, order: { id: 'order-2', materialId } }
      },
      MaterialRedemptionError: class MaterialRedemptionError extends Error {},
    }
    if (request === '@/lib/notification-transaction') return { safeNotificationWrite: async (operation: () => Promise<void>) => operation() }
    if (request === '@/lib/notification-write') return { createManyNotifications: async () => ({ count: 0 }) }
    if (request === '@/lib/realtime') return { emitRealtimeToAdmins: async () => undefined }
    if (request === '@/lib/site-media-storage') return {
      SiteMediaStorageError: class SiteMediaStorageError extends Error {},
      uploadSiteImage: async ({ key }: { key: string }) => {
        feedbackImageUploads.push(key)
        return `https://media.ecfc.fans/${key}`
      },
    }
    if (request === '@/lib/content-moderation') return {
      BANNED_WORD_MESSAGE: '内容暂不可用',
      CONTENT_CONTAINS_BANNED_WORD: 'CONTENT_CONTAINS_BANNED_WORD',
      checkBannedWords: async () => ({ blocked: false }),
      publicModerationText: (value: string) => value,
    }
    if (request === '@/lib/topic-activity') return { expireTopicActivityPins: async () => undefined }
    if (request === '@/lib/topic-service') return { getTrendingTopics: async () => [] }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    feedbackRoute = await import('../app/api/feedback/route')
    feedbackImageRoute = await import('../app/api/uploads/feedback-image/route')
    accountSecurityRoute = await import('../app/api/account/security/route')
    redemptionListRoute = await import('../app/api/material-redemptions/me/route')
    redemptionExchangeRoute = await import('../app/api/material-redemptions/[materialId]/exchange/route')
    forumDiscoverRoute = await import('../app/api/forum/discover/route')
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

beforeEach(() => {
  writes.length = 0
  exchanges.length = 0
  feedbackImageUploads.length = 0
  permissionChecks.length = 0
  nextFeedbackId = 0
})

async function bearer(userId: string) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ sid: `session-${userId}`, typ: 'mobile_access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('ecfc')
    .setAudience('ecfc-mobile')
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 300)
    .sign(new TextEncoder().encode(process.env.MOBILE_ACCESS_TOKEN_SECRET))
  return { authorization: `Bearer ${token}` }
}

function jsonRequest(url: string, method: string, headers: HeadersInit = {}, body?: unknown) {
  return new Request(`https://ecfc.fans${url}`, {
    method,
    headers: { ...Object.fromEntries(new Headers(headers)), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('actual feedback text route accepts an active Bearer session and binds writes to that account', async () => {
  const userId = 'user-a'
  prismaFixture.feedback.findUnique = async () => null
  prismaFixture.feedback.findUniqueOrThrow = async ({ where }: { where: { id: string } }) => {
    const created = writes.at(-1)!
    return {
      id: where.id,
      title: created.title,
      type: 'BUG',
      content: created.content,
      contact: null,
      status: 'OPEN',
      adminUnread: true,
      userUnread: false,
      lastReplyAt: now,
      lastUserReplyAt: now,
      lastAdminReplyAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
      moderationStatus: 'APPROVED',
      User: { id: userId, uid: 1001, nickname: '用户甲', usernameModerationStatus: 'APPROVED', nicknameModerationStatus: 'APPROVED', nicknameViolationDisplay: null, avatarUrl: null, Profile: null },
      FeedbackAttachment: [],
      FeedbackReply: [],
    }
  }
  prismaFixture.$transaction = async <T>(operation: (tx: PrismaFixture) => Promise<T>) => operation({
    ...prismaFixture,
    feedback: { ...prismaFixture.feedback, create: async ({ data }: { data: { userId: string; title: string; content: string } }) => {
      writes.push({ userId: data.userId, title: data.title, content: data.content })
      nextFeedbackId += 1
      return { id: `feedback-${nextFeedbackId}` }
    } },
    feedbackReply: { create: async () => ({ id: `reply-${nextFeedbackId}` }) },
    feedbackAttachment: { createMany: async () => ({ count: 0 }) },
  } as PrismaFixture)

  const response = await feedbackRoute.POST(jsonRequest('/api/feedback', 'POST', {
    ...(await bearer(userId)),
    'idempotency-key': 'mobile-feedback-key-0001',
  }, { title: '反馈标题', type: 'BUG', description: '这是一条来自移动端的真实反馈。' }))
  assert.equal(response.status, 201)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].userId, userId)
  assert.equal((await response.json()).feedback.user.id, userId)
})

test('feedback image route accepts a signed Bearer session through image processing and the isolated storage boundary', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZnoAAAAASUVORK5CYII=', 'base64')
  const form = new FormData()
  form.set('file', new File([png], 'feedback.png', { type: 'image/png' }))
  const authenticated = await feedbackImageRoute.POST(new Request('https://ecfc.fans/api/uploads/feedback-image', {
    method: 'POST',
    headers: await bearer('user-a'),
    body: form,
  }))
  assert.equal(authenticated.status, 200)
  const uploaded = await authenticated.json()
  assert.match(uploaded.url, /^https:\/\/media\.ecfc\.fans\//)
  assert.equal(uploaded.mimeType, 'image/webp')
  assert.ok(feedbackImageUploads.length >= 2, 'source and image variants use the configured storage boundary')
  assert.ok(feedbackImageUploads.every((key) => key.startsWith('feedback/user-a/')), 'uploaded image family is bound to the authenticated account')

  const anonymous = await feedbackImageRoute.POST(new Request('https://ecfc.fans/api/uploads/feedback-image', { method: 'POST', body: new FormData() }))
  assert.equal(anonymous.status, 401)
})

test('account security and Gift redemption routes use the authenticated account from the Bearer token', async () => {
  const security = await accountSecurityRoute.GET(jsonRequest('/api/account/security', 'GET', await bearer('user-a')))
  assert.equal(security.status, 200)
  assert.equal((await security.json()).emailBound, false)

  const orders = await redemptionListRoute.GET(jsonRequest('/api/material-redemptions/me', 'GET', await bearer('user-a')))
  assert.equal(orders.status, 200)
  assert.deepEqual(await orders.json(), { orders: [{ id: 'order-1', ownerId: 'user-a' }] })

  const exchange = await redemptionExchangeRoute.POST(jsonRequest('/api/material-redemptions/material-a/exchange', 'POST', await bearer('user-a'), {
    idempotencyKey: 'mobile-gift-exchange-key-1', quantity: 1,
  }), { params: Promise.resolve({ materialId: 'material-a' }) })
  assert.equal(exchange.status, 201)
  assert.deepEqual(exchanges, [{ userId: 'user-a', materialId: 'material-a', idempotencyKey: 'mobile-gift-exchange-key-1', quantity: 1 }])
})

test('announcement availability is derived from the authenticated user post_manage permission', async () => {
  const body = { mode: 'latest', limit: 10, board: 'announcements' }
  const adminResponse = await forumDiscoverRoute.POST(jsonRequest('/api/forum/discover', 'POST', await bearer('admin-a'), body))
  assert.equal(adminResponse.status, 200)
  const admin = await adminResponse.json()
  assert.equal(admin.permissions.canCreateAnnouncement, true)
  assert.equal(admin.permissions.canCreatePost, true)

  const memberResponse = await forumDiscoverRoute.POST(jsonRequest('/api/forum/discover', 'POST', await bearer('user-a'), body))
  assert.equal(memberResponse.status, 200)
  const member = await memberResponse.json()
  assert.equal(member.permissions.canCreateAnnouncement, false)
  assert.equal(member.permissions.canCreatePost, false)
  assert.ok(permissionChecks.includes('admin-a'))
  assert.ok(permissionChecks.includes('user-a'))
})
