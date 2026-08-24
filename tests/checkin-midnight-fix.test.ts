import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getCheckInPublicStats, resetCheckInStatsCacheForTests } from '../lib/checkin-stats'

const read = (path: string) => readFileSync(path, 'utf8')

test('100 个并发公共统计请求在单进程内只回源一次', async () => {
  resetCheckInStatsCacheForTests()
  let countCalls = 0
  let groupByCalls = 0
  const db = {
    checkIn: {
      count: async () => {
        countCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return 100
      },
      groupBy: async () => {
        groupByCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return [{ mood: 'GOOD', _count: { mood: 100 } }]
      },
    },
  }

  const results = await Promise.all(
    Array.from({ length: 100 }, () => getCheckInPublicStats('2026-08-25', db as never)),
  )

  assert.equal(countCalls, 1)
  assert.equal(groupByCalls, 1)
  assert.equal(results.every((result) => result.todayCount === 100), true)
  assert.deepEqual(results[0].moodStats, [{ mood: 'GOOD', _count: { mood: 100 } }])
  resetCheckInStatsCacheForTests()
})

test('签到 GET 不再执行全站 mood GROUP BY，页面与 summary 复用公共统计缓存', () => {
  const route = read('app/api/checkin/route.ts')
  const getRoute = route.slice(0, route.indexOf('export async function POST'))
  const page = read('app/checkin/page.tsx')
  const summary = read('app/api/checkin/summary/route.ts')
  const preview = read('lib/page-layout/preview-data.ts')

  assert.match(getRoute, /getTodayCheckInCount\(todayKey\)/)
  assert.doesNotMatch(getRoute, /checkIn\.groupBy|moodStats/)
  assert.match(page, /getCheckInPublicStats\(todayKey\)/)
  assert.match(summary, /getCheckInPublicStats\(todayKey\)/)
  assert.match(preview, /getTodayCheckInCount\(getShanghaiDateKey\(today\)\)/)
  assert.doesNotMatch(preview, /checkIn\.count\(\{ where: \{ checkinDateKey/)
})

test('客户端只在 focus/跨标签日期变更后按需检查，不在午夜自动齐步 GET', () => {
  const button = read('components/CheckInButton.tsx')
  assert.doesNotMatch(button, /msUntilNextBeijingMidnight|setTimeout\(refreshTodayState/)
  assert.match(button, /knownDateRef/)
  assert.match(button, /if \(!force && currentDateKey === knownDateRef\.current\) return/)
  assert.match(button, /window\.addEventListener\('focus', onFocus\)/)
  assert.doesNotMatch(button, /onCheckInCompleted|verifyResponse|verifyData\?\.checkedToday/)
})

test('CheckIn 索引与每日任务锁 migration 都是增量定义', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260825130000_add_checkin_stats_and_daily_job_lock/migration.sql')
  assert.match(schema, /@@index\(\[checkinDateKey, mood\]\)/)
  assert.match(schema, /model DailyJobExecution[\s\S]*@@unique\(\[jobKey, dateKey\]\)/)
  assert.match(migration, /CREATE INDEX `CheckIn_checkinDateKey_mood_idx` ON `CheckIn`\(`checkinDateKey`, `mood`\)/)
  assert.match(migration, /UNIQUE INDEX `DailyJobExecution_jobKey_dateKey_key`/)
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|UPDATE `User`|INSERT INTO `CheckIn`|INSERT INTO `PointLog`/i)
})

test('生日任务脱离首页并使用受保护 endpoint 与数据库级运行锁', () => {
  const home = read('lib/home-data.ts')
  const birthday = read('lib/birthday.ts')
  const execution = read('lib/daily-job-execution.ts')
  const endpoint = read('app/api/internal/daily-jobs/birthday/route.ts')
  assert.doesNotMatch(home, /grantTodayBirthdayRewards|triggerBirthdayRewardsSweep/)
  assert.match(birthday, /runDailyJob\([\s\S]*jobKey: 'birthday-rewards'/)
  assert.match(execution, /dailyJobExecution\.create/)
  assert.match(execution, /jobKey_dateKey/)
  assert.match(endpoint, /x-daily-job-secret/)
  assert.match(endpoint, /timingSafeEqual/)
  assert.match(endpoint, /runDailyBirthdayRewards\(dateKey\)/)
})

test('签到后处理失败不会影响主响应，且性能日志不包含敏感请求字段', () => {
  const route = read('app/api/checkin/route.ts')
  assert.match(route, /Promise\.allSettled/)
  assert.match(route, /phase: 'friendActivity'/)
  assert.match(route, /phase: 'dailyTaskProgress'/)
  assert.match(route, /phase: 'badgeEvaluation'/)
  assert.match(route, /checkin\.post_process\.performance/)
  const performanceLog = route.slice(route.indexOf('function logCheckInPostProcessError'), route.indexOf('export async function GET'))
  assert.match(performanceLog, /route: '\/api\/checkin'/)
  assert.match(performanceLog, /totalMs|transactionMs|postProcessMs/)
  assert.doesNotMatch(performanceLog, /token|session|password|phone|ipAddress|ip:/i)
})

test('POST 核心事务只保留签到与必要奖励写入，并把非核心写入移到事务后', () => {
  const route = read('app/api/checkin/route.ts')
  const transaction = route.slice(route.indexOf('prisma.$transaction'), route.indexOf('const transactionMs'))
  const count = (pattern: RegExp) => transaction.match(pattern)?.length || 0

  assert.equal(count(/tx\.checkIn\.findMany/g), 1)
  assert.equal(count(/tx\.checkIn\.create/g), 1)
  assert.equal(count(/tx\.checkIn\.update/g), 1)
  assert.equal(count(/awardRegistrationFee\(tx/g), 2)
  assert.equal(count(/awardExperience\(tx/g), 1)
  assert.equal(count(/tx\.user\.update/g), 1)
  assert.doesNotMatch(transaction, /tx\.friendActivity\.create/)
  assert.doesNotMatch(route, /checkinApi\.postVerify|verifyCheckIn|verifyUser/)
  assert.match(route, /phase: 'friendActivity'/)
  assert.match(route, /phase: 'dailyTaskProgress'/)
  assert.match(route, /phase: 'achievements'/)
})
