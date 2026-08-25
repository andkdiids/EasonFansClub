import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  canExchangeMaterial,
  compareMaterialRuleValue,
  getMaterialExchangeState,
  normalizeMaterialRedeemCode,
  parseMaterialRedeemCode,
  parseMaterialRedemptionQr,
  validateMaterialRedemptionSchedule,
} from '@/lib/material-redemption-domain'
import { stopMaterialRedemptionCamera } from '@/lib/material-redemption-scanner'
import { generateMaterialRedeemCode } from '@/lib/material-redemption-code'
import { normalizeMaterialRules } from '@/lib/material-redemptions'

const schedule = {
  exchangeStartAt: new Date('2026-08-25T00:00:00.000Z'),
  exchangeEndAt: new Date('2026-08-26T00:00:00.000Z'),
  redeemEndAt: new Date('2026-08-27T00:00:00.000Z'),
}

test('物料兑换时间必须满足开始 < 兑换截止 <= 核销截止', () => {
  assert.equal(validateMaterialRedemptionSchedule(schedule), null)
  assert.equal(validateMaterialRedemptionSchedule({ ...schedule, exchangeEndAt: schedule.exchangeStartAt }), '兑换开始时间必须早于兑换结束时间')
  assert.equal(validateMaterialRedemptionSchedule({ ...schedule, redeemEndAt: new Date('2026-08-25T12:00:00.000Z') }), '兑换结束时间不能晚于核销截止时间')
})

test('发布物料的状态在时间边界上可预测', () => {
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, new Date('2026-08-24T23:59:59.000Z')), 'UPCOMING')
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, schedule.exchangeStartAt), 'ACTIVE')
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, schedule.exchangeEndAt), 'ACTIVE')
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, new Date('2026-08-26T00:00:01.000Z')), 'ENDED')
  assert.equal(getMaterialExchangeState('PAUSED', schedule, schedule.exchangeStartAt), 'PAUSED')
  assert.equal(canExchangeMaterial('PAUSED', schedule, schedule.exchangeStartAt), false)
})

test('资格数值运算符和条件结构只允许后端定义的形式', () => {
  assert.equal(compareMaterialRuleValue(10, 'GTE', 10), true)
  assert.equal(compareMaterialRuleValue(10, 'LTE', 9), false)
  assert.equal(compareMaterialRuleValue(10, 'EQ', 10), true)
  assert.deepEqual(normalizeMaterialRules([{ type: 'CHECKIN_TOTAL', operator: 'GTE', value: '3' }]), { rules: [{ type: 'CHECKIN_TOTAL', operator: 'GTE', value: '3' }] })
  const mixed = normalizeMaterialRules([{ type: 'NONE', operator: 'EQ', value: '' }, { type: 'CHECKIN_TOTAL', operator: 'GTE', value: '3' }])
  assert.equal('error' in mixed, true)
  if ('error' in mixed) assert.match(mixed.error, /无门槛条件不能与其他条件同时存在/)
  const invalidOperator = normalizeMaterialRules([{ type: 'HAS_BADGE', operator: 'GTE', value: 'badge-id' }])
  assert.equal('error' in invalidOperator, true)
  if ('error' in invalidOperator) assert.match(invalidOperator.error, /只能使用等于/)
})

test('兑换码统一使用 ECFC，并按精确候选兼容历史 EFC', () => {
  const suffix = 'DAF5E468775C'
  const generated = generateMaterialRedeemCode()
  assert.match(generated, /^ECFC-[A-Z0-9]{12}$/)
  assert.notEqual(generated, generateMaterialRedeemCode())
  assert.equal(normalizeMaterialRedeemCode(suffix), `ECFC-${suffix}`)
  assert.deepEqual(parseMaterialRedeemCode(suffix)?.candidates, [`ECFC-${suffix}`, `EFC-${suffix}`])
  assert.equal(normalizeMaterialRedeemCode(` ECFC-${suffix.toLowerCase()} `), `ECFC-${suffix}`)
  assert.equal(normalizeMaterialRedeemCode(`ecfc - ${suffix.toLowerCase()}`), `ECFC-${suffix}`)
  assert.equal(normalizeMaterialRedeemCode(`EFC-${suffix}`), `EFC-${suffix}`)
  assert.equal(parseMaterialRedeemCode('-'), null)
})

test('二维码只接受 token 或本站核销 URL，不跳转外部地址', () => {
  const token = 'x'.repeat(32)
  assert.deepEqual(parseMaterialRedemptionQr(token), { source: 'token', redeemToken: token })
  assert.deepEqual(parseMaterialRedemptionQr('ECFC-DAF5E468775C'), { source: 'code', redeemCode: 'ECFC-DAF5E468775C' })
  assert.deepEqual(parseMaterialRedemptionQr('https://ecfc.fans/admin/material-redemptions/verify?token=xxxx'), { source: 'url', redeemToken: 'xxxx' })
  assert.equal(parseMaterialRedemptionQr('https://evil.example.com/test'), null)
  assert.equal(parseMaterialRedemptionQr('https://ecfc.fans/profile?token=xxxx'), null)
})

test('摄像头关闭时会停止 ZXing 控制器和所有 MediaStreamTrack', () => {
  let trackStops = 0
  let scannerStops = 0
  stopMaterialRedemptionCamera({ getTracks: () => [{ stop: () => { trackStops += 1 } }, { stop: () => { trackStops += 1 } }] }, { stop: () => { scannerStops += 1 } })
  assert.equal(trackStops, 2)
  assert.equal(scannerStops, 1)
})

