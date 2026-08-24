import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getEligibleMakeupDates,
  getMakeupRewardCandidates,
  getMakeupOperationWeek,
} from '../lib/checkin-makeup'

const source = (path: string) => readFileSync(path, 'utf8')

test('统一日期服务返回历史缺签，额度用完也不把日期过滤为空', () => {
  const dates = getEligibleMakeupDates({
    startDateKey: '2026-07-01',
    todayKey: '2026-08-23',
    checkedInDateKeys: ['2026-07-22', '2026-07-21'],
    makeupOperationTimes: [new Date('2026-08-20T12:00:00+08:00')],
    scope: 'USER',
    now: new Date('2026-08-23T12:00:00+08:00'),
  })
  const target = dates.find((item) => item.dateKey === '2026-07-20')
  assert.ok(target)
  assert.equal(target?.canUseNow, false)
  const usedWeek = dates.find((item) => item.dateKey === '2026-08-18')
  assert.equal(usedWeek?.canUseNow, false)
  assert.equal(usedWeek?.blockedReason, 'WEEKLY_LIMIT_USED')
})

test('前后台使用相同核心缺签集合，管理员不受用户周额度限制', () => {
  const input = {
    startDateKey: '2026-08-01',
    todayKey: '2026-08-23',
    checkedInDateKeys: ['2026-08-20'],
    makeupOperationTimes: [new Date('2026-08-20T12:00:00+08:00')],
    now: new Date('2026-08-23T12:00:00+08:00'),
  }
  const user = getEligibleMakeupDates({ ...input, scope: 'USER' })
  const admin = getEligibleMakeupDates({ ...input, scope: 'ADMIN' })
  assert.deepEqual(user.map((item) => item.dateKey), admin.map((item) => item.dateKey))
  assert.equal(admin.find((item) => item.dateKey === '2026-08-18')?.canUseNow, true)
  assert.equal(user.find((item) => item.dateKey === '2026-08-18')?.canUseNow, false)
})

test('统一日期服务排除今天、未来和已签到日期，并使用上海日期边界', () => {
  const dates = getEligibleMakeupDates({
    startDateKey: '2026-08-20',
    todayKey: '2026-08-23',
    checkedInDateKeys: ['2026-08-22'],
    makeupOperationTimes: [],
    scope: 'ADMIN',
    now: new Date('2026-08-23T00:01:00+08:00'),
  })
  assert.deepEqual(dates.map((item) => item.dateKey), ['2026-08-21', '2026-08-20'])
})

test('普通用户可以从注册日期起补任意历史日期，服务端不再保留90天窗口', () => {
  const service = source('lib/checkin-makeup.ts')
  assert.equal(getMakeupOperationWeek(new Date('2026-08-24T12:00:00+08:00')).startKey, '2026-08-24')
  assert.match(service, /不能补签用户注册前的日期/)
  assert.doesNotMatch(service, /USER_MAKEUP_DEFAULT_RANGE_DAYS/)
  assert.doesNotMatch(service, /补签日期超出最近90天范围/)
})

test('注册日是候选下界，候选结果可覆盖上周、上月和数月前的缺签', () => {
  const dates = getEligibleMakeupDates({
    startDateKey: '2026-07-11',
    todayKey: '2026-08-24',
    checkedInDateKeys: [],
    makeupOperationTimes: [],
    scope: 'USER',
    now: new Date('2026-08-24T12:00:00+08:00'),
  })
  const keys = new Set(dates.map((item) => item.dateKey))
  assert.equal(keys.has('2026-07-11'), true)
  assert.equal(keys.has('2026-07-10'), false)
  assert.equal(keys.has('2026-07-22'), true)
  assert.equal(keys.has('2026-08-03'), true)
  assert.equal(keys.has('2026-08-23'), true)
})

