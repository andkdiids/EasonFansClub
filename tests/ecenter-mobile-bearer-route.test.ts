import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, test } from 'node:test'
import { SignJWT } from 'jose'

const accessSecret = 'ecenter-route-test-mobile-secret-32-bytes'
process.env.MOBILE_ACCESS_TOKEN_SECRET = accessSecret

const observed = {
  editorUserIds: [] as string[],
  deletedUserIds: [] as string[],
  createdPreferenceUserIds: [] as string[],
}

let webCookieUserId: string | null = null
const sessionUser = (id: string) => ({
  id,
  uid: 90210,
  username: id,
  nickname: id,
  role: 'USER' as const,
})

const feature = {
  featureKey: 'HOME',
  label: '首页',
  href: '/',
  icon: 'home',
  title: '首页',
  defaultSortOrder: 0,
  defaultEnabled: true,
  sortOrder: 0,
  isEnabled: true,
  isManageable: true,
  showInCenter: true,
  showInQuickNavigation: true,
  showInDesktopSidebar: true,
  sidebarSection: 'main',
  mobile: true,
  editable: true,
  hideable: true,
  activePrefixes: ['/'],
  hidden: false,
  showsUnread: false,
  requiresAdmin: false,
}

const txStub = {
  userCenterShortcutPreference: {
    deleteMany: async ({ where }: { where: { userId: string } }) => {
      observed.deletedUserIds.push(where.userId)
      return { count: 0 }
    },
    createMany: async ({ data }: { data: Array<{ userId: string }> }) => {
      observed.createdPreferenceUserIds.push(...data.map((item) => item.userId))
      return { count: data.length }
    },
  },
}

const prismaStub = {
  mobileAuthSession: {
    findFirst: async ({ where }: { where: { userId: string } }) => ({ userId: where.userId }),
  },
  user: {
    findFirst: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      uid: 90210,
      nickname: where.id,
      nicknameModerationStatus: 'APPROVED',
      nicknameViolationDisplay: null,
      avatarUrl: null,
      Profile: null,
    }),
  },
  $transaction: async <T>(operation: (tx: typeof txStub) => Promise<T>) => operation(txStub),
}

const featureModule = {
  getEcenterFeatureEditorState: async (userId: string) => {
    observed.editorUserIds.push(userId)
    return [feature]
  },
  validateEcenterShortcutPreferences: (value: unknown) => Array.isArray(value)
    ? { preferences: value as Array<{ itemKey: string; sortOrder: number; hidden: boolean }> }
    : { error: 'invalid preferences' },
}

const authModule = {
  getCurrentUser: async () => webCookieUserId ? sessionUser(webCookieUserId) : null,
  getCurrentUserById: async (id: string) => sessionUser(id),
  isAuthServiceUnavailableError: () => false,
}

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
let route: typeof import('../app/api/users/me/e-center-preferences/route')

before(async () => {
  (Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaStub }
    if (request === '@/lib/auth') return authModule
    if (request === '@/lib/ecenter-features') return featureModule
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => false }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    route = await import('../app/api/users/me/e-center-preferences/route')
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})

async function accessToken(userId: string, expiresAtSeconds: number) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sid: `session-${userId}`, typ: 'mobile_access', jti: `jti-${userId}` })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('ecfc')
    .setAudience('ecfc-mobile')
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(accessSecret))
}

function makeRequest(method: 'GET' | 'PATCH', headers: HeadersInit = {}, body?: unknown) {
  return new Request('https://ecfc.fans/api/users/me/e-center-preferences', {
    method,
    headers: { ...Object.fromEntries(new Headers(headers)), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('Ecenter GET 以有效 Bearer 身份读取原 features DTO', async () => {
  const token = await accessToken('mobile-user-17', Math.floor(Date.now() / 1000) + 300)
  const response = await route.GET(makeRequest('GET', { authorization: `Bearer ${token}` }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { features: [feature] })
  assert.equal(observed.editorUserIds.at(-1), 'mobile-user-17')
})

test('Ecenter PATCH 以 Bearer subject 写入，忽略 body 中伪造的 userId', async () => {
  const token = await accessToken('mobile-user-23', Math.floor(Date.now() / 1000) + 300)
  const response = await route.PATCH(makeRequest('PATCH', { authorization: `Bearer ${token}` }, {
    userId: 'spoofed-user',
    preferences: [{ itemKey: 'HOME', sortOrder: 0, hidden: false }],
  }))
  assert.equal(response.status, 200)
  assert.equal(observed.deletedUserIds.at(-1), 'mobile-user-23')
  assert.deepEqual(observed.createdPreferenceUserIds.slice(-1), ['mobile-user-23'])
})

test('Ecenter invalid/expired Bearer 与匿名 GET/PATCH 均返回 401', async () => {
  const invalid = await route.GET(makeRequest('GET', { authorization: 'Bearer not-a-valid-token' }))
  assert.equal(invalid.status, 401)

  const expiredToken = await accessToken('expired-user', Math.floor(Date.now() / 1000) - 60)
  const expired = await route.PATCH(makeRequest('PATCH', { authorization: `Bearer ${expiredToken}` }, { reset: true }))
  assert.equal(expired.status, 401)

  assert.equal((await route.GET(makeRequest('GET'))).status, 401)
  assert.equal((await route.PATCH(makeRequest('PATCH', {}, { reset: true }))).status, 401)
})

test('Ecenter Web Cookie 身份仍通过 request-aware resolver 完成 GET/PATCH', async () => {
  webCookieUserId = 'web-cookie-user'
  try {
    const cookie = { cookie: 'eason_session=web-session' }
    const get = await route.GET(makeRequest('GET', cookie))
    assert.equal(get.status, 200)
    const patch = await route.PATCH(makeRequest('PATCH', cookie, { reset: true }))
    assert.equal(patch.status, 200)
    assert.equal(observed.deletedUserIds.at(-1), 'web-cookie-user')
  } finally {
    webCookieUserId = null
  }
})
