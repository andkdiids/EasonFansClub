import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateCheckinStreaks } from '../lib/checkin'

const at = (dateKey: string) => new Date(`${dateKey}T12:00:00+08:00`)

test('断签后续签:12 与 14-20,14 到 20 为 7 个连续自然日', () => {
  const keys = ['2026-07-12', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20']
  assert.deepEqual(calculateCheckinStreaks(keys, at('2026-07-20')), { currentStreak: 7, longestStreak: 7, totalDays: 8 })
})

test('两段各三天:1-3 与 7-9', () => {
  const keys = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-07', '2026-07-08', '2026-07-09']
  assert.deepEqual(calculateCheckinStreaks(keys, at('2026-07-09')), { currentStreak: 3, longestStreak: 3, totalDays: 6 })
})

test('跨月连续:7/30、7/31、8/1、8/2 不间断', () => {
  const keys = ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']
  assert.deepEqual(calculateCheckinStreaks(keys, at('2026-08-02')), { currentStreak: 4, longestStreak: 4, totalDays: 4 })
})

test('同一天重复 dateKey 只计一天', () => {
  const keys = ['2026-07-19', '2026-07-19', '2026-07-19', '2026-07-20']
  assert.deepEqual(calculateCheckinStreaks(keys, at('2026-07-20')), { currentStreak: 2, longestStreak: 2, totalDays: 2 })
})

test('历史 streakDay 快照全部错误时读取结果仍完全由 dateKeys 决定', () => {
  // 重算函数只接收 dateKeys,快照字段不参与计算
  assert.deepEqual(calculateCheckinStreaks(['2026-07-18', '2026-07-19', '2026-07-20'], at('2026-07-20')), { currentStreak: 3, longestStreak: 3, totalDays: 3 })
  const checkinRoute = readFileSync('app/api/checkin/route.ts', 'utf8')
  const profileCheckins = readFileSync('app/api/profile/checkins/route.ts', 'utf8')
  assert.doesNotMatch(checkinRoute, /yesterdayCheckIn/)
  assert.doesNotMatch(profileCheckins, /streakDay: 'desc'/)
  assert.match(profileCheckins, /calculateCheckinStreaks/)
})

test('User.consecutiveDays 旧值不影响排行榜与成就', () => {
  const rankings = readFileSync('app/rankings/page.tsx', 'utf8')
  const achievements = readFileSync('lib/achievements.ts', 'utf8')
  assert.doesNotMatch(rankings, /consecutiveDays/)
  assert.doesNotMatch(achievements, /consecutiveDays/)
  assert.match(rankings, /calculateCheckinStreaks/)
  assert.match(achievements, /calculateCheckinStreaks/)
})

test('POST 已签到与 P2002 分支与事务内同为重算口径', () => {
  const route = readFileSync('app/api/checkin/route.ts', 'utf8')
  const post = route.split('export async function POST')[1] || ''
  const recomputes = post.match(/calculateCheckinStreaks\(/g) || []
  assert.ok(recomputes.length >= 3, `POST 内应有事务、已签到、P2002 三处重算,实际 ${recomputes.length} 处`)
  assert.doesNotMatch(post, /profile\?\.consecutiveDays|verifyUser\?\.consecutiveDays|result\.user\.consecutiveDays/)
})

test('签到成功响应严格使用事务后查询到的 CheckIn 奖励值', () => {
  const route = readFileSync('app/api/checkin/route.ts', 'utf8')
  const button = readFileSync('components/CheckInButton.tsx', 'utf8')
  assert.match(route, /gainedPoints: verifyCheckIn\.points/)
  assert.match(route, /gainedExp: verifyCheckIn\.exp/)
  assert.match(route, /\[checkin\.create\.before\]/)
  assert.match(route, /\[checkin\.create\.after\]/)
  assert.match(route, /\[checkin\.verify\.result\]/)
  assert.match(route, /\[checkin\.verify\.mismatch\]/)
  assert.match(button, /verifyData\?\.checkedToday/)
  assert.match(button, /\+\$\{nextCheckIn\.points\} 积分、\+\$\{nextCheckIn\.exp\} 经验/)
})

test('应用运行时只接受 DATABASE_URL 中的 MySQL 连接', () => {
  const prisma = readFileSync('lib/prisma.ts', 'utf8')
  assert.match(prisma, /process\.env\.DATABASE_URL/)
  assert.match(prisma, /url\.protocol !== 'mysql:'/)
  assert.match(prisma, /\[prisma\.database\]/)
  assert.doesNotMatch(prisma, /process\.env\.(?:MYSQL_TEST_URL|MIGRATION_MYSQL_URL|HYPERDRIVE_DATABASE_URL)/)
  assert.doesNotMatch(prisma, /new PrismaPg/)
})

test('Asia/Shanghai 跨 UTC 日期边界连续天数不错位', () => {
  // UTC 7-19 17:30 即北京 7-20 01:30:今天应算 7-20,三天连续
  assert.deepEqual(calculateCheckinStreaks(['2026-07-18', '2026-07-19', '2026-07-20'], new Date('2026-07-19T17:30:00Z')), { currentStreak: 3, longestStreak: 3, totalDays: 3 })
  // UTC 7-19 16:30 即北京 7-20 00:30:7-20 的签到应计入今天而不是明天
  assert.equal(calculateCheckinStreaks(['2026-07-20'], new Date('2026-07-19T16:30:00Z')).currentStreak, 1)
})
