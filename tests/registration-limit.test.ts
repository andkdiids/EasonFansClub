import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getShanghaiDayRange } from '../lib/checkin'
import { consumeHospitalCheckStartRateLimit } from '../lib/registration-rate-limit'
import { getClientIp, normalizeIp } from '../lib/security'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('注册限流使用上海自然日边界并规范化 IPv4/IPv6', () => {
  const beforeMidnight = new Date('2026-07-16T15:59:59.999Z')
  const afterMidnight = new Date('2026-07-16T16:00:00.000Z')
  assert.equal(getShanghaiDayRange(beforeMidnight).start.toISOString(), '2026-07-15T16:00:00.000Z')
  assert.equal(getShanghaiDayRange(afterMidnight).start.toISOString(), '2026-07-16T16:00:00.000Z')
  assert.equal(normalizeIp('192.168.001.002'), '192.168.1.2')
  assert.equal(normalizeIp('2001:0db8:0:0:0:0:0:1'), '2001:db8::1')
  assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1')
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1')
  assert.equal(getClientIp(new Request('https://ecfc.fans/api/auth/register/send-email-code', {
    headers: {
      'x-ecfc-client-ip': '2001:0db8:0:0:0:0:0:1',
      'x-real-ip': '127.0.0.1',
      'x-forwarded-for': '1.2.3.4, 10.0.0.1',
    },
  })), '2001:db8::1')
  assert.equal(getClientIp(new Request('https://ecfc.fans/api/auth/register/send-email-code', {
    headers: { 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '9.9.9.9' },
  })), 'unknown')
})

test('注册限制只控制成功发送的邮箱验证码，体检每日限制独立保留', () => {
  const registration = source('lib/registration.ts')
  const rateLimit = source('lib/registration-rate-limit.ts')
  const sendEmailCode = source('app/api/auth/register/send-email-code/route.ts')
  const adminRoute = source('app/api/admin/registration-settings/route.ts')
  const adminForm = source('app/admin/settings/RegistrationSettingsForm.tsx')
  const hospital = source('lib/ehospital-check.ts')
  const hospitalRoute = source('app/api/auth/hospital-check/route.ts')
  const registerForm = source('app/register/RegisterForm.tsx')
  const registerRoute = source('app/api/auth/register/route.ts')

  assert.match(registration, /registrationLimitSettingKey = 'registrationLimitEnabled'/)
  assert.match(registration, /return setting\?\.value === 'true'/)
  assert.match(rateLimit, /REGISTRATION_EMAIL_CODE_DAILY_LIMIT = 3/)
  assert.match(rateLimit, /createdAt: \{ gte: start, lt: end \}/)
  assert.match(rateLimit, /REGISTRATION_EMAIL_CODE_RATE_LIMIT_ACTION = 'registration:email-code:success'/)
  assert.match(sendEmailCode, /getRegistrationLimitEnabled/)
  assert.match(sendEmailCode, /REGISTRATION_IP_DAILY_LIMIT_REACHED/)
  assert.match(sendEmailCode, /recordSuccessfulRegistrationEmailCodeSend/)
  assert.ok(sendEmailCode.lastIndexOf('if (!mailResult.sent)') < sendEmailCode.lastIndexOf('recordSuccessfulRegistrationEmailCodeSend'))
  assert.match(adminRoute, /registrationLimitEnabled/)
  assert.match(adminForm, /固定规则：每日体检最多 3 次，不受此开关影响。/)
  assert.match(hospital, /DAILY_LIMIT_REACHED/)
  assert.match(hospital, /countAttempts\(draft\.identityHash, now\)/)
  assert.doesNotMatch(hospital, /registrationLimitEnabled/)
  assert.match(hospital, /EHOSPITAL_START_DEDUPE_WINDOW_MS = 10_000/)
  assert.match(hospital, /hospitalCheckStartRequests/)
  assert.match(hospital, /withMySqlAdvisoryLocks/)
  assert.match(hospitalRoute, /consumeHospitalCheckStartRateLimit/)
  assert.match(hospitalRoute, /requestId/)
  assert.match(registerForm, /hospitalStartLockedRef/)
  assert.match(registerForm, /body: JSON.stringify\(\{ registrationToken, requestId \}\)/)
  assert.doesNotMatch(registerRoute, /EHospitalCheckConfig WHERE id = .*FOR UPDATE/)
  assert.match(registerRoute, /created\.uid > MAX_UID/)
})

test('体检启动短时限流允许正常请求并拒绝同 IP 高频请求', () => {
  const ip = '203.0.113.77'
  const startedAt = Date.UTC(2026, 7, 10, 12, 0, 0)
  for (let index = 0; index < 20; index += 1) {
    assert.equal(consumeHospitalCheckStartRateLimit(ip, startedAt + index).limited, false)
  }
  assert.equal(consumeHospitalCheckStartRateLimit(ip, startedAt + 20).limited, true)
  assert.equal(consumeHospitalCheckStartRateLimit(ip, startedAt + 10_001).limited, false)
})