test('兑换服务保留事务、幂等、条件库存扣减和订单归属保护', () => {
  const service = readFileSync('lib/material-redemptions.ts', 'utf8')
  const registrationFee = readFileSync('lib/registration-fee.ts', 'utf8')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(service, /const\s+result\s*=\s*await\s+prisma\.\$transaction\(async\s+\(tx\)/)
  assert.match(service, /findUnique\(\{\s*where:\s*\{\s*idempotencyKey:\s*input\.idempotencyKey\s*\}/)
  assert.match(service, /return\s+\{\s*duplicate:\s*true,\s*order:/)
  assert.match(service, /stockRemaining:\s*\{\s*gte:\s*input\.quantity\s*\}/)
  assert.match(service, /if\s*\(stockChanged\.count\s*!==\s*1\)/)
  assert.match(service, /const\s+created\s*=\s*await\s+tx\.materialRedemptionOrder\.create/)
  assert.match(service, /businessKey:\s*`material-redemption:\$\{created\.id\}`/)
  assert.match(service, /where:\s*\{\s*id:\s*orderId,\s*userId\s*\}/)
  assert.match(service, /where:\s*\{\s*id:\s*order\.id,\s*status:\s*'SUCCESS'\s*\},\s*data:\s*\{\s*status:\s*'REDEEMED'/)
  assert.match(service, /if\s*\(changed\.count\s*!==\s*1\)/)
  assert.match(service, /if\s*\(order\.status\s*===\s*'REFUNDED'\)\s*return\s+\{\s*duplicate:\s*true/)
  assert.match(service, /const\s+restored\s*=\s*await\s+tx\.materialRedemption\.updateMany/)
  assert.match(service, /businessKey:\s*`material-redemption-refund:\$\{order\.id\}`/)
  assert.match(service, /status:\s*'REDEEMED'/)
  assert.match(service, /awardRegistrationFee\(tx,\s*\{/)
  assert.match(registrationFee, /export async function consumeRegistrationFee\(\s*tx:\s*Prisma\.TransactionClient/)
  assert.match(registrationFee, /export async function awardRegistrationFee\(\s*tx:\s*Prisma\.TransactionClient/)
  assert.match(registrationFee, /await tx\.pointLog\.create/)
  assert.match(schema, /idempotencyKey\s+String\s+@unique/)
  assert.match(service, /generateMaterialRedeemCode\(\)/)
  assert.doesNotMatch(service, /redeemCode:\s*\{\s*contains/)
})

test('扫码器使用后置优先、原生 BarcodeDetector 和 ZXing fallback，并锁定重复扫描', () => {
  const scanner = readFileSync('components/MaterialRedemptionScanner.tsx', 'utf8')
  const list = readFileSync('app/material-redemptions/MaterialRedemptionsClient.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(scanner, /BarcodeDetector/)
  assert.match(scanner, /@zxing\/browser/)
  assert.match(scanner, /facingMode:\s*\{\s*ideal:\s*'environment'/)
  assert.match(scanner, /scanningLockedRef/)
  assert.match(scanner, /return \(\) => stopCamera\(\)/)
  assert.match(list, /material-redemption-grid/)
  assert.match(css, /\.material-redemption-grid \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css, /\.material-redemption-card-image img \{[^}]*object-fit:contain/)
})

test('物料列表卡片按图片、标题、说明和紧凑信息区自然排版', () => {
  const list = readFileSync('app/material-redemptions/MaterialRedemptionsClient.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  const cardCss = css.slice(css.indexOf('/* 物料兑换列表'), css.indexOf('/* 现场核销摄像头层'))
  assert.match(list, /material\.description\?\.trim\(\)\s*\?\s*<p className="material-redemption-card-description">\{material\.description\}<\/p>/)
  assert.doesNotMatch(list, /暂无说明/)
  assert.match(list, /formatCompactDate/)
  assert.match(list, /minute: '2-digit'/)
  assert.doesNotMatch(list, /second: '2-digit'/)
  assert.match(cardCss, /\.material-redemption-grid \{[^}]*align-items:start[^}]*grid-template-columns:repeat\(3/)
  assert.match(cardCss, /\.material-redemption-card-image \{[^}]*aspect-ratio:4 \/ 3/)
  assert.match(cardCss, /\.material-redemption-card-image img \{[^}]*object-fit:contain/)
  assert.match(cardCss, /\.material-redemption-card-heading h2 \{[^}]*font-size:16px[^}]*font-weight:900[^}]*-webkit-line-clamp:2/)
  assert.match(cardCss, /\.material-redemption-card-description \{[^}]*-webkit-line-clamp:2/)
  assert.doesNotMatch(cardCss, /\.material-redemption-card-body \{[^}]*min-height/)
  assert.doesNotMatch(cardCss, /\.material-redemption-card-meta \{[^}]*margin-top:auto/)
  assert.doesNotMatch(cardCss, /\.material-redemption-card-heading \{[^}]*justify-content:space-between/)
  assert.match(css, /\.material-redemption-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); gap:8px; \}/)
  assert.match(css, /\.material-redemption-card-image \{ aspect-ratio:1 \/ 1; \}/)
})
