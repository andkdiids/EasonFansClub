import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getEligibleMakeupDates,
  getMakeupRewardCandidates,
  USER_MAKEUP_DEFAULT_RANGE_DAYS,
} from '../lib/checkin-makeup'

const source = (path: string) => readFileSync(path, 'utf8')

test('统一日期服务返回历史缺签，额度用完也不把日期过滤为空', () => {
  const dates = getEligibleMakeupDates({
    startDateKey: '2026-07-01',
    todayKey: '2026-08-24',
    checkedInDateKeys: ['2026-07-22', '2026-07-21'],
    makeupDateKeys: ['2026-08-20'],
    scope: 'USER',
    now: new Date('2026-08-24T12:00:00+08:00'),
  })
  const target = dates.find((item) => item.dateKey === '2026-07-20')
  assert.ok(target)
  assert.equal(target?.canUseNow, true)
  const usedWeek = dates.find((item) => item.dateKey === '2026-08-18')
  assert.equal(usedWeek?.canUseNow, false)
  assert.equal(usedWeek?.blockedReason, 'WEEKLY_LIMIT_USED')
})

test('前后台使用相同核心缺签集合，管理员不受用户周额度限制', () => {
  const input = {
    startDateKey: '2026-08-01',
    todayKey: '2026-08-24',
    checkedInDateKeys: ['2026-08-20'],
    makeupDateKeys: ['2026-08-18'],
    now: new Date('2026-08-24T12:00:00+08:00'),
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
    todayKey: '2026-08-24',
    checkedInDateKeys: ['2026-08-22'],
    makeupDateKeys: [],
    scope: 'ADMIN',
    now: new Date('2026-08-24T00:01:00+08:00'),
  })
  assert.deepEqual(dates.map((item) => item.dateKey), ['2026-08-23', '2026-08-21', '2026-08-20'])
  assert.equal(USER_MAKEUP_DEFAULT_RANGE_DAYS, 90)
})

test('普通用户付费/挑战服务端继续封锁90天窗口外的历史日期', () => {
  const service = source('lib/checkin-makeup.ts')
  assert.match(service, /oldestAllowedDateKey = shiftShanghaiDateKey\(eligibility\.todayKey, -\(USER_MAKEUP_DEFAULT_RANGE_DAYS - 1\)\)/)
  assert.match(service, /补签日期超出最近90天范围/)
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
  assert.match(history, /getEligibleMakeupDates/)
  assert.match(history, /weeklyRemaining/)
  assert.match(page, /type="checkbox"/)
  assert.match(page, /dates: validSelectedDates/)
})
