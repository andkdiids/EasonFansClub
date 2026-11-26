import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultLeaderboardRewardsConfig,
  leaderboardRewardsConfigError,
  rankReward,
  validateLeaderboardRewardsConfig,
  WEEKLY_CAP,
  DEFAULT_AMOUNTS,
} from '../lib/leaderboard-rewards-config'
import {
  beijingDayStart,
  beijingWeekStartKey,
  isPeriodAfterGoLive,
  resolveSettlementPeriod,
} from '../lib/leaderboard-rewards-period'
import {
  badgeGrantKey,
  decideCap,
  resolveBadgeAwards,
  rewardBusinessKey,
  rewardNotificationKey,
} from '../lib/leaderboard-rewards-rules'

/**
 * Contract tests for the automatic leaderboard reward settlements. Pure logic
 * only: no DB, no network. These pin the money rules reported to production.
 */

const beijing = (iso: string) => new Date(`${iso.replace(' ', 'T')}+08:00`)

test('默认配置：三类周上限均 270，奖励档位与口令一致', () => {
  const c = validateLeaderboardRewardsConfig(defaultLeaderboardRewardsConfig)
  assert.ok(c)
  assert.equal(WEEKLY_CAP, 270)
  assert.equal(c.entertainment.weeklyCap, 270)
  assert.equal(c.comment.weeklyCap, 270)
  assert.equal(c.aspirin.weeklyCap, 270)
  assert.equal(c.entertainment.weeklyTop3, 74)
  assert.equal(c.entertainment.weeklyTop4To10, 27)
  assert.equal(c.entertainment.monthlyTop3, 127)
  assert.equal(c.entertainment.monthlyTop4To10, 74)
  assert.equal(c.comment.weeklyTop3, 74)
  assert.equal(c.aspirin.weeklyTop3, 74)
  assert.equal(DEFAULT_AMOUNTS.commentWeeklyTop4To10, 27)
  assert.equal(DEFAULT_AMOUNTS.aspirinWeeklyTop4To10, 27)
  // Default is OFF with no go-live: nothing auto-settles until an admin enables it.
  assert.equal(c.enabled, false)
  assert.equal(c.enabledAt, null)
  // No explicit first-settlement boundary by default: strict full-cycle guard.
  assert.equal(c.firstWeeklyPeriod, null)
  assert.equal(c.firstMonthlyPeriod, null)
})

test('未绑定勋章是安全有效状态（引擎靠 && badgeId 保证不误发）', () => {
  assert.equal(leaderboardRewardsConfigError(defaultLeaderboardRewardsConfig), null)
  // Enabled badge rules with an empty binding stay valid; the engine grants
  // nothing until an admin binds a real Badge.
  const unbound = structuredClone(defaultLeaderboardRewardsConfig)
  unbound.comment.thankYouEnabled = true
  unbound.comment.thankYouBadgeId = ''
  unbound.entertainment.kSongKingEnabled = true
  unbound.entertainment.kSongKingBadgeId = ''
  assert.equal(leaderboardRewardsConfigError(unbound), null)
  // Invalid badge-id type is still rejected.
  const bad = structuredClone(defaultLeaderboardRewardsConfig)
  bad.comment.thankYouBadgeId = 123 as never
  assert.match(leaderboardRewardsConfigError(bad) || '', /谢谢侬勋章绑定/)
})

test('rankReward：1–3 名 top3，4–10 名 top4To10，11+ 为 0', () => {
  assert.equal(rankReward(1, 74, 27), 74)
  assert.equal(rankReward(3, 74, 27), 74)
  assert.equal(rankReward(4, 74, 27), 27)
  assert.equal(rankReward(10, 74, 27), 27)
  assert.equal(rankReward(11, 74, 27), 0)
  assert.equal(rankReward(0, 74, 27), 0)
})

test('270 上限：逐笔裁剪，第三个用户起按剩余额度发放', () => {
  // 74 + 74 + 74 = 222; 4th gets 27 (remaining 48 -> min(74,48)=48); wait:
  // after 3 users used=222, remaining=48, 4th original=74 -> actual 48, clipped 26.
  const d1 = decideCap(74, 0, 270)
  assert.equal(d1.actualAmount, 74)
  assert.equal(d1.capUsedAfter, 74)
  const d2 = decideCap(74, d1.capUsedAfter, 270)
  assert.equal(d2.actualAmount, 74)
  const d3 = decideCap(74, d2.capUsedAfter, 270)
  assert.equal(d3.actualAmount, 74)
  assert.equal(d3.capUsedAfter, 222)
  const d4 = decideCap(74, d3.capUsedAfter, 270)
  assert.equal(d4.actualAmount, 48)
  assert.equal(d4.clippedAmount, 26)
  assert.equal(d4.capUsedAfter, 270)
  const d5 = decideCap(27, d4.capUsedAfter, 270)
  assert.equal(d5.eligible, false)
  assert.equal(d5.actualAmount, 0)
  assert.equal(d5.clippedAmount, 27)
})

test('零奖励（11 名后）不触碰额度', () => {
  const d = decideCap(0, 100, 270)
  assert.equal(d.eligible, false)
  assert.equal(d.capUsedBefore, 100)
  assert.equal(d.capUsedAfter, 100)
  assert.equal(d.clippedAmount, 0)
})

