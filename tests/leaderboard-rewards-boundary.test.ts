import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultLeaderboardRewardsConfig,
  leaderboardRewardsConfigError,
  validateLeaderboardRewardsConfig,
} from '../lib/leaderboard-rewards-config'
import {
  isPeriodAllowed,
  isPeriodAfterGoLive,
  resolveSettlementPeriod,
  isValidWeeklyBoundary,
  isValidMonthlyBoundary,
} from '../lib/leaderboard-rewards-period'

/**
 * First-settlement boundary.
 *
 * Business needs the first automatic settlement to cover the cycle that began
 * BEFORE go-live:
 *   enable 2026-11-26 → first weekly = week:2026-11-23 (fires 2026-11-30 06:00)
 *   enable 2026-11-26 → first monthly = month:2026-11  (fires 2026-12-01 06:00)
 *
 * A per-kind explicit boundary allows exactly that cycle and everything after,
 * while every earlier cycle stays permanently blocked. Without a boundary the
 * legacy enabledAt full-cycle guard must still apply.
 */

const beijing = (iso: string) => new Date(`${iso.replace(' ', 'T')}+08:00`)
const BOUNDARY = { firstWeeklyPeriod: 'week:2026-11-23', firstMonthlyPeriod: 'month:2026-11' }
const ENABLED_AT = '2026-11-26T11:11:35.871Z' // 19:11:35 CST

test('默认配置：边界为 null（保持严格 enabledAt 保护）', () => {
  const c = validateLeaderboardRewardsConfig(defaultLeaderboardRewardsConfig)
  assert.ok(c)
  assert.equal(c.firstWeeklyPeriod, null)
  assert.equal(c.firstMonthlyPeriod, null)
  assert.equal(c.enabledAt, null)
})

test('配置校验：合法边界通过，格式错误被拒绝', () => {
  const ok = { ...defaultLeaderboardRewardsConfig, firstWeeklyPeriod: 'week:2026-11-23', firstMonthlyPeriod: 'month:2026-11' }
  assert.equal(leaderboardRewardsConfigError(ok), null)
  assert.equal(validateLeaderboardRewardsConfig(ok)?.firstWeeklyPeriod, 'week:2026-11-23')
  assert.equal(validateLeaderboardRewardsConfig(ok)?.firstMonthlyPeriod, 'month:2026-11')

  const badWeek = { ...defaultLeaderboardRewardsConfig, firstWeeklyPeriod: 'week:2026-11' }
  assert.match(leaderboardRewardsConfigError(badWeek) || '', /首次周榜结算周期格式无效/)
  const badMonth = { ...defaultLeaderboardRewardsConfig, firstMonthlyPeriod: 'month:2026-11-23' }
  assert.match(leaderboardRewardsConfigError(badMonth) || '', /首次月榜结算周期格式无效/)
  const impossibleDate = { ...defaultLeaderboardRewardsConfig, firstWeeklyPeriod: 'week:2026-13-45' }
  assert.ok(leaderboardRewardsConfigError(impossibleDate))
})

test('边界格式判定函数', () => {
  assert.equal(isValidWeeklyBoundary('week:2026-11-23'), true)
  assert.equal(isValidWeeklyBoundary('month:2026-11'), false)
  assert.equal(isValidWeeklyBoundary(null), false)
  assert.equal(isValidMonthlyBoundary('month:2026-11'), true)
  assert.equal(isValidMonthlyBoundary('week:2026-11-23'), false)
})

test('§4.1 2026-11-30 06:00 → week:2026-11-23 可结算（边界优先于 enabledAt）', () => {
  const period = resolveSettlementPeriod('weekly', beijing('2026-11-30 06:00'))
  assert.equal(period.periodKey, 'week:2026-11-23')
  // Without a boundary the strict guard would block it.
  assert.equal(isPeriodAfterGoLive(period, ENABLED_AT), false)
  // With the boundary it is allowed.
  assert.equal(isPeriodAllowed(period, BOUNDARY, ENABLED_AT), true)
})

test('§4.2 2026-12-01 06:00 → month:2026-11 可结算', () => {
  const period = resolveSettlementPeriod('monthly', beijing('2026-12-01 06:00'))
  assert.equal(period.periodKey, 'month:2026-11')
  assert.equal(isPeriodAfterGoLive(period, ENABLED_AT), false)
  assert.equal(isPeriodAllowed(period, BOUNDARY, ENABLED_AT), true)
})

