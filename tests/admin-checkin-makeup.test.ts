import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildAdminEligibleMissingDates,
  buildAdminRecentCheckIns,
  getAdminMakeupWindow,
  normalizeAdminMakeupRangeDays,
} from '../lib/admin-checkin-makeup'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('管理员漏签候选默认查询最近90天，并统一使用上海业务日期', () => {
  assert.equal(normalizeAdminMakeupRangeDays(undefined), 90)
  assert.equal(normalizeAdminMakeupRangeDays('30'), 30)
  assert.equal(normalizeAdminMakeupRangeDays('180'), 180)
  assert.equal(normalizeAdminMakeupRangeDays('7'), 90)
  const window = getAdminMakeupWindow({
    todayKey: '2026-08-24',
    createdAt: new Date('2026-01-10T00:30:00+08:00'),
  })
  assert.equal(window.startDateKey, '2026-05-27')
  assert.equal(window.registrationDateKey, '2026-01-10')
  assert.equal(window.todayKey, '2026-08-24')
})

test('已签到、今天、未来和注册前日期均不会进入管理员可补列表', () => {
  const window = getAdminMakeupWindow({
    todayKey: '2026-08-24',
    createdAt: new Date('2026-08-10T00:30:00+08:00'),
  })
  const dates = buildAdminEligibleMissingDates({
    startDateKey: window.registrationDateKey,
    todayKey: window.todayKey,
    checkinDateKeys: ['2026-08-20', '2026-08-22'],
  })
  assert.ok(dates.includes('2026-08-23'))
  assert.ok(!dates.includes('2026-08-20'))
  assert.ok(!dates.includes('2026-08-22'))
  assert.ok(!dates.includes('2026-08-24'))
  assert.ok(!dates.includes('2026-08-25'))
  assert.ok(!dates.includes('2026-08-09'))
  assert.equal(dates[0], '2026-08-23')
})

test('最近签到概览同时标记正常/补签和可补漏签，不包含今天', () => {
  const recent = buildAdminRecentCheckIns({
    startDateKey: '2026-08-18',
    todayKey: '2026-08-24',
    days: 14,
    records: [
      { checkinDateKey: '2026-08-23', type: 'NORMAL', streakDay: 3 },
      { checkinDateKey: '2026-08-21', type: 'MAKEUP_ADMIN', streakDay: 1 },
    ],
  })
  assert.equal(recent[0].checkinDateKey, '2026-08-23')
  assert.equal(recent[0].status, 'CHECKED_IN')
  assert.equal(recent[0].type, 'NORMAL')
  assert.equal(recent.find((item) => item.checkinDateKey === '2026-08-22')?.status, 'MISSING')
  assert.equal(recent.some((item) => item.checkinDateKey >= '2026-08-24'), false)
})

test('管理员页面选择服务端漏签列表，业务日期为YYYY-MM-DD并解释按钮禁用原因', () => {
  const page = source('app/admin/checkin-makeup/AdminCheckInMakeup.tsx')
  assert.match(page, /eligibleMissingDates/)
  assert.match(page, /recentCheckIns/)
  assert.match(page, /targetDateKey: selectedDateKey/)
  assert.doesNotMatch(page, /type="date"/)
  assert.match(page, /请先搜索并选择用户/)
  assert.match(page, /正在加载该用户的漏签日期/)
  assert.match(page, /当前查询范围内没有可补签日期/)
  assert.match(page, /请选择需要补签的日期/)
  assert.match(page, /所选日期已不再是可补签漏签，请重新选择/)
  assert.match(page, /请填写补签原因/)
  assert.match(page, /setSelected\(foundUsers\[0\]\)/)
  assert.match(page, /void loadMakeupData\(selected\.id, rangeDays\)/)
})

test('管理员查询接口服务端计算漏签，提交再次校验权限、注册日期、过去日期和重复签到', () => {
  const route = source('app/api/admin/checkin-makeup/route.ts')
  assert.match(route, /requireAdmin\('checkin_manage'\)/)
  assert.match(route, /eligibleMissingDates/)
  assert.match(route, /checkinDateKey: \{ gte: window\.startDateKey, lt: todayKey \}/)
  assert.match(route, /getShanghaiDateKey\(targetUser\.createdAt\)/)
  assert.match(route, /BEFORE_REGISTRATION/)
  assert.match(route, /targetDateKey >= todayKey/)
  assert.match(route, /userId_checkinDateKey/)
  assert.match(route, /type: 'MAKEUP_ADMIN'/)
  assert.match(route, /action: 'CHECK_IN_ADMIN_MAKEUP'/)
  assert.doesNotMatch(route, /consumeRegistrationFee|pointLog/)
})

test('成功补签后管理员页面清空已选日期并重新加载漏签列表', () => {
  const page = source('app/admin/checkin-makeup/AdminCheckInMakeup.tsx')
  assert.match(page, /setSelectedDateKey\('\'\)/)
  assert.match(page, /补签成功/)
  assert.match(page, /消耗挂号费：0/)
  assert.match(page, /longTermRewardTriggered/)
})