test('月榜奖励不占周额度：调用方传 null 上限即不裁剪', () => {
  // The monthly path passes weeklyCap=null and never touches the weekly cap row
  // (see settlement engine). decideCap with an unbounded cap pays in full.
  const d = decideCap(127, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(d.actualAmount, 127)
  assert.equal(d.clippedAmount, 0)
  assert.equal(d.eligible, true)
})

test('周结算周期 = 上周一 00:00 至本周一 00:00（北京时间左闭右开）', () => {
  // Monday 2026-11-30 06:00 Beijing -> settle week 2026-11-23..2026-11-30
  const p = resolveSettlementPeriod('weekly', beijing('2026-11-30 06:00'))
  assert.equal(p.startDateKey, '2026-11-23')
  assert.equal(p.endDateKey, '2026-11-30')
  assert.equal(p.periodKey, 'week:2026-11-23')
  assert.equal(p.start.toISOString(), '2026-11-22T16:00:00.000Z')
  assert.equal(p.endExclusive.toISOString(), '2026-11-29T16:00:00.000Z')
})

test('月结算周期 = 上月 1 日至本月 1 日（北京时间）', () => {
  const p = resolveSettlementPeriod('monthly', beijing('2026-12-01 06:00'))
  assert.equal(p.startDateKey, '2026-11-01')
  assert.equal(p.endDateKey, '2026-12-01')
  assert.equal(p.periodKey, 'month:2026-11')
})

test('月初 1 日恰为周一：周/月两种周期都能正确解析且互不覆盖', () => {
  // 2026-06-01 is a Monday.
  assert.equal(beijingWeekStartKey('2026-06-01'), '2026-06-01')
  const weekly = resolveSettlementPeriod('weekly', beijing('2026-06-01 06:00'))
  const monthly = resolveSettlementPeriod('monthly', beijing('2026-06-01 06:00'))
  assert.equal(weekly.periodKey, 'week:2026-05-25')
  assert.equal(monthly.periodKey, 'month:2026-05')
  assert.notEqual(weekly.periodKey, monthly.periodKey)
})

test('历史保护：生效时间之后的周期才允许自动结算', () => {
  const p = resolveSettlementPeriod('weekly', beijing('2026-11-30 06:00'))
  assert.equal(isPeriodAfterGoLive(p, null), false)
  assert.equal(isPeriodAfterGoLive(p, '2026-12-01T00:00:00+08:00'), false)
  assert.equal(isPeriodAfterGoLive(p, '2026-11-23T00:00:00+08:00'), true)
  assert.equal(isPeriodAfterGoLive(p, '2026-11-20T00:00:00+08:00'), true)
})

test('beijingDayStart 是北京 00:00 对应的 UTC 时刻', () => {
  assert.equal(beijingDayStart('2026-11-23').toISOString(), '2026-11-22T16:00:00.000Z')
})

test('谢谢侬顺延：前三已有则跳过并顺延到 4、5 名，最多新增 3 人', () => {
  const board = {
    boardKey: 'comment:main',
    candidates: [
      { rank: 1, userId: 'u1' }, { rank: 2, userId: 'u2' }, { rank: 3, userId: 'u3' },
      { rank: 4, userId: 'u4' }, { rank: 5, userId: 'u5' }, { rank: 6, userId: 'u6' },
    ],
  }
  const owned = new Set(['u1', 'u3'])
  const awards = resolveBadgeAwards([board], owned, 3)
  assert.deepEqual(awards.map((a) => a.userId), ['u2', 'u4', 'u5'])
  assert.deepEqual(awards.map((a) => a.rank), [2, 4, 5])
})

test('K歌之王跨榜单去重：同一用户只获一枚，且每榜最多 3 名', () => {
  const boards = [
    { boardKey: 'ent:A', candidates: [{ rank: 1, userId: 'u1' }, { rank: 2, userId: 'u2' }, { rank: 3, userId: 'u3' }, { rank: 4, userId: 'u9' }] },
    { boardKey: 'ent:B', candidates: [{ rank: 1, userId: 'u1' }, { rank: 2, userId: 'u2' }, { rank: 3, userId: 'u4' }, { rank: 4, userId: 'u5' }] },
  ]
  const awards = resolveBadgeAwards(boards, new Set(), 3)
  const ids = awards.map((a) => a.userId)
  assert.equal(new Set(ids).size, ids.length, 'no duplicate user across boards')
  assert.equal(ids.filter((id) => id === 'u1').length, 1)
  assert.equal(ids.filter((id) => id === 'u2').length, 1)
  // Board A gives u1,u2,u3; Board B skips u1,u2 and gives u4,u5.
  assert.deepEqual(ids, ['u1', 'u2', 'u3', 'u4', 'u5'])
  assert.equal(awards.filter((a) => a.boardKey === 'ent:A').length, 3)
  assert.equal(awards.filter((a) => a.boardKey === 'ent:B').length, 2)
})

test('候选不足时不凑人数', () => {
  const board = { boardKey: 'b', candidates: [{ rank: 1, userId: 'u1' }, { rank: 2, userId: 'u2' }] }
  assert.equal(resolveBadgeAwards([board], new Set(), 3).length, 2)
})

test('幂等键包含奖励类型 + 周期 + 榜单 + 用户，且通知键绑定业务键', () => {
  const key = rewardBusinessKey('weekly', 'week:2026-11-23', 'entertainment', 'ent:WANT_LISTEN', 'u1')
  assert.equal(key, 'leaderboard:weekly:week:2026-11-23:entertainment:ent:WANT_LISTEN:u1')
  const other = rewardBusinessKey('monthly', 'week:2026-11-23', 'entertainment', 'ent:WANT_LISTEN', 'u1')
  assert.notEqual(key, other)
  assert.equal(rewardNotificationKey(key), `notify:${key}`)
  assert.equal(
    badgeGrantKey('thankYou', 'week:2026-11-23', 'comment:main', 'u1'),
    'leaderboard-badge:thankYou:week:2026-11-23:comment:main:u1',
  )
})
