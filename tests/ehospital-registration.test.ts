import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('E院体检迁移只创建注册验证相关表', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260802030000_add_ehospital_registration_check/migration.sql')
  for (const model of ['EHospitalCheckConfig', 'EHospitalCheckSession', 'EHospitalCheckAttempt', 'RegistrationDraft']) {
    assert.match(schema, new RegExp(`model ${model}`))
    assert.ok(migration.includes(`CREATE TABLE \`${model}\``))
  }
  assert.match(migration, /EHospitalCheckAttempt_sessionId_key/)
  assert.match(migration, /EHospitalCheckSession_registrationDraftId_fkey/)
  assert.match(migration, /EHospitalCheckAttempt_userId_fkey/)
  assert.doesNotMatch(migration, /GuessSongAudioVariant/)
  assert.doesNotMatch(migration, /ALTER TABLE `User`|ALTER TABLE `GuessSong/)
})

test('注册建号只要求邮箱验证和 E院体检，不要求手机验证', () => {
  const prepare = source('app/api/auth/register/prepare/route.ts')
  const register = source('app/api/auth/register/route.ts')
  const verify = source('app/api/auth/register/verify-code/route.ts')
  const sendEmail = source('app/api/auth/register/send-email-code/route.ts')
  assert.match(prepare, /!rawPhone/)
  assert.match(prepare, /手机号不能为空/)
  assert.match(register, /submittedPhone/)
  assert.match(register, /PHONE_REQUIRED/)
  assert.doesNotMatch(prepare, /sendRegistrationPhoneCode|phoneCodeHash: hashRegistrationCode/)
  assert.match(register, /!draft\.emailVerifiedAt/)
  assert.doesNotMatch(register, /!draft\.phoneVerifiedAt \|\| !draft\.emailVerifiedAt/)
  assert.match(register, /response\.cookies\.set\(authCookieName/)
  assert.match(verify, /hashRegistrationCode\(registrationToken, 'EMAIL', code\)/)
  assert.doesNotMatch(verify, /phoneCodeHash|channel === 'PHONE'/)
  assert.match(sendEmail, /sendRegistrationVerificationCode/)
})

test('体检接口不把答案键发给前端，并且固定使用 REGISTER_CHECK 七秒音频', () => {
  const service = source('lib/ehospital-check.ts')
  const route = source('app/api/auth/hospital-check/route.ts')
  assert.match(service, /purpose: 'REGISTER_CHECK'/)
  assert.match(service, /durationSeconds: EHOSPITAL_AUDIO_SECONDS/)
  assert.match(service, /EHOSPITAL_SESSION_MINUTES = 30/)
  assert.match(service, /updateMany\(/)
  assert.doesNotMatch(route, /answerKey|correctOption/)
})

test('注册页使用资料→体检→邮箱验证码→自动进入欢迎页流程', () => {
  const form = source('app/register/RegisterForm.tsx')
  assert.match(form, /🏥 E院体检/)
  assert.doesNotMatch(form, /选填/)
  assert.match(form, /请输入手机号/)
  assert.match(form, /InternationalPhoneInput/)
  assert.match(form, /required[\s\S]{0,300}data-register-field="phone"/)
  assert.doesNotMatch(form, /phoneCode|verifyCode\('PHONE'/)
  assert.match(form, /欢迎进入E院体检/)
  assert.match(form, /我已明白，开始体检/)
  assert.match(form, /api\/auth\/register\/send-email-code/)
  assert.match(form, /window\.location\.assign\('\/welcome'\)/)
})
