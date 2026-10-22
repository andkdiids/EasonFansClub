import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('account security status supports Mobile Bearer and returns contact/question status only', () => {
  const route = source('app/api/account/security/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /phoneBound:\s*Boolean\(user\.phone\)/)
  assert.match(route, /phoneVerified:\s*Boolean\(user\.phoneVerifiedAt\)/)
  assert.match(route, /securityQuestion:\s*user\.UserSecurityQuestion\?\.question/)
  assert.match(route, /Cache-Control': 'private, no-store, max-age=0/)
  assert.doesNotMatch(route, /answerHash|securityAnswer/)
  assert.match(source('lib/security.ts'), /if \(request\.headers\.has\('authorization'\)\)[\s\S]*?resolveMobileAccess\(request\)/)
})

test('password change accepts Cookie or Bearer and uses shared session invalidation', () => {
  const route = source('app/api/account/security/password/change/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /commitPasswordChange/)
  assert.match(route, /expectedPasswordHash:\s*user\.passwordHash/)
  assert.match(source('lib/password-security-transaction.ts'), /mobileAuthSession\.updateMany[\s\S]*revokedAt/)
})

test('security-question update requires the current password and hashes the replacement answer', () => {
  const route = source('app/api/account/security/questions/route.ts')
  assert.match(route, /export async function POST\(request: Request\)/)
  assert.match(route, /export async function PUT\(request: Request\)/)
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /currentPassword/)
  assert.match(route, /verifyPassword\(currentPassword, user\.passwordHash\)/)
  assert.match(route, /hashSecurityQuestions\(questions\)/)
  assert.match(route, /userSecurityQuestion\.update\([\s\S]*data: hashed\[0\]/)
  assert.match(route, /SECURITY_QUESTIONS_UPDATED/)
  assert.doesNotMatch(route, /今后不可修改/)
  assert.doesNotMatch(route, /console\.(?:log|error)\([^\n]*(?:answer|currentPassword)/i)
})

test('public recovery remains staged and single-use; answer never appears in public-question lookup', () => {
  const question = source('app/api/auth/forgot-password/security/questions/route.ts')
  const verify = source('app/api/auth/forgot-password/security/verify/route.ts')
  const reset = source('app/api/auth/forgot-password/reset/route.ts')
  assert.match(question, /buildSecurityQuestionChallengeResponse/)
  assert.match(question, /consumeRateLimitFailClosed/)
  assert.doesNotMatch(question, /answerHash|answer:\s*true/)
  assert.match(verify, /attemptCount >= 5/)
  assert.match(verify, /expiresAt:\s*new Date\(Date\.now\(\) \+ 10 \* 60 \* 1000\)/)
  assert.match(verify, /resetToken/)
  assert.match(reset, /consumeResetTokenAndChangePassword/)
  assert.match(source('lib/password-security-transaction.ts'), /stage:\s*'RESET_TOKEN'[\s\S]*consumedAt:\s*null[\s\S]*expiresAt:\s*\{ gt: now \}/)
})

test('email password recovery stays disabled and has no Mobile-available path', () => {
  for (const path of [
    'app/api/auth/forgot-password/email/send/route.ts',
    'app/api/auth/forgot-password/email/verify/route.ts',
  ]) {
    assert.match(source(path), /EMAIL_PASSWORD_RECOVERY_DISABLED/)
  }
})
