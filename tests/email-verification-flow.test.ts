import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  EMAIL_CODE_TTL_MS,
  hashProfileEmailVerificationCode,
} from '../lib/email-verification'
import { renderEmailVerificationCode } from '../lib/password-reset-email'

const read = (relativePath: string) => readFileSync(relativePath, 'utf8')

test('资料邮箱验证码按用户、用途和目标邮箱隔离', () => {
  const first = hashProfileEmailVerificationCode('user-a', 'a@example.com', '123456')
  assert.equal(first, hashProfileEmailVerificationCode('user-a', 'a@example.com', '123456'))
  assert.notEqual(first, hashProfileEmailVerificationCode('user-b', 'a@example.com', '123456'))
  assert.notEqual(first, hashProfileEmailVerificationCode('user-a', 'b@example.com', '123456'))
  assert.notEqual(first, hashProfileEmailVerificationCode('user-a', 'a@example.com', '654321'))
  assert.equal(EMAIL_CODE_TTL_MS, 10 * 60 * 1000)
})

test('资料邮箱绑定必须先发码，再在服务端事务中验证并更新 User.email', () => {
  const sendRoute = read('app/api/users/me/email-verification/send/route.ts')
  const verifyRoute = read('app/api/users/me/email-verification/verify/route.ts')
  const profileRoute = read('app/api/users/me/route.ts')
  const form = read('app/profile/ProfileSettingsForm.tsx')

  assert.match(sendRoute, /requireUser\(\)/)
  assert.match(sendRoute, /userId: guard\.user\.id/)
  assert.match(sendRoute, /sendProfileEmailVerificationCode\(email, verification\.code\)/)
  assert.doesNotMatch(sendRoute, /devEmailCode|verification\.code.*json/i)
  assert.match(verifyRoute, /hashProfileEmailVerificationCode\(guard\.user\.id, email, code\)/)
  assert.match(verifyRoute, /withMySqlAdvisoryLocks/)
  assert.match(verifyRoute, /verificationStatus: 'VERIFIED'/)
  assert.match(verifyRoute, /action: current\.email \? 'EMAIL_CHANGED' : 'EMAIL_BOUND'/)
  assert.match(profileRoute, /EMAIL_VERIFICATION_REQUIRED/)
  assert.doesNotMatch(profileRoute, /createVerificationForUser\(guard\.user\.id, profile\.email\)/)
  assert.match(form, /\/api\/users\/me\/email-verification\/send/)
  assert.match(form, /\/api\/users\/me\/email-verification\/verify/)
  assert.match(form, /验证并绑定/)
})

test('验证码邮件在发送前已插入真实验证码并使用绝对 Logo', () => {
  const rendered = renderEmailVerificationCode({ code: '123456', reason: 'change-email', expiresInMinutes: 10 })
  assert.match(rendered.html, />123456<\/p>/)
  assert.match(rendered.html, /src="https:\/\/ecfc\.fans\/icon\.png"/)
  assert.doesNotMatch(rendered.html, /\{\{code\}\}|\{\{verificationCode\}\}|undefined|null/)
})

test('其他资料字段不依赖邮箱绑定流程', () => {
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const route = read('app/api/users/me/route.ts')
  assert.match(form, /if \(form\.bio !== initialProfile\.bio\) payload\.bio = form\.bio/)
  assert.doesNotMatch(form, /payload\.email = form\.email/)
  assert.match(route, /if \(emailChanged\) \{[\s\S]*?return profileFieldError\('email', 'EMAIL_VERIFICATION_REQUIRED'/)
})
