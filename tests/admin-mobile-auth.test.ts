import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'

type TestUser = { id: string; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN'; permissions: string[] }

const users: Record<string, TestUser> = {
  admin: { id: 'admin', role: 'ADMIN', permissions: ['user_manage', 'admin_manage'] },
  limited: { id: 'limited', role: 'ADMIN', permissions: [] },
  member: { id: 'member', role: 'USER', permissions: [] },
}

let cookieUserId: string | null = null
let cookieReads = 0
let getCurrentUserByIdReads = 0

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
let requireRequestAdmin: typeof import('../lib/security').requireRequestAdmin

before(async () => {
  (Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/admin-permissions') return {
      hasAdminPermission: async (user: TestUser, permission?: string) => user.role === 'SUPER_ADMIN' || Boolean(permission && user.permissions.includes(permission)),
    }
    if (request === '@/lib/auth') return {
      getCurrentUser: async () => {
        cookieReads += 1
        return cookieUserId ? users[cookieUserId] || null : null
      },
      getCurrentUserById: async (id: string) => {
        getCurrentUserByIdReads += 1
        return users[id] || null
      },
      isAuthServiceUnavailableError: () => false,
    }
    if (request === '@/lib/mobile-auth') return {
      getBearerToken: (value: string | null) => /^Bearer\s+[^\s]+$/i.test(value || '') ? (value as string).slice(7) : null,
      resolveMobileAccess: async (req: Request) => {
        const value = req.headers.get('authorization') || ''
        const id = /^Bearer\s+([^\s]+)$/i.exec(value)?.[1]
        return id && users[id] ? { claims: { userId: id } } : null
      },
      isMobileAuthConfigurationError: () => false,
    }
    if (request === '@/lib/mobile-beta') return { resolveMobileBetaAccess: async () => null }
    if (request === '@/lib/prisma') return { prisma: { mobileAuthSession: { findFirst: async () => ({ userId: 'fixture' }) } } }
    if (request === '@/lib/client-ip') return { getClientIp: () => '127.0.0.1' }
    if (request === '@/lib/content-moderation') return { containsBannedWord: () => false, getEnabledBannedWords: async () => [] }
    if (request === '@/lib/text') return { sanitizeTextPreservingLength: (value: string) => value }
    if (request === '@/lib/fail-closed-rate-limit') return { consumeRateLimitFailClosed: async () => ({ allowed: true }) }
    if (request === '@/lib/request-metadata') return { normalizeStoredUserAgent: (value: string) => value }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    ({ requireRequestAdmin } = await import('../lib/security'))
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

beforeEach(() => {
  cookieUserId = null
  cookieReads = 0
  getCurrentUserByIdReads = 0
})

function request(authorization?: string) {
  return new Request('https://ecfc.fans/api/admin/users', {
    headers: { ...(authorization ? { authorization } : {}), cookie: 'eason_session=valid-browser-session' },
  })
}

test('invalid Bearer does not fall back to a valid Web Cookie', async () => {
  cookieUserId = 'admin'
  const result = await requireRequestAdmin(request('Bearer invalid'), 'user_manage')
  assert.equal(result.user, null)
  assert.equal(result.response?.status, 401)
  assert.equal(cookieReads, 0)
})

test('anonymous Mobile request is 401 and never resolves an admin user', async () => {
  const result = await requireRequestAdmin(request(), 'user_manage')
  assert.equal(result.user, null)
  assert.equal(result.response?.status, 401)
})

test('authenticated non-admin user receives 403', async () => {
  const result = await requireRequestAdmin(request('Bearer member'), 'user_manage')
  assert.equal(result.user, null)
  assert.equal(result.response?.status, 403)
  assert.equal(getCurrentUserByIdReads, 1)
})

test('admin without the requested permission receives 403', async () => {
  const result = await requireRequestAdmin(request('Bearer limited'), 'user_manage')
  assert.equal(result.user, null)
  assert.equal(result.response?.status, 403)
})

test('permitted Admin Bearer and Web Cookie sessions remain supported', async () => {
  const bearerResult = await requireRequestAdmin(request('Bearer admin'), 'user_manage')
  assert.equal(bearerResult.user?.id, 'admin')

  cookieUserId = 'admin'
  const cookieResult = await requireRequestAdmin(request(), 'user_manage')
  assert.equal(cookieResult.user?.id, 'admin')
  assert.equal(cookieReads, 1)
})
