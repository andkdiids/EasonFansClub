import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeAdminUid } from '../lib/admin-user-advanced'
import { validateNewPassword } from '../lib/account-password'

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
  assert.equal(validateNewPassword('12345678', '12345678'), null)
  assert.match(validateNewPassword('', '') || '', /至少需要 8 位/)
  assert.match(validateNewPassword('123', '123') || '', /至少需要 8 位/)
  assert.match(validateNewPassword('12345678', '87654321') || '', /不一致/)
  assert.match(validateNewPassword('x'.repeat(129), 'x'.repeat(129)) || '', /不能超过 128 位/)
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
  assert.ok(passwordRoute.indexOf('requireSuperAdmin()') < passwordRoute.indexOf('request.json()'))
  assert.ok(passwordRoute.indexOf('prisma.$transaction') < passwordRoute.indexOf("action: 'RESET_USER_PASSWORD'"))
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

test('密码重置使用统一哈希与策略、原子撤销目标会话并写安全审计', () => {
  const route = source('app/api/admin/users/[userId]/password/route.ts')
  const passwordSecurity = source('lib/password-security-transaction.ts')
  assert.match(route, /validateNewPassword\(body\?\.password, body\?\.confirmPassword\)/)
  assert.match(route, /hashPassword\(body\.password\)/)
  assert.doesNotMatch(route, /bcrypt\.hash/)
  assert.match(route, /commitPasswordChange\(tx, \{[\s\S]*?passwordHash,[\s\S]*?mustSetupSecurity: true/)
  assert.match(passwordSecurity, /onlineSession\.deleteMany\(\{ where: \{ userId: input\.userId \} \}\)/)
  assert.match(passwordSecurity, /mobileAuthSession\.updateMany\([\s\S]*?where: \{ userId: input\.userId, revokedAt: null \}/)
  assert.match(passwordSecurity, /accountSecurityLog\.create/)
  assert.match(route, /onStage: \(stage\) => \{ failureStage = stage \}/)
  assert.match(route, /logPasswordRecoveryError\('admin-password-reset', error, \{ stage \}\)/)
  assert.match(route, /logAdminPasswordResetFailure\(failureStage, error\)/)
  assert.match(route, /failureStage = 'TRANSACTION_COMMIT'/)
  assert.match(route, /action: 'PASSWORD_RESET_BY_ADMIN'/)
  assert.match(route, /upsertNotification\(/)
  assert.match(route, /safeNotificationWrite\(/)
  assert.match(route, /action: 'RESET_USER_PASSWORD'/)
  assert.doesNotMatch(route, /detail:\s*\{[^}]*password/i)
})

test('管理员重置自身密码会被拒绝，保护操作者当前会话', () => {
  const route = source('app/api/admin/users/[userId]/password/route.ts')
  assert.match(route, /userId === guard\.user\.id/)
  assert.match(route, /不能通过此操作重置自己的密码/)
  assert.ok(route.indexOf('userId === guard.user.id') < route.indexOf('hashPassword(body.password)'))
})

test('管理员重置保留目标 UID、登录账号、邮箱、手机号和安全问题', () => {
  const route = source('app/api/admin/users/[userId]/password/route.ts')
  const transaction = source('lib/password-security-transaction.ts')
  const update = transaction.match(/tx\.user\.updateMany\(\{[\s\S]*?data:\s*\{([\s\S]*?)\}\s*\}\)/)?.[1] || ''
  assert.match(route, /select: \{ id: true, uid: true, nickname: true, passwordHash: true \}/)
  assert.match(update, /passwordHash: input\.passwordHash/)
  assert.match(update, /mustSetupSecurity: input\.mustSetupSecurity/)
  assert.doesNotMatch(update, /uid:|email:|phone:|securityQuestion/i)
})

test('重置事务提交后的通知、缓存或实时推送失败不会误报重置失败', () => {
  const route = source('app/api/admin/users/[userId]/password/route.ts')
  const postCommitStart = route.indexOf('// Notifications and realtime delivery are post-commit best-effort effects.')
  const response = route.indexOf("message: '密码已重置，用户登录后需要重新设置密保问题'")
  const postCommit = route.slice(postCommitStart, response)
  assert.ok(postCommitStart > 0)
  assert.match(postCommit, /catch \(error\)[\s\S]*?logAdminPasswordResetFailure\('POST_COMMIT_NOTIFICATION', error\)/)
  assert.match(postCommit, /logAdminPasswordResetFailure\('POST_COMMIT_CACHE_INVALIDATION', error\)/)
  assert.match(postCommit, /logAdminPasswordResetFailure\('POST_COMMIT_REALTIME', error\)/)
  assert.match(route, /return NextResponse\.json\(\{ user, message:/)
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
