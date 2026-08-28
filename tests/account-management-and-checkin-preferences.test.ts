import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { maskLoginAccount, normalizeLoginAccount, validateAdminLoginAccount } from '../lib/login-account'
import { validateNewPassword } from '../lib/account-password'
import { calcMoodIndex } from '../lib/daily'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('登录账号沿用注册时的 2-16 字符规则并要求二次确认', () => {
  assert.deepEqual(validateAdminLoginAccount('Eason仔', 'EASON仔', 'old'), { account: 'Eason仔', usernameNormalized: 'eason仔', error: null })
  assert.match(validateAdminLoginAccount(' Eason仔 ', 'EASON仔', 'old').error || '', /用户名只能包含中文、英文、数字和下划线，不能包含空格或特殊字符/)
  assert.match(validateAdminLoginAccount('', '', 'old').error || '', /请输入/)
  assert.match(validateAdminLoginAccount('a', 'a', 'old').error || '', /2-16/)
  assert.match(validateAdminLoginAccount('new', 'other', 'old').error || '', /不一致/)
  assert.match(validateAdminLoginAccount('Old', 'old', normalizeLoginAccount('OLD')).error || '', /不区分大小写/)
})

test('敏感形态登录账号写入日志前脱敏', () => {
  assert.equal(maskLoginAccount('13800138000'), '138****8000')
  assert.equal(maskLoginAccount('eason@example.com'), 'e***@example.com')
})

test('账号修改接口独立鉴权、事务更新并记录脱敏日志', () => {
  const route = source('app/api/admin/users/[userId]/account/route.ts')
  assert.match(route, /requireSuperAdmin\(\)/)
  assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(route, /prisma\.\$transaction/)
  assert.match(route, /where: \{ usernameNormalized: validation\.usernameNormalized \}/)
  assert.match(route, /action: 'USER_ACCOUNT_CHANGED'/)
  assert.match(route, /maskLoginAccount\(target\.username\)/)
  assert.match(route, /data: \{ username: validation\.account, usernameNormalized: validation\.usernameNormalized \}/)
  assert.doesNotMatch(route, /password|answerHash|cookie|tokenHash/i)
})

test('数据库为登录账号和签到偏好提供约束与安全默认值', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260719120000_add_login_account_and_checkin_preferences/migration.sql')
  assert.match(schema, /model User \{[\s\S]*?\busername\s+String\b/)
  assert.match(schema, /model User \{[\s\S]*?\busernameNormalized\s+String\s+@unique\b/)
  assert.match(schema, /checkinMoodEnabled\s+Boolean\s+@default\(true\)/)
  assert.match(schema, /model DailyMessage \{[\s\S]*?mood\s+String\?/)
  assert.match(migration, /DEFAULT true/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "User_usernameNormalized_key"/)
  assert.match(migration, /USERNAME_NORMALIZED_BACKFILL_REQUIRED/)
  assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE|DROP COLUMN/)
})

test('用户密码接口分离、bcrypt cost 12 且日志不含密码或答案', () => {
  const change = source('app/api/account/security/password/change/route.ts')
  const reset = source('app/api/account/security/password/security-question-reset/route.ts')
  for (const route of [change, reset]) {
    assert.match(route, /requireUser\(\)/)
    assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
    assert.match(route, /bcrypt\.hash\(body\.password, 12\)/)
    assert.match(route, /accountSecurityLog\.create/)
    const metadata = route.match(/metadata:\s*\{[^}]+\}/g)?.join('') || ''
    assert.doesNotMatch(metadata, /body\.|passwordHash|answerHash/i)
  }
  assert.match(reset, /UserSecurityQuestion:\s*\{\s*select:\s*\{\s*sortOrder: true,\s*answerHash: true\s*\}\s*\}/)
  assert.match(reset, /questionCount:\s*user\.UserSecurityQuestion \? 1 : 0/)
  assert.match(reset, /consumeRateLimit\(accountKey, wrongAnswerAction, 5, 30 \* 60\)/)
  assert.match(reset, /30 \* 60/)
})

test('新密码规则拒绝不一致、过短和相同密码由服务端验证', () => {
  assert.equal(validateNewPassword('12345678', '12345678'), null)
  assert.match(validateNewPassword('123', '123') || '', /至少需要 8 位/)
  assert.match(validateNewPassword('12345678', '87654321') || '', /不一致/)
  assert.match(source('app/api/account/security/password/change/route.ts'), /samePassword\.valid/)
})

test('邮箱链接重置新增独立 API 并保留原有安全设置入口', () => {
  const component = source('components/PasswordManagement.tsx')
  assert.match(component, /暂未开放/)
  assert.match(component, /type="button" disabled/)
  assert.match(source('app/settings/security/page.tsx'), /enableEmailPasswordReset/)
  assert.match(source('app/api/auth/password/request/route.ts'), /TENCENT_EMAIL_NOT_CONFIGURED/)
  assert.match(source('app/api/auth/password/reset/route.ts'), /type: 'EMAIL_LINK'/)
  assert.match(source('app/forgot-password/page.tsx'), /EmailPasswordLinkForm/)
})

test('签到偏好只能修改本人并由签到 API 依据数据库值判断 mood', () => {
  const preference = source('app/api/account/preferences/route.ts')
  const checkin = source('app/api/checkin/route.ts')
  const auth = source('lib/auth.ts')
  assert.match(preference, /where: \{ id: guard\.user\.id \}/)
  assert.doesNotMatch(preference, /body\?\.(userId|targetUserId)/)
  assert.match(auth, /checkinMoodEnabled: true/)
  assert.match(checkin, /const user = await getCurrentUser\(\)/)
  assert.match(checkin, /unauthenticatedResponse\(\)/)
  assert.match(checkin, /const preference = \{ checkinMoodEnabled: user\.checkinMoodEnabled \}/)
  assert.match(checkin, /preference\.checkinMoodEnabled \? requestedMood : null/)
  assert.match(checkin, /mood: mood\?\.key \?\? null/)
  assert.match(checkin, /checkinMoodEnabled: profile\.checkinMoodEnabled/)
  assert.doesNotMatch(checkin, /select: \{ checkinMoodEnabled: true \}/)
  assert.equal(calcMoodIndex([]), 0)
})

test('心情可选，关闭偏好后前端隐藏选择区并显示无心情而非伪造图标', () => {
  const button = source('components/CheckInButton.tsx')
  assert.match(button, /checkinMoodEnabled \? <div>/)
  assert.doesNotMatch(button, /checkinMoodEnabled && !mood/)
  assert.match(button, /NO_MOOD_LABEL/)
  assert.match(button, /disabled=\{previewMode \|\| isSubmitting\}/)
  assert.doesNotMatch(button, /selectedMood\?\.icon \|\| '♪'/)
})
