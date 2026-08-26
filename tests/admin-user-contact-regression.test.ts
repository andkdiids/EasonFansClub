import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ADMIN_USER_FIELD_MAP, buildAdminUserContactUpdate, updateAdminUserContact } from '../lib/admin-user-contact'
import { getContactLoginWhere } from '../lib/users'
import { normalizeUserContactPatch } from '../lib/user-contact'
import { buildAuditReport, findInternalAccountPhoneMatches } from '../scripts/audit-internal-account-phone'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const originalUser = {
  email: 'old@example.com',
  phone: '+8613812345678',
}

test('后台修改手机号只更新 User.phone，内部账号保持独立', () => {
  const patch = normalizeUserContactPatch({ phone: '139 0013 9000', phoneCountry: 'CN' })
  const built = buildAdminUserContactUpdate(originalUser, patch)

  assert.deepEqual(built.data, { phone: '+8613900139000', phoneVerifiedAt: null })
  assert.equal(Object.hasOwn(built.data, 'username'), false)
  assert.equal(Object.hasOwn(built.data, 'nickname'), false)
  assert.equal(ADMIN_USER_FIELD_MAP.internalAccount, 'username')
  assert.equal(ADMIN_USER_FIELD_MAP.phone, 'phone')
  assert.equal(built.emailChanged, false)
  assert.equal(built.phoneChanged, true)
})

test('后台修改邮箱只更新 User.email，不携带手机号或内部账号字段', () => {
  const patch = normalizeUserContactPatch({ email: ' New@Example.com ' })
  const built = buildAdminUserContactUpdate(originalUser, patch)

  assert.deepEqual(built.data, {
    email: 'new@example.com',
    emailVerifiedAt: null,
    verificationStatus: 'PENDING',
  })
  assert.equal(Object.hasOwn(built.data, 'phone'), false)
  assert.equal(Object.hasOwn(built.data, 'username'), false)
  assert.equal(ADMIN_USER_FIELD_MAP.email, 'email')
})

test('手机号和邮箱登录查询分别命中 User.phone 与 User.email', () => {
  assert.deepEqual(getContactLoginWhere('phone', '13900139000', 'CN'), {
    phone: { in: ['+8613900139000', '13900139000'] },
  })
  assert.deepEqual(getContactLoginWhere('email', ' New@Example.com '), { email: 'new@example.com' })
})

test('admin contact service 更新 phone/email 后，username 保持不变且新联系方式可被登录查询命中', async () => {
  const state = {
    id: 'u1',
    uid: 1,
    username: '18926989012',
    email: 'old@example.com' as string | null,
    phone: '+8613812345678' as string | null,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z') as Date | null,
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z') as Date | null,
    verificationStatus: 'VERIFIED' as const,
  }
  const transaction = {
    $queryRaw: async () => [{ acquired: 1 }],
    user: {
      findUnique: async () => ({ ...state, updatedAt: new Date() }),
      findFirst: async ({ where }: { where: { OR?: Array<Record<string, string>> } }) => {
        const filters = where.OR || []
        // Simulate an unrelated historical duplicate email. A phone-only
        // change must not be blocked by a value that is not being changed.
        if (filters.some((filter) => filter.email === state.email)) {
          return { id: 'u2', email: state.email, phone: '+8613000000000' }
        }
        return null
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (Object.hasOwn(data, 'phone')) state.phone = data.phone as string | null
        if (Object.hasOwn(data, 'email')) state.email = data.email as string | null
        if (Object.hasOwn(data, 'phoneVerifiedAt')) state.phoneVerifiedAt = data.phoneVerifiedAt as Date | null
        if (Object.hasOwn(data, 'emailVerifiedAt')) state.emailVerifiedAt = data.emailVerifiedAt as Date | null
        if (Object.hasOwn(data, 'verificationStatus')) state.verificationStatus = data.verificationStatus as typeof state.verificationStatus
        return { ...state, updatedAt: new Date() }
      },
    },
    emailVerification: { updateMany: async () => ({ count: 0 }) },
    smsCode: { updateMany: async () => ({ count: 0 }) },
    adminActionLog: { create: async () => ({}) },
  } as unknown as Parameters<typeof updateAdminUserContact>[0]

  const phonePatch = normalizeUserContactPatch({ phone: '13900139000', phoneCountry: 'CN' })
  await updateAdminUserContact(transaction, { userId: 'u1', adminId: 'admin', patch: phonePatch, reason: 'regression' })
  assert.equal(state.phone, '+8613900139000')
  assert.equal(state.username, '18926989012')
  const phoneWhere = getContactLoginWhere('phone', '13900139000', 'CN') as { phone: { in: string[] } }
  assert.ok(phoneWhere.phone.in.includes(state.phone))

  const combinedPatch = normalizeUserContactPatch({ email: state.email, phone: '13900239000', phoneCountry: 'CN' })
  await updateAdminUserContact(transaction, { userId: 'u1', adminId: 'admin', patch: combinedPatch, reason: 'regression' })
  assert.equal(state.phone, '+8613900239000')
  assert.equal(state.email, 'old@example.com')
  assert.equal(state.username, '18926989012')

  const emailPatch = normalizeUserContactPatch({ email: 'new@example.com' })
  await updateAdminUserContact(transaction, { userId: 'u1', adminId: 'admin', patch: emailPatch, reason: 'regression' })
  assert.equal(state.email, 'new@example.com')
  assert.equal(state.username, '18926989012')
  assert.deepEqual(getContactLoginWhere('email', 'new@example.com'), { email: state.email })
})

