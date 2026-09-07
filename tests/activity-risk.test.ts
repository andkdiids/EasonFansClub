import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { evaluateActivityRisk, type ActivityRiskRegistrationInput } from '@/lib/activity-risk-shared'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const activityStart = Date.parse('2026-09-07T10:00:00.000Z')

function registration(index: number, options: { device?: string | null; ip?: string | null; ageMinutes?: number; userId?: string } = {}): ActivityRiskRegistrationInput {
  const activityTime = new Date(activityStart + index * 60 * 1000)
  const accountAge = options.ageMinutes ?? 60
  return {
    registrationId: `registration-${index}`,
    userId: options.userId || `user-${index}`,
    accountRegisteredAt: new Date(activityTime.getTime() - accountAge * 60 * 1000),
    activityRegisteredAt: activityTime,
    registrationIpHash: options.ip === undefined ? 'ip-shared' : options.ip,
    registrationDeviceId: options.device === undefined ? 'device-shared' : options.device,
    registrationUserAgent: 'Mozilla/5.0',
    registrationRequestId: `request-${index}`,
  }
}

test('单个报名或不同设备/IP不会形成风险组', () => {
  const result = evaluateActivityRisk([
    registration(0, { device: 'device-a', ip: 'ip-a' }),
    registration(1, { device: 'device-b', ip: 'ip-b' }),
  ])
  assert.equal(result.groups.length, 0)
  assert.equal(result.normalCount, 2)
})

test('同一设备两个账号是 MEDIUM，不直接判定为作弊', () => {
  const result = evaluateActivityRisk([registration(0), registration(1)])
  assert.equal(result.mediumCount, 2)
  assert.equal(result.highCount, 0)
  assert.equal(result.groups[0]?.level, 'MEDIUM')
  assert.match(result.groups[0]?.reasons.join(' ') || '', /匿名设备标识/)
})

test('同一设备三个账号升级 HIGH', () => {
  const result = evaluateActivityRisk([registration(0), registration(1), registration(2)])
  assert.equal(result.highCount, 3)
  assert.equal(result.groups[0]?.level, 'HIGH')
  assert.equal(result.groups[0]?.accountCount, 3)
})

test('同一 IP 两个账号只产生 LOW 提示', () => {
  const result = evaluateActivityRisk([
    registration(0, { device: 'device-a', ip: 'ip-shared' }),
    registration(1, { device: 'device-b', ip: 'ip-shared' }),
  ])
  assert.equal(result.lowCount, 2)
  assert.equal(result.mediumCount, 0)
  assert.equal(result.highCount, 0)
  assert.deepEqual(result.groups[0]?.signals, ['SHARED_IP'])
})

test('IP 30 分钟和 24 小时窗口只增加可解释信号，不单独升级 HIGH', () => {
  const result = evaluateActivityRisk(Array.from({ length: 5 }, (_, index) => registration(index, { device: `device-${index}`, ip: 'ip-shared' })))
  assert.equal(result.lowCount, 5)
  assert.equal(result.highCount, 0)
  assert.deepEqual(result.groups[0]?.signals, ['SHARED_IP', 'SHARED_IP_BURST', 'HIGH_FREQUENCY_IP'])
  assert.match(result.groups[0]?.reasons.join(' ') || '', /30 分钟/)
  assert.match(result.groups[0]?.reasons.join(' ') || '', /24 小时/)
})

test('注册后 5 分钟内报名是新账号信号；与共享 IP 组合为 MEDIUM', () => {
  const result = evaluateActivityRisk([
    registration(0, { device: 'device-a', ip: 'ip-shared', ageMinutes: 2 }),
    registration(1, { device: 'device-b', ip: 'ip-shared', ageMinutes: 60 }),
  ])
  assert.equal(result.mediumCount, 2)
  assert.ok(result.groups[0]?.signals.includes('NEW_ACCOUNT_REGISTRATION'))
  assert.match(result.groups[0]?.reasons.join(' ') || '', /注册后 30 分钟/)
})

test('历史报名四个审计字段均为空时只显示 legacy 计数，不因缺失数据升风险', () => {
  const historical = registration(0, { device: null, ip: null })
  historical.registrationUserAgent = null
  historical.registrationRequestId = null
  const result = evaluateActivityRisk([historical])
  assert.equal(result.groups.length, 0)
  assert.equal(result.normalCount, 1)
  assert.equal(result.legacyWithoutAuditData, 1)
})

test('实现保存 HMAC 审计信号、匿名设备标识和只读后台风险接口', () => {
  const schema = read('prisma/schema.prisma')
  const registerRoute = read('app/api/activities/[activityId]/register/route.ts')
  const device = read('lib/activity-device.ts')
  const risk = read('lib/activity-risk.ts')
  const adminRoute = read('app/api/admin/activities/[activityId]/risk/route.ts')
  const panel = read('components/activities/ActivityRiskReviewPanel.tsx')
  assert.match(schema, /registrationIpHash\s+String\?/)
  assert.match(schema, /registrationUserAgent\s+String\?/)
  assert.match(schema, /registrationDeviceId\s+String\?/)
  assert.match(schema, /registrationRequestId\s+String\?/)
  assert.match(registerRoute, /activityRegistrationAuditData\(request\)/)
  assert.match(registerRoute, /\.\.\.auditData/)
  assert.match(risk, /createHmac\('sha256'/)
  assert.match(risk, /getClientIp\(request\)/)
  assert.match(device, /localStorage/)
  assert.match(device, /createUUID\(\)/)
  assert.doesNotMatch(device.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /canvas|WebGL|AudioContext|fonts/i)
  assert.match(adminRoute, /requireAdmin\('activity_manage'\)/)
  assert.match(panel, /不自动取消报名、不取消抽奖资格、不封禁账号/)
})

test('开奖在同一事务写入不可变候选快照，历史开奖不会伪造快照', () => {
  const schema = read('prisma/schema.prisma')
  const lottery = read('lib/activity-lottery.ts')
  const migration = read('prisma/migrations/20260907120000_add_activity_registration_risk_audit/migration.sql')
  assert.match(schema, /model ActivityLotteryCandidateSnapshot/)
  assert.match(schema, /@@unique\(\[lotteryId, registrationId\]\)/)
  assert.match(schema, /Registration\s+ActivityRegistration\s+@relation\([^\n]*onDelete: Cascade/)
  assert.match(schema, /User\s+User\s+@relation\([^\n]*onDelete: Cascade/)
  assert.match(lottery, /tx\.activityLotteryCandidateSnapshot\.createMany\(/)
  assert.match(lottery, /eligibleAtDraw: true/)
  assert.match(lottery, /snapshotAt: now/)
  assert.match(migration, /CREATE TABLE `ActivityLotteryCandidateSnapshot`/)
  assert.match(migration, /FOREIGN KEY \(`registrationId`\)[^\n]*ON DELETE CASCADE/)
  assert.match(migration, /FOREIGN KEY \(`userId`\)[^\n]*ON DELETE CASCADE/)
})
