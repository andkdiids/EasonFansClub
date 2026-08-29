import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeAdminUid, validateAdminResetPassword } from '../lib/admin-user-advanced'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('超级管理员高级用户管理 Schema 和 migration 只追加安全字段与日志模型', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260719090000_add_super_admin_user_actions/migration.sql')
  assert.match(schema, /mustSetupSecurity\s+Boolean\s+@default\(false\)/)
  const logModel = schema.match(/model AdminActionLog \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(logModel, /adminId\s+String/)
  assert.match(logModel, /action\s+String/)
  assert.match(logModel, /targetUserId\s+String/)
  assert.match(logModel, /detail\s+Json\?/)
  assert.match(logModel, /createdAt\s+DateTime/)
  assert.match(migration, /ADD COLUMN "mustSetupSecurity" BOOLEAN NOT NULL DEFAULT false/)
  assert.match(migration, /CREATE TABLE "AdminActionLog"/)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/)
})

test('UID 自动补足五位并拒绝非数字、零和超长值', () => {
  assert.deepEqual(normalizeAdminUid('1'), { uid: 1, formattedUid: '00001' })
  assert.deepEqual(normalizeAdminUid('00123'), { uid: 123, formattedUid: '00123' })
  for (const value of ['abc', '12a', '00000', '100000', '', null]) assert.equal(normalizeAdminUid(value), null)
})

test('密码重置输入要求两次一致且长度合规', () => {
  assert.equal(validateAdminResetPassword('12345678', '12345678'), null)
  assert.match(validateAdminResetPassword('123', '123') || '', /至少需要 8 位/)
  assert.match(validateAdminResetPassword('12345678', '87654321') || '', /不一致/)
})

test('高级操作接口都在服务端执行超级管理员与请求来源校验', () => {
  const security = source('lib/security.ts')
  const uidRoute = source('app/api/admin/users/[userId]/uid/route.ts')
  const passwordRoute = source('app/api/admin/users/[userId]/password/route.ts')
  assert.match(security, /export async function requireSuperAdmin/)
  assert.match(security, /result\.user\.role !== 'SUPER_ADMIN'/)
  for (const route of [uidRoute, passwordRoute]) {
    assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
    assert.match(route, /requireSuperAdmin\(\)/)
    assert.match(route, /prisma\.\$transaction/)
    assert.match(route, /tx\.adminActionLog\.create/)
  }
})

test('UID 修改检查唯一性且只更新 User.uid', () => {
  const route = source('app/api/admin/users/[userId]/uid/route.ts')
  assert.match(route, /tx\.user\.findUnique\(\{ where: \{ uid: normalized\.uid \}/)
  assert.match(route, /UID_ALREADY_EXISTS/)
  assert.match(route, /data: \{ uid: normalized\.uid \}/)
  assert.match(route, /action: 'UPDATE_USER_UID'/)
  assert.match(route, /previousUid/)
  assert.match(route, /newUid/)
})

test('密码重置使用 bcrypt、设置安全标记并通知用户', () => {
  const route = source('app/api/admin/users/[userId]/password/route.ts')
  assert.match(route, /bcrypt\.hash\(body\.password, 12\)/)
  assert.match(route, /data: \{ passwordHash, mustSetupSecurity: true \}/)
  assert.match(route, /upsertNotification\(/)
  assert.match(route, /safeNotificationWrite\(/)
  assert.match(route, /action: 'RESET_USER_PASSWORD'/)
  assert.doesNotMatch(route, /detail:\s*\{[^}]*password/i)
})

test('用户详情页只为超级管理员渲染高级操作区域', () => {
  const page = source('app/admin/users/[id]/page.tsx')
  const actions = source('components/SuperAdminUserActions.tsx')
  const manager = source('components/AdminUsersManager.tsx')
  assert.match(page, /requireAdminPage\(`\/admin\/users\/\$\{id\}`, 'user_manage'\)/)
  assert.match(page, /currentUser\.role === 'SUPER_ADMIN'/)
  assert.match(page, /SuperAdminUserActions/)
  assert.match(actions, /修改 UID/)
  assert.match(actions, /重置密码/)
  assert.match(manager, /href=\{`\/admin\/users\/\$\{user\.id\}`\}/)
})