test('历史字段错乱检测只统计 username（后台内部账号）等于 phone 的数据且不修改并脱敏', () => {
  const rows = [
    { id: 'user-1', uid: 1, username: '13800138000', phone: '13800138000', email: 'same@example.com' },
    { id: 'user-2', uid: 2, username: '18926989012', phone: '+8613920000000', email: 'SAME@example.com' },
    { id: 'user-3', uid: 3, username: '13900139000', phone: null, email: null },
  ]
  const before = structuredClone(rows)
  assert.deepEqual(findInternalAccountPhoneMatches(rows), [{
    userId: 'us***',
    uid: 1,
    internalAccount: '138****8000',
    phone: '138****8000',
  }])
  assert.deepEqual(buildAuditReport(rows), {
    mode: 'read-only',
    usersScanned: 3,
    usernamePhoneAnomalyCount: 1,
    matchCount: 1,
    matches: [{ userId: 'us***', uid: 1, internalAccount: '138****8000', phone: '138****8000' }],
    emailAnomalyCount: 2,
    emailAnomalies: [
      { userId: 'us***', uid: 1, email: 's***@example.com' },
      { userId: 'us***', uid: 2, email: 's***@example.com' },
    ],
    changesApplied: 0,
    needsManualReview: true,
    note: '发现疑似历史字段异常；脚本未修改任何数据，请人工确认后处理。日志中的用户标识和联系方式已脱敏。',
  })
  assert.deepEqual(rows, before)
})

test('后台路由返回手机号/邮箱已绑定其他账号，并明确拒绝内部账号映射', () => {
  const route = source('app/api/admin/users/[userId]/route.ts')
  const service = source('lib/admin-user-contact.ts')
  const detail = source('app/admin/users/[id]/page.tsx')
  const script = source('scripts/audit-internal-account-phone.ts')

  assert.match(route, /该手机号已绑定其他账号/)
  assert.match(route, /该邮箱已绑定其他账号/)
  assert.match(route, /updateAdminUserContact/)
  assert.match(service, /internalAccount: 'username'/)
  assert.match(service, /data\.phone = nextPhone/)
  assert.match(service, /data\.email = nextEmail/)
  assert.doesNotMatch(service, /data\.username\s*=/)
  assert.doesNotMatch(service, /data\.nickname\s*=/)
  assert.match(detail, /data-user-field=\{field\}/)
  assert.match(detail, /field: 'username', label: '内部账号', value: user\.username/)
  assert.match(detail, /field: 'phone', label: '手机', value: user\.phone/)
  assert.match(script, /mode: 'read-only'/)
  assert.match(script, /changesApplied: 0/)
  assert.doesNotMatch(script, /prisma\.user\.(update|create|delete)/)
  assert.doesNotMatch(script, /\$executeRaw|\$queryRaw/)
})
