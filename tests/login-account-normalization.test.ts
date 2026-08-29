import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getLoginAccountDisplay, normalizeLoginAccount, validateAdminLoginAccount, validateLoginAccountValue } from '../lib/login-account'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('World、world 和全角账号使用同一规范化值', () => {
  assert.equal(normalizeLoginAccount('World'), 'world')
  assert.equal(normalizeLoginAccount(' world '), 'world')
  assert.equal(normalizeLoginAccount('Ｗｏｒｌｄ'), 'world')
})

test('原始展示账号保留大小写且只移除首尾空格', () => {
  assert.equal(getLoginAccountDisplay('  World  '), 'World')
  assert.deepEqual(validateLoginAccountValue('World'), { account: 'World', usernameNormalized: 'world', error: null })
})

test('NFKC 展开后仍执行 2-16 字符限制', () => {
  assert.equal(validateLoginAccountValue('Ｅａｓｏｎ').error, null)
  assert.match(validateLoginAccountValue('ﬃ'.repeat(6)).error || '', /2-16/)
})

test('管理员仅改变大小写或全半角会被视为原账号', () => {
  const current = normalizeLoginAccount('World')
  assert.match(validateAdminLoginAccount('world', 'WORLD', current).error || '', /不区分大小写/)
  assert.match(validateAdminLoginAccount('Ｗｏｒｌｄ', 'world', current).error || '', /不区分大小写/)
})

test('登录、注册与管理员接口全部复用统一规范化函数和字段', () => {
  const users = source('lib/users.ts')
  const register = source('app/api/auth/register/route.ts')
  const admin = source('app/api/admin/users/[userId]/account/route.ts')
  assert.match(users, /normalizeLoginAccount\(normalized\)/)
  assert.match(users, /usernameNormalized: normalizeLoginAccount\(normalized\)/)
  assert.match(register, /validateLoginAccountValue\(username\)/)
  assert.match(register, /usernameNormalized,/)
  assert.match(register, /findLoginAccountConflict\(usernameNormalized\)/)
  assert.match(admin, /validateAdminLoginAccount/)
  assert.match(admin, /usernameNormalized: validation\.usernameNormalized/)
})

test('数据库仅以 usernameNormalized 唯一，username 保留展示值', () => {
  const schema = source('prisma/schema.prisma')
  const userModel = schema.match(/model User \{[\s\S]*?^\}/m)?.[0] || ''
  assert.match(userModel, /\busername\s+String\b(?!\s+@unique)/)
  assert.match(userModel, /\busernameNormalized\s+String\s+@unique\b/)
})

test('migration 要求受控回填且冲突时在事务内明确停止', () => {
  const migration = source('prisma/migrations/20260719120000_add_login_account_and_checkin_preferences/migration.sql')
  assert.match(migration, /^BEGIN;/)
  assert.match(migration, /USERNAME_NORMALIZED_BACKFILL_REQUIRED/)
  assert.match(migration, /USERNAME_NORMALIZED_CONFLICTS_EXIST/)
  assert.match(migration, /ALTER COLUMN "usernameNormalized" SET NOT NULL/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "User_usernameNormalized_key"/)
  assert.match(migration, /COMMIT;/)
  assert.doesNotMatch(migration, /UPDATE\s+"User"\s+SET\s+username/i)
})

test('注册和管理员数据库冲突均返回大小写不敏感提示', () => {
  const register = source('app/api/auth/register/route.ts')
  const admin = source('app/api/admin/users/[userId]/account/route.ts')
  assert.match(register, /该登录账号已被使用，账号不区分大小写/)
  assert.match(admin, /该登录账号已被其他用户使用，账号不区分大小写。/)
})

test('冲突检查脚本只选择账号标识字段且输出脱敏结果', () => {
  const script = source('scripts/check-username-conflicts.ts')
  assert.match(script, /SELECT id, uid, username FROM "User"/)
  assert.match(script, /maskLoginAccount/)
  assert.match(script, /maskUserId/)
  assert.match(script, /forbiddenFieldsSelected: \[\]/)
  assert.doesNotMatch(script, /passwordHash|answerHash|email|phone|token|cookie/i)
})

test('受控修改脚本默认 dry-run 且不会修改 UID、User.id 或关联数据', () => {
  const script = source('scripts/update-user-login-account.ts')
  assert.match(script, /if \(!apply\) \{[\s\S]*?return[\s\S]*?\}/)
  assert.match(script, /--target-uid/)
  assert.match(script, /--account/)
  assert.match(script, /--reason/)
  assert.match(script, /UPDATE "User" SET username/)
  assert.doesNotMatch(script, /SET\s+(uid|id)\s*=/)
  assert.doesNotMatch(script, /DELETE|TRUNCATE|DROP TABLE/i)
})
