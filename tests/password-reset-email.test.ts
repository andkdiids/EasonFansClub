import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PASSWORD_RESET_CODE_EXPIRY_MINUTES,
  PASSWORD_RESET_EMAIL_LOGO_URL,
  PASSWORD_RESET_CODE_SUBJECT,
  PASSWORD_RESET_LINK_SUBJECT,
  renderPasswordResetEmail,
} from '../lib/password-reset-email'
import { sendPasswordResetCode, sendPasswordResetLinkEmail } from '../lib/mail'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('密码重置验证码模板插入真实 code，且不残留未解析变量', () => {
  const rendered = renderPasswordResetEmail({
    kind: 'code',
    code: '123456',
    expiresInMinutes: PASSWORD_RESET_CODE_EXPIRY_MINUTES,
  })

  assert.equal(rendered.subject, PASSWORD_RESET_CODE_SUBJECT)
  assert.match(rendered.html, />123456<\/p>/)
  assert.doesNotMatch(rendered.html, /\{\{/)
  assert.doesNotMatch(rendered.html, /\{\{code\}\}/)
  assert.match(rendered.html, /src="https:\/\/ecfc\.fans\/icon\.png"/)
  assert.match(rendered.html, /font-family:Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif/)
  assert.match(rendered.html, /display:block;[^\"]*border:0;outline:none;text-decoration:none/)
  assert.match(rendered.text, /123456/)
})

test('密码重置链接模板有实际链接且不与验证码变量混用', () => {
  const rendered = renderPasswordResetEmail({
    kind: 'link',
    resetUrl: 'https://ecfc.fans/reset-password?token=abc&next=1',
    expiresInMinutes: 30,
  })

  assert.equal(rendered.subject, PASSWORD_RESET_LINK_SUBJECT)
  assert.match(rendered.html, /href="https:\/\/ecfc\.fans\/reset-password\?token=abc&amp;next=1"/)
  assert.doesNotMatch(rendered.html, /\{\{/)
  assert.doesNotMatch(rendered.html, /localhost|127\.0\.0\.1|src="\//i)
})

test('密码重置发送 payload 使用已渲染的 Simple HTML，并传入同一个 code', async () => {
  const originalFetch = globalThis.fetch
  const originalSecretId = process.env.TENCENT_EMAIL_SECRET_ID
  const originalSecretKey = process.env.TENCENT_EMAIL_SECRET_KEY
  const originalRegion = process.env.TENCENT_EMAIL_REGION
  let requestBody: Record<string, unknown> | null = null

  process.env.TENCENT_EMAIL_SECRET_ID = 'test-secret-id'
  process.env.TENCENT_EMAIL_SECRET_KEY = 'test-secret-key'
  process.env.TENCENT_EMAIL_REGION = 'ap-hongkong'
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ Response: { RequestId: 'test-request' } }), { status: 200 })
  }) as typeof fetch

  try {
    const result = await sendPasswordResetCode('test@example.com', '123456')
    assert.deepEqual(result, { sent: true })
    assert.ok(requestBody)
    const capturedBody = requestBody as Record<string, unknown>
    assert.equal(capturedBody.Template, undefined)
    const simple = capturedBody.Simple as { Html: string; Text: string }
    const html = Buffer.from(simple.Html, 'base64').toString('utf8')
    assert.match(html, />123456<\/p>/)
    assert.doesNotMatch(html, /\{\{/)
    assert.equal(capturedBody.Subject, PASSWORD_RESET_CODE_SUBJECT)
    assert.equal(PASSWORD_RESET_EMAIL_LOGO_URL, 'https://ecfc.fans/icon.png')
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecretId === undefined) delete process.env.TENCENT_EMAIL_SECRET_ID
    else process.env.TENCENT_EMAIL_SECRET_ID = originalSecretId
    if (originalSecretKey === undefined) delete process.env.TENCENT_EMAIL_SECRET_KEY
    else process.env.TENCENT_EMAIL_SECRET_KEY = originalSecretKey
    if (originalRegion === undefined) delete process.env.TENCENT_EMAIL_REGION
    else process.env.TENCENT_EMAIL_REGION = originalRegion
  }
})

test('密码重置链路传递生成的同一个 code，并保持原有 10 分钟与一次性规则', () => {
  const sendRoute = source('app/api/auth/forgot-password/email/send/route.ts')
  const verifyRoute = source('app/api/auth/forgot-password/email/verify/route.ts')
  const resetRoute = source('app/api/auth/forgot-password/reset/route.ts')
  const mail = source('lib/mail.ts')

  assert.match(sendRoute, /const code = String\(crypto\.randomInt\(0, 1_000_000\)\)\.padStart\(6, '0'\)/)
  assert.match(sendRoute, /sendPasswordResetCode\(user\.email, code\)/)
  assert.match(sendRoute, /10 \* 60 \* 1000/)
  assert.match(verifyRoute, /type: 'EMAIL', stage: 'RESET_CODE'/)
  assert.match(verifyRoute, /record\.codeHash !== hashToken\(`\$\{user\.id\}:\$\{code\}`\)/)
  assert.match(verifyRoute, /consumedAt: new Date\(\)/)
  assert.match(resetRoute, /type: \{ not: 'EMAIL_LINK' \}/)
  assert.match(mail, /renderPasswordResetEmail\(/)
  assert.match(mail, /Simple:/)
})

test('注册验证码仍使用原有 Tencent 模板 code 参数，未改动注册业务', () => {
  const mail = source('lib/mail.ts')
  const registerRoute = source('app/api/auth/register/send-email-code/route.ts')

  assert.match(mail, /export async function sendRegistrationVerificationCode/)
  assert.match(mail, /templateData:\s*\{\s*code,\s*\}/)
  assert.match(registerRoute, /sendRegistrationVerificationCode\(email, code\)/)
})

test('密码重置模板 Logo 使用正式公网 HTTPS PNG 资源', () => {
  const logoPath = new URL('../app/icon.png', import.meta.url)
  const pngHeader = readFileSync(logoPath).subarray(0, 8)
  assert.deepEqual([...pngHeader], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(PASSWORD_RESET_EMAIL_LOGO_URL, 'https://ecfc.fans/icon.png')
  assert.match(PASSWORD_RESET_EMAIL_LOGO_URL, /^https:\/\//)
})

test('密码重置链接发送也使用独立的渲染内容', async () => {
  const originalFetch = globalThis.fetch
  const originalSecretId = process.env.TENCENT_EMAIL_SECRET_ID
  const originalSecretKey = process.env.TENCENT_EMAIL_SECRET_KEY
  let requestBody: Record<string, unknown> | null = null

  process.env.TENCENT_EMAIL_SECRET_ID = 'test-secret-id'
  process.env.TENCENT_EMAIL_SECRET_KEY = 'test-secret-key'
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ Response: { RequestId: 'test-request' } }), { status: 200 })
  }) as typeof fetch

  try {
    const result = await sendPasswordResetLinkEmail('test@example.com', 'https://ecfc.fans/reset-password?token=abc')
    assert.deepEqual(result, { sent: true })
    assert.ok(requestBody)
    const capturedBody = requestBody as Record<string, unknown>
    assert.equal(capturedBody.Subject, PASSWORD_RESET_LINK_SUBJECT)
    assert.ok(capturedBody.Simple)
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecretId === undefined) delete process.env.TENCENT_EMAIL_SECRET_ID
    else process.env.TENCENT_EMAIL_SECRET_ID = originalSecretId
    if (originalSecretKey === undefined) delete process.env.TENCENT_EMAIL_SECRET_KEY
    else process.env.TENCENT_EMAIL_SECRET_KEY = originalSecretKey
  }
})
