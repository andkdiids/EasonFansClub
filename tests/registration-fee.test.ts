import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getStreakBonus } from '../lib/daily'
import { getRandomCheckInPoints } from '../lib/points'
import {
  HUNDRED_DAY_RECORD_REWARD,
  LONG_TERM_PATIENT_DAILY_BONUS,
  LONG_TERM_PATIENT_STREAK_DAYS,
  getRegistrationFeeSourceLabel,
  serializeRegistrationFeeRecord,
  sumPositiveRegistrationFees,
} from '../lib/registration-fee'
import { dailyExpLimit } from '../lib/growth'

const read = (path: string) => readFileSync(path, 'utf8')

test('每日首次挂号随机奖励严格位于 3 到 7 挂号费', () => {
  for (let index = 0; index < 500; index += 1) {
    const amount = getRandomCheckInPoints()
    assert.ok(amount >= 3 && amount <= 7)
  }
})

test('长期患者奖励从连续第 7 天开始固定额外 7 挂号费', () => {
  assert.equal(LONG_TERM_PATIENT_STREAK_DAYS, 7)
  assert.equal(LONG_TERM_PATIENT_DAILY_BONUS, 7)
  assert.equal(getStreakBonus(6), null)
  assert.deepEqual(getStreakBonus(7), { points: 7, exp: 0, label: '长期患者奖励' })
  assert.deepEqual(getStreakBonus(100), { points: 7, exp: 0, label: '长期患者奖励' })
})