test('§4.3 2026-11-23 06:00 → week:2026-11-16 更早周榜被禁止', () => {
  const period = resolveSettlementPeriod('weekly', beijing('2026-11-23 06:00'))
  assert.equal(period.periodKey, 'week:2026-11-16')
  assert.equal(isPeriodAllowed(period, BOUNDARY, ENABLED_AT), false)
})

test('§4.4 2026-11-01 06:00 → month:2026-10 更早月榜被禁止', () => {
  const period = resolveSettlementPeriod('monthly', beijing('2026-11-01 06:00'))
  assert.equal(period.periodKey, 'month:2026-10')
  assert.equal(isPeriodAllowed(period, BOUNDARY, ENABLED_AT), false)
})

test('§4.5 2026-12-07 周榜继续正常', () => {
  const period = resolveSettlementPeriod('weekly', beijing('2026-12-07 06:00'))
  assert.equal(period.periodKey, 'week:2026-11-30')
  assert.equal(isPeriodAllowed(period, BOUNDARY, ENABLED_AT), true)
})

test('§4.6 2027-01-01 月榜继续正常', () => {
  const period = resolveSettlementPeriod('monthly', beijing('2027-01-01 06:00'))
  assert.equal(period.periodKey, 'month:2026-12')
  assert.equal(isPeriodAllowed(period, BOUNDARY, ENABLED_AT), true)
})

test('§4.11 周榜边界不影响月榜，月榜边界不影响周榜', () => {
  // Weekly boundary must not open an early month.
  const earlyMonth = resolveSettlementPeriod('monthly', beijing('2026-11-01 06:00'))
  assert.equal(isPeriodAllowed(earlyMonth, { firstWeeklyPeriod: 'week:2026-11-23', firstMonthlyPeriod: null }, ENABLED_AT), false)
  // Monthly boundary must not open an early week.
  const earlyWeek = resolveSettlementPeriod('weekly', beijing('2026-11-23 06:00'))
  assert.equal(isPeriodAllowed(earlyWeek, { firstWeeklyPeriod: null, firstMonthlyPeriod: 'month:2026-11' }, ENABLED_AT), false)
  // And each opens only its own kind.
  const firstWeek = resolveSettlementPeriod('weekly', beijing('2026-11-30 06:00'))
  assert.equal(isPeriodAllowed(firstWeek, { firstWeeklyPeriod: 'week:2026-11-23', firstMonthlyPeriod: null }, ENABLED_AT), true)
  const firstMonth = resolveSettlementPeriod('monthly', beijing('2026-12-01 06:00'))
  assert.equal(isPeriodAllowed(firstMonth, { firstWeeklyPeriod: null, firstMonthlyPeriod: 'month:2026-11' }, ENABLED_AT), true)
})

test('无边界时严格回退：仍是完整周期保护（旧配置行为不变）', () => {
  const period = resolveSettlementPeriod('weekly', beijing('2026-11-30 06:00'))
  assert.equal(isPeriodAllowed(period, {}, ENABLED_AT), false)
  assert.equal(isPeriodAllowed(period, { firstWeeklyPeriod: null, firstMonthlyPeriod: null }, ENABLED_AT), false)
  assert.equal(isPeriodAllowed(period, {}, null), false)
})

test('边界之后的所有周期都允许（长期连续性）', () => {
  for (const date of ['2026-12-14 06:00', '2027-01-04 06:00', '2027-06-07 06:00']) {
    const p = resolveSettlementPeriod('weekly', beijing(date))
    assert.equal(isPeriodAllowed(p, BOUNDARY, ENABLED_AT), true, date)
  }
  for (const date of ['2027-02-01 06:00', '2027-03-01 06:00']) {
    const p = resolveSettlementPeriod('monthly', beijing(date))
    assert.equal(isPeriodAllowed(p, BOUNDARY, ENABLED_AT), true, date)
  }
})

test('边界恰为周期本身时允许（含等号）', () => {
  const period = resolveSettlementPeriod('weekly', beijing('2026-11-30 06:00'))
  assert.equal(period.periodKey, BOUNDARY.firstWeeklyPeriod)
  assert.equal(isPeriodAllowed(period, BOUNDARY, ENABLED_AT), true)
})
