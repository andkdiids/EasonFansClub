import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  BETA_CONFIG_KEY,
  deriveBetaInviteStatus,
  generateBetaInviteCode,
  hashBetaValue,
  maskBetaInviteCode,
  normalizeBetaInviteCode,
  normalizeInstallationId,
  parseBetaGateConfig,
} from '../lib/mobile-beta'

test('内测码由高熵字符组成并只暴露掩码', () => {
  const first = generateBetaInviteCode()
  const second = generateBetaInviteCode()
  assert.match(first.code, /^ECFC-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/)
  assert.notEqual(first.code, second.code)
  assert.equal(first.codeHash.length, 64)
  assert.ok(first.codePrefix.length <= 16)
  assert.equal(first.codeHash, hashBetaValue(first.code))
  assert.equal(first.maskedCode, maskBetaInviteCode(first.code))
  assert.match(first.maskedCode, /^ECFC-[A-Z2-9]{4}••••[A-Z2-9]{4}$/)
  assert.equal(first.maskedCode.includes(first.code), false)
})

test('内测码规范化接受大小写、空格、短横线和紧凑输入', () => {
  const code = 'ECFC-7K4M-P9DX-Q2WR'
  assert.equal(normalizeBetaInviteCode(` ecfc 7k4m-p9dx q2wr `), code)
  assert.equal(normalizeBetaInviteCode('7k4mp9dxq2wr'), code)
  assert.equal(normalizeBetaInviteCode('ECFC-0000-0000-0000'), null)
})

test('安装实例只接受随机 UUID v4，不接受硬件标识', () => {
  assert.equal(normalizeInstallationId('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000')
  assert.equal(normalizeInstallationId('imei-123'), null)
  assert.equal(normalizeInstallationId('550e8400-e29b-11d4-a716-446655440000'), null)
})

test('邀请码状态由服务端状态、激活数和有效期决定', () => {
  const now = new Date('2026-09-21T00:00:00.000Z')
  assert.equal(deriveBetaInviteStatus({ status: 'ACTIVE', activationCount: 0, maxActivations: 1, expiresAt: null }, now), 'ACTIVE')
  assert.equal(deriveBetaInviteStatus({ status: 'ACTIVE', activationCount: 1, maxActivations: 1, expiresAt: null }, now), 'USED')
  assert.equal(deriveBetaInviteStatus({ status: 'ACTIVE', activationCount: 0, maxActivations: 1, expiresAt: new Date('2026-09-20T00:00:00.000Z') }, now), 'EXPIRED')
  assert.equal(deriveBetaInviteStatus({ status: 'REVOKED', activationCount: 0, maxActivations: 1, expiresAt: null }, now), 'REVOKED')
})

test('全局开关配置严格接受 boolean，默认 key 稳定', () => {
  assert.deepEqual(parseBetaGateConfig({ betaAccessRequired: true }), { betaAccessRequired: true })
  assert.deepEqual(parseBetaGateConfig({ betaAccessRequired: false }), { betaAccessRequired: false })
  assert.equal(parseBetaGateConfig({ betaAccessRequired: 'false' }), null)
  assert.equal(BETA_CONFIG_KEY, 'mobile.betaAccess.required')
})

test('公开配置、激活和验证 API 不使用 Cookie 作为准入凭证', () => {
  const root = join(process.cwd())
  const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')
  assert.match(source('app/api/mobile/config/route.ts'), /getBetaAccessConfig/)
  assert.match(source('app/api/mobile/beta/activate/route.ts'), /consumeApiRateLimits/)
  assert.match(source('app/api/mobile/beta/verify/route.ts'), /BETA_TOKEN_HEADER/)
  assert.doesNotMatch(source('app/api/mobile/beta/activate/route.ts'), /console\.log\([^)]*code/i)
})