test('统一挂号费服务不再计算所有来源合计每日 30 上限', () => {
  const service = read('lib/registration-fee.ts')
  assert.match(service, /points: \{ increment: requestedAmount \}/)
  assert.doesNotMatch(service, /DAILY_REGISTRATION_FEE_LIMIT|REGISTRATION_FEE_LIMIT_MESSAGE|countsTowardDailyLimit/)
  assert.doesNotMatch(service, /remaining\s*=|Math\.min\(requestedAmount|reachedDailyLimit|cappedReward/)
})

test('所有真实挂号费收入入口接入统一流水服务', () => {
  for (const path of [
    'app/api/checkin/route.ts',
    'lib/entertainment.ts',
    'lib/achievements.ts',
  ]) {
    assert.match(read(path), /awardRegistrationFee/)
  }
  assert.doesNotMatch(read('app/api/posts/[postId]/like/route.ts'), /awardRegistrationFee|POST_LIKE_RECEIVED|postLikeReceived/)
  assert.match(read('app/api/admin/users/[userId]/route.ts'), /adjustRegistrationFeeBalance/)
  assert.match(read('app/api/posts/[postId]/replies/route.ts'), /awardCommunityCommentRewards/)
  assert.doesNotMatch(read('app/api/auth/register/route.ts'), /points:\s*\{\s*increment/)
})

test('签到分别记录普通奖励与连续奖励且不改变经验函数', () => {
  const route = read('app/api/checkin/route.ts')
  assert.match(route, /action: 'DAILY_CHECK_IN'/)
  assert.match(route, /action: 'CONTINUOUS_CHECK_IN_BONUS'/)
  assert.doesNotMatch(route, /countsTowardDailyLimit|registrationFeeLimitReached/)
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
  assert.match(achievements, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(achievements, /tx\.userAchievement\.upsert/)
  assert.match(achievements, /awardRegistrationFee\(tx/)
  assert.match(seed, /'百日病历'/)
})

test('正向流水统计只累加收入，不计负数、零值或消费', () => {
  assert.equal(sumPositiveRegistrationFees([{ points: 10 }, { points: 27 }, { points: 8 }, { points: 0 }, { points: -6 }]), 45)
  const service = read('lib/registration-fee.ts')
  assert.match(service, /points: \{ gt: 0 \}/)
  assert.match(service, /todayEarned: sumPositiveRegistrationFees\(records\)/)
})

test('挂号费流水来源使用中文标签并覆盖真实入口', () => {
  assert.equal(getRegistrationFeeSourceLabel('DAILY_CHECK_IN'), '每日挂号')
  assert.equal(getRegistrationFeeSourceLabel('ENTERTAINMENT_DAILY_DRAW'), '每日处方')
  assert.equal(getRegistrationFeeSourceLabel('POST_DAILY_FIRST'), '发帖奖励')
  assert.equal(getRegistrationFeeSourceLabel('POST_COMMENT_DAILY'), '回复奖励')
  assert.equal(getRegistrationFeeSourceLabel('ACTIVITY_REWARD'), '成就奖励')
  assert.equal(getRegistrationFeeSourceLabel('ADMIN_ADJUST'), '管理员发放')
  assert.equal(getRegistrationFeeSourceLabel('REGISTER'), '其他')
})

test('历史奖励数字按流水原值展示，不把旧的 1 重算为新规则', () => {
  const record = serializeRegistrationFeeRecord({
    id: 'legacy-1',
    points: 1,
    action: 'DAILY_CHECK_IN',
    reason: '旧每日挂号奖励',
    createdAt: new Date('2026-08-03T01:02:03.000Z'),
    postId: null,
    replyId: null,
    checkInId: 'checkin-1',
    activityId: null,
    activityRegistrationId: null,
    badgeId: null,
    dailyDrawId: null,
  })
  assert.equal(record.amount, 1)
  assert.equal(record.sourceLabel, '每日挂号')
  assert.equal(record.displayTime, '09:02')
})

test('收入、余额和业务记录在同一事务内完成，并由业务键防重', () => {
  const service = read('lib/registration-fee.ts')
  const checkin = read('app/api/checkin/route.ts')
  const prescription = read('lib/entertainment.ts')
  const achievement = read('lib/achievements.ts')
  assert.match(service, /tx\.user\.update[\s\S]*tx\.pointLog\.create/)
  assert.match(service, /FOR UPDATE/)
  assert.match(service, /businessKey.*findUnique|findUnique\(\{ where: \{ businessKey/)
  assert.match(checkin, /prisma\.\$transaction/)
  assert.match(prescription, /prisma\.\$transaction/)
  assert.match(achievement, /prisma\.\$transaction\(async \(tx\)/)
})

test('奖励业务键先查重、锁内再用当前读复核，保证并发只加一次', () => {
  const service = read('lib/registration-fee.ts')
  const award = service.slice(service.indexOf('export async function awardRegistrationFee'), service.indexOf('type RegistrationFeeReversalInput'))
  const precheck = award.indexOf('existingBeforeLock')
  const userLock = award.indexOf('FOR UPDATE')
  const lockedCheck = award.indexOf('existingAfterLock')
  assert.ok(precheck >= 0 && precheck < userLock)
  assert.ok(userLock < lockedCheck)
  assert.match(award, /PointLog.*FOR UPDATE/)
  assert.match(award, /tx\.user\.update[\s\S]*tx\.pointLog\.create/)
})

test('每日挂号费查询按北京时间边界倒序读取当前用户正向流水', () => {
  const route = read('app/api/points/today/route.ts')
  const service = read('lib/registration-fee.ts')
  assert.match(route, /getCurrentUser\(\)/)
  assert.match(route, /unauthenticatedResponse\(/)
  assert.match(route, /private, no-store/)
  assert.match(service, /getShanghaiDayRange\(now\)/)
  assert.match(service, /createdAt: \{ gte: start, lt: end \}/)
  assert.match(service, /orderBy: \{ createdAt: 'desc' \}/)
  assert.match(service, /points: \{ gt: 0 \}/)
  assert.doesNotMatch(route, /searchParams|get\('userId'\)|request\.url/)
})

test('前台移除全局挂号费上限展示和废弃字段', () => {
  const frontend = [
    'components/CheckInButton.tsx',
    'components/CheckInGrowthGuideCard.tsx',
    'components/TodayRegistrationFeePanel.tsx',
    'app/admin/growth/GrowthSettingsPanel.tsx',
    'app/entertainment/EntertainmentCenter.tsx',
    'components/ReplyForm.tsx',
  ].map(read).join('\n')
  assert.doesNotMatch(frontend, /每日普通获取上限|今日挂号费获取已达到上限|registrationFeeLimit|remainingPoints|xx\/30|达到上限后不再增加/)
  const feePanel = read('components/TodayRegistrationFeePanel.tsx')
  assert.match(feePanel, /\+\{record\.amount\} 挂号费/)
  assert.match(feePanel, /医保余额/)
  assert.doesNotMatch(feePanel, /收入流水|今日挂号费/)
  assert.match(feePanel, /grid grid-cols-2 gap-2\.5/)
  assert.match(feePanel, /aria-expanded=\{expanded\}/)
  assert.match(feePanel, /aria-controls=\{recordsId\}/)
  assert.match(feePanel, /useId/)
  assert.match(feePanel, /const \[expanded, setExpanded\] = useState\(false\)/)
  assert.match(feePanel, /void loadSummary\(\)/)
  assert.doesNotMatch(feePanel, /previewMode|PageLayout/)
  assert.match(feePanel, /\{expanded \? <div id=\{recordsId\}/)
  assert.doesNotMatch(feePanel, /fixed|absolute|createPortal|<dialog/)
})

test('每日经验上限仍保留且与挂号费统计分离', () => {
  assert.equal(dailyExpLimit, 30)
  const growth = read('lib/growth.ts')
  const fee = read('lib/registration-fee.ts')
  assert.match(growth, /dailyExpLimit = 30/)
  assert.match(growth, /dailyExpLimit - usedToday/)
  assert.doesNotMatch(fee, /dailyExpLimit|experience|awardExperience/)
})

test('管理员余额修改也通过统一挂号费余额服务记录正负变动', () => {
  const route = read('app/api/admin/users/[userId]/route.ts')
  const service = read('lib/registration-fee.ts')
  assert.match(route, /adjustRegistrationFeeBalance\(tx/)
  assert.doesNotMatch(route, /data\.points\s*=/)
  assert.doesNotMatch(route, /data:\s*\{\s*points\s*:/)
  assert.match(service, /data: \{ points: \{ decrement: Math\.abs\(difference\) \} \}/)
  assert.match(service, /action: 'ADMIN_ADJUST'/)
})

test('每日挂号与每日处方的每日一次和并发保护保持不变', () => {
  const checkin = read('app/api/checkin/route.ts')
  const prescription = read('lib/entertainment.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(checkin, /checkIn\.findUnique|checkIn\.findFirst/)
  assert.match(checkin, /checkinDateKey: todayKey/)
  assert.match(prescription, /findExistingDraw\(userId, dateKey\)/)
  assert.match(prescription, /error\.code === 'P2002'/)
  assert.match(schema, /@@unique\(\[userId, dateKey\]\)/)
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