test('每周额度按补签操作时间计算，不能通过选择不同历史周绕过', () => {
  const currentWeekOperation = new Date('2026-08-20T12:00:00+08:00')
  const blocked = getEligibleMakeupDates({
    startDateKey: '2026-07-01',
    todayKey: '2026-08-23',
    checkedInDateKeys: [],
    makeupOperationTimes: [currentWeekOperation],
    scope: 'USER',
    now: new Date('2026-08-23T12:00:00+08:00'),
  })
  assert.equal(blocked.find((item) => item.dateKey === '2026-07-11')?.canUseNow, false)
  assert.equal(blocked.find((item) => item.dateKey === '2026-08-18')?.canUseNow, false)
  const nextWeekAvailable = getEligibleMakeupDates({
    startDateKey: '2026-07-01',
    todayKey: '2026-08-23',
    checkedInDateKeys: [],
    makeupOperationTimes: [new Date('2026-08-16T12:00:00+08:00')],
    scope: 'USER',
    now: new Date('2026-08-23T12:00:00+08:00'),
  })
  assert.equal(nextWeekAvailable.every((item) => item.canUseNow), true)
  const service = source('lib/checkin-makeup.ts')
  assert.match(service, /createdAt: \{ gte: operationWeekStart, lt: operationWeekEnd \}/)
  assert.doesNotMatch(service, /checkinDateKey: \{ gte: eligibility\.week\.startKey/)
})

test('前台历史日期 API 使用注册日到昨天的一次范围查询，额度状态独立返回', () => {
  const route = source('app/api/checkin/history/route.ts')
  assert.match(route, /checkinDateKey: \{ gte: registrationDateKey, lt: todayKey \}/)
  assert.match(route, /eligibleDateKeys = availableDates\.map/)
  assert.match(route, /weeklyLimit: 1/)
  assert.match(route, /createdAt: true/)
  assert.doesNotMatch(route, /USER_MAKEUP_DEFAULT_RANGE_DAYS|makeupStartKey|makeupRecordsStartKey/)
})

test('补签奖励候选只包含本次新创建的连续签到记录，不回放历史记录', () => {
  const candidates = getMakeupRewardCandidates([
    { id: 'old-7', checkinDateKey: '2026-08-17', nextStreakDay: 7 },
    { id: 'new-8', checkinDateKey: '2026-08-18', nextStreakDay: 8 },
    { id: 'old-9', checkinDateKey: '2026-08-19', nextStreakDay: 9 },
    { id: 'new-6', checkinDateKey: '2026-08-20', nextStreakDay: 6 },
  ], ['2026-08-18', '2026-08-20'])
  assert.deepEqual(candidates.map((item) => item.id), ['new-8'])
})

test('批量管理员补签使用单次事务、dates 请求和单次奖励结算', () => {
  const route = source('app/api/admin/checkin-makeup/route.ts')
  assert.match(route, /body\?\.dates/)
  assert.match(route, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(route, /createMakeupCheckIns\(tx/)
  assert.match(route, /rewardCount: madeUp\.streak\.rewardCount/)
  assert.match(route, /newRewards/)
  assert.doesNotMatch(route, /for \(const targetDateKey of targetDateKeys\)[\s\S]*?createMakeupCheckIn\(tx/)
})

test('前台保留历史日期但明确展示周额度已用完，管理员页面为 checkbox 多选', () => {
  const entry = source('components/CheckInMakeupEntry.tsx')
  const history = source('app/api/checkin/history/route.ts')
  const page = source('app/admin/checkin-makeup/AdminCheckInMakeup.tsx')
  assert.match(entry, /本周补签次数已用完/)
  assert.match(entry, /availableDates\.length} 个历史缺签日期/)
  assert.match(entry, /全部历史缺签日期/)
  assert.match(entry, /checkin-makeup-entry-list/)
  assert.match(history, /getEligibleMakeupDates/)
  assert.match(history, /weeklyRemaining/)
  assert.match(page, /type="checkbox"/)
  assert.match(page, /dates: validSelectedDates/)
})
