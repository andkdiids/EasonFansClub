import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateNewPassword } from '../lib/account-password'
import {
  createPasswordResetLinkToken,
  isPasswordResetTokenUsable,
  PASSWORD_RESET_LINK_MESSAGE,
  PASSWORD_RESET_LINK_TTL_MS,
} from '../lib/password-reset-link'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('正常生成密码重置 token 时只保留 hash 并默认 30 分钟有效', () => {
  const createdAt = new Date('2026-08-03T00:00:00.000Z')
  const generated = createPasswordResetLinkToken(createdAt)
  assert.match(generated.token, /^[a-f0-9]{64}$/)
  assert.match(generated.tokenHash, /^[a-f0-9]{64}$/)
  assert.notEqual(generated.token, generated.tokenHash)
  assert.equal(generated.expiresAt.getTime(), createdAt.getTime() + PASSWORD_RESET_LINK_TTL_MS)
  const route = source('app/api/auth/password/request/route.ts')
  assert.match(route, /tokenHash: generated\.tokenHash/)
  assert.doesNotMatch(route, /devEmailCode|resetToken\s*:/)
})

test('token 过期后不可使用', () => {
  const now = new Date('2026-08-03T00:30:00.000Z')
  assert.equal(isPasswordResetTokenUsable({ consumedAt: null, expiresAt: new Date('2026-08-03T00:29:59.999Z') }, now), false)
})

test('token 使用后不可重复使用', () => {
  const now = new Date('2026-08-03T00:10:00.000Z')
  assert.equal(isPasswordResetTokenUsable({ consumedAt: new Date('2026-08-03T00:05:00.000Z'), expiresAt: new Date('2026-08-03T00:30:00.000Z') }, now), false)
})

test('密码修改沿用现有密码规则并在事务中更新用户', () => {
  assert.equal(validateNewPassword('12345678', '12345678'), null)
  const route = source('app/api/auth/password/reset/route.ts')
  assert.match(route, /validateNewPassword\(newPassword, confirmPassword\)/)
  assert.match(route, /await tx\.user\.update\(\{ where: \{ id: reset\.userId \}, data: \{ passwordHash \} \}\)/)
  assert.match(route, /data: \{ consumedAt: now \}/)
  assert.match(route, /密码修改成功，请重新登录/)
})

test('不存在邮箱返回统一提示且不暴露注册状态', () => {
  const requestRoute = source('app/api/auth/password/request/route.ts')
  assert.equal(PASSWORD_RESET_LINK_MESSAGE, '如果该邮箱已注册，我们会发送密码重置链接')
  assert.match(requestRoute, /if \(!user\?\.email\) return genericResponse\(\)/)
  assert.match(requestRoute, /PASSWORD_RESET_LINK_MESSAGE/)
  assert.doesNotMatch(requestRoute, /邮箱未注册|用户不存在|该邮箱未注册/)
})

test('邮箱链接流程不替换密保问题找回入口', () => {
  const forgotPage = source('app/forgot-password/page.tsx')
  const securityRoute = source('app/api/auth/forgot-password/security/questions/route.ts')
  const legacyResetRoute = source('app/api/auth/forgot-password/reset/route.ts')
  assert.match(forgotPage, /EmailPasswordLinkForm/)
  assert.match(forgotPage, /ForgotPasswordForm/)
  assert.match(securityRoute, /type: 'SECURITY_QUESTION'/)
  assert.match(legacyResetRoute, /type: \{ not: 'EMAIL_LINK' \}/)
})
