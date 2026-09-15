import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describePasswordRecoveryError } from '../lib/password-recovery-errors'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('公开找回链路返回安全的结构化错误，而不是把服务端异常暴露给用户', () => {
  const request = source('app/api/auth/password/request/route.ts')
  const linkReset = source('app/api/auth/password/reset/route.ts')
  const securityReset = source('app/api/auth/forgot-password/reset/route.ts')
  const securityVerify = source('app/api/auth/forgot-password/security/verify/route.ts')

  assert.match(request, /PASSWORD_RECOVERY_UNAVAILABLE/)
  assert.match(request, /EMAIL_SEND_FAILED/)
  assert.match(linkReset, /PASSWORD_RESET_FAILED/)
  assert.match(linkReset, /RESET_TOKEN_USED/)
  assert.match(securityReset, /PASSWORD_RESET_FAILED/)
  assert.match(securityReset, /RESET_TOKEN_USED/)
  assert.match(securityVerify, /SECURITY_ANSWER_INVALID/)
  assert.match(securityVerify, /密保答案不正确/)
  assert.match(securityReset, /validateNewPassword\(password, confirmPassword\)/)
  assert.match(linkReset, /validateNewPassword\(newPassword, confirmPassword\)/)
})

test('找回页面会显示字段错误并在网络异常后恢复提交状态', () => {
  const publicForm = source('app/forgot-password/ForgotPasswordForm.tsx')
  const linkForm = source('app/forgot-password/EmailPasswordLinkForm.tsx')
  const resetForm = source('app/reset-password/ResetPasswordForm.tsx')

  assert.match(publicForm, /setFieldErrors\(nextFieldErrors\)/)
  assert.match(publicForm, /catch \{\s*setError\('网络连接失败，请稍后再试'\)/)
  assert.match(publicForm, /finally \{\s*setBusy\(false\)/)
  assert.match(publicForm, /fieldError\('answer'\)/)
  assert.match(publicForm, /fieldError\('password'\)/)
  assert.match(linkForm, /data\.errors\?\.email/)
  assert.match(resetForm, /fieldErrors\.confirmPassword/)
})

test('密码重置成功产生的安全日志会使旧的无状态 JWT 失效', () => {
  const auth = source('lib/auth.ts')
  assert.match(auth, /sessionIssuedAtMs/)
  assert.match(auth, /PASSWORD_RESET_SUCCEEDED/)
  assert.match(auth, /PASSWORD_RESET_WITH_SECURITY_QUESTION/)
  assert.match(auth, /PASSWORD_CHANGED_WITH_CURRENT_PASSWORD/)
  assert.match(auth, /hasPasswordInvalidationAfterSessionIssue\(sessionUser\)/)
  assert.match(auth, /createdAt: \{ gt: new Date\(issuedAt\) \}/)
  assert.match(auth, /await hasPasswordInvalidationAfterSessionIssue\(sessionUser\)/)
})

test('密码恢复错误日志会脱敏邮件、token、密码和数据库连接信息', () => {
  const described = describePasswordRecoveryError(Object.assign(new Error('email=test@example.com token=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 mysql://root:secret@db.example/app'), { code: 'P1001' }))
  assert.equal(described.errorCode, 'P1001')
  assert.doesNotMatch(described.message, /test@example\.com|abcdef0123456789|root:secret/i)
})
