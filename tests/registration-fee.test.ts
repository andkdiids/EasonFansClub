import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getStreakBonus } from '../lib/daily'
import { getRandomCheckInPoints, getRandomPostRegistrationFee } from '../lib/points'
import {
  DAILY_REGISTRATION_FEE_LIMIT,
  HUNDRED_DAY_RECORD_REWARD,
  LONG_TERM_PATIENT_DAILY_BONUS,
  LONG_TERM_PATIENT_STREAK_DAYS,
  REGISTRATION_FEE_LIMIT_MESSAGE,
} from '../lib/registration-fee'

const read = (path: string) => readFileSync(path, 'utf8')

test('每日首次挂号随机奖励严格位于 3 到 7 挂号费', () => {
  for (let index = 0; index < 500; index += 1) {
    const amount = getRandomCheckInPoints()
    assert.ok(amount >= 3 && amount <= 7)
  }
})

test('每日首次发帖随机奖励严格位于 1 到 3 挂号费', () => {
  for (let index = 0; index < 500; index += 1) {
    const amount = getRandomPostRegistrationFee()
    assert.ok(amount >= 1 && amount <= 3)
  }
})

test('长期患者奖励从连续第 7 天开始固定额外 7 挂号费', () => {
  assert.equal(LONG_TERM_PATIENT_STREAK_DAYS, 7)
  assert.equal(LONG_TERM_PATIENT_DAILY_BONUS, 7)
  assert.equal(getStreakBonus(6), null)
  assert.deepEqual(getStreakBonus(7), { points: 7, exp: 0, label: '长期患者奖励' })
  assert.deepEqual(getStreakBonus(100), { points: 7, exp: 0, label: '长期患者奖励' })
})

test('统一挂号费服务限制普通奖励每日最多 30 并允许额外奖励绕过上限', () => {
  const service = read('lib/registration-fee.ts')
  assert.equal(DAILY_REGISTRATION_FEE_LIMIT, 30)
  assert.equal(REGISTRATION_FEE_LIMIT_MESSAGE, '今日挂号费获取已达到上限，明日继续努力。')
  assert.match(service, /Math\.min\(requestedAmount, remaining\)/)
  assert.match(service, /countsTowardDailyLimit !== false/)
  assert.doesNotMatch(service, /'CONTINUOUS_CHECK_IN_BONUS',/)
})

test('所有现有普通挂号费来源接入统一上限服务', () => {
  for (const path of [
    'app/api/checkin/route.ts',
    'app/api/posts/route.ts',
    'app/api/posts/[postId]/replies/route.ts',
    'app/api/posts/[postId]/like/route.ts',
    'lib/entertainment.ts',
  ]) {
    assert.match(read(path), /awardRegistrationFee/)
  }
})

test('签到分别记录普通奖励与不计上限的连续奖励且不改变经验函数', () => {
  const route = read('app/api/checkin/route.ts')
  assert.match(route, /action: 'DAILY_CHECK_IN'/)
  assert.match(route, /action: 'CONTINUOUS_CHECK_IN_BONUS'/)
  assert.match(route, /countsTowardDailyLimit: false/)
  assert.match(route, /awardExperience\(tx/)
  assert.match(route, /getRandomCheckInExperience\(\)/)
})

test('百日病历自动写入现有成就系统并发放一次性额外挂号费', () => {
  const achievements = read('lib/achievements.ts')
  const seed = read('scripts/seed-achievements-culture.ts')
  assert.equal(HUNDRED_DAY_RECORD_REWARD, 100)
  assert.match(achievements, /slug: 'checkin-streak-100'/)
  assert.match(achievements, /title: '百日病历'/)
  assert.match(achievements, /businessKey: `achievement-reward:/)
  assert.match(achievements, /countsTowardDailyLimit: false/)
  assert.match(seed, /'百日病历'/)
})

test('用户可见积分文案已统一为挂号费且内部 points 字段保持兼容', () => {
  const visibleSources = [
    'components/CheckInButton.tsx',
    'components/CheckInGrowthGuideCard.tsx',
    'components/HomeLayoutSurface.tsx',
    'components/AdminUsersManager.tsx',
    'app/admin/users/[id]/page.tsx',
    'app/entertainment/EntertainmentCenter.tsx',
    'app/rankings/page.tsx',
  ].map(read).join('\n')
  assert.doesNotMatch(visibleSources, /积分|E积分/)
  assert.match(visibleSources, /挂号费/)
  assert.match(read('prisma/schema.prisma'), /points\s+Int/)
})
