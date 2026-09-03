import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getHistoricalBirthdayEligibility,
  parseBirthdayHistoryBackfillInput,
} from '@/lib/birthday-history-backfill'

const read = (path: string) => readFileSync(path, 'utf8')
const range = (startDate: string, endDate: string, overrides: Record<string, unknown> = {}) => ({
  startDate,
  endDate,
  includeBirthday: true,
  includeZodiac: true,
  ...overrides,
})
const user = (month: number, day: number, createdAt: string) => ({
  birthMonth: month,
  birthDay: day,
  createdAt: new Date(createdAt),
})

test('历史生日按 inclusive 日期窗口和注册日计算', () => {
  const eligibility = getHistoricalBirthdayEligibility(user(7, 15, '2026-06-01T00:00:00+08:00'), range('2026-07-01', '2026-09-01'))
  assert.equal(eligibility.birthdayDate, '2026-07-15')
  assert.equal(eligibility.zodiac, 'CANCER')
  assert.equal(eligibility.zodiacDate, '2026-07-01')

  const endInclusive = getHistoricalBirthdayEligibility(user(9, 1, '2026-08-01T00:00:00+08:00'), range('2026-07-01', '2026-09-01'))
  assert.equal(endInclusive.birthdayDate, '2026-09-01')
})

test('生日当天不能补发注册前的历史日期，但星座按注册后周期判断', () => {
  const birthdayMiss = getHistoricalBirthdayEligibility(user(7, 15, '2026-08-01T00:00:00+08:00'), range('2026-07-01', '2026-09-01'))
  assert.equal(birthdayMiss.birthdayDate, null)
  assert.equal(birthdayMiss.zodiacDate, null)

  const zodiacAfterRegistration = getHistoricalBirthdayEligibility(user(8, 8, '2026-08-10T00:00:00+08:00'), range('2026-07-01', '2026-09-01'))
  assert.equal(zodiacAfterRegistration.birthdayDate, null)
  assert.equal(zodiacAfterRegistration.zodiac, 'LEO')
  assert.equal(zodiacAfterRegistration.zodiacDate, '2026-08-10')
})

test('注册当天的生日有资格，注册次日则没有该年度生日当天资格', () => {
  assert.equal(getHistoricalBirthdayEligibility(user(8, 10, '2026-08-10T23:59:59+08:00'), range('2026-08-01', '2026-09-01')).birthdayDate, '2026-08-10')
  assert.equal(getHistoricalBirthdayEligibility(user(8, 10, '2026-08-11T00:00:00+08:00'), range('2026-08-01', '2026-09-01')).birthdayDate, null)
})

test('生日为空或非法时不产生生日/星座资格', () => {
  const empty = getHistoricalBirthdayEligibility({ birthMonth: null, birthDay: null, createdAt: new Date('2026-06-01T00:00:00+08:00') }, range('2026-07-01', '2026-09-01'))
  assert.deepEqual(empty, { birthdayDate: null, zodiac: null, zodiacDate: null })
  const invalid = getHistoricalBirthdayEligibility(user(2, 30, '2026-06-01T00:00:00+08:00'), range('2026-07-01', '2026-09-01'))
  assert.deepEqual(invalid, { birthdayDate: null, zodiac: null, zodiacDate: null })
})

test('跨年星座和生日使用现有 resolver，摩羯座边界可计算', () => {
  const capricorn = getHistoricalBirthdayEligibility(user(12, 25, '2026-12-20T00:00:00+08:00'), range('2026-12-20', '2027-01-10'))
  assert.equal(capricorn.birthdayDate, '2026-12-25')
  assert.equal(capricorn.zodiac, 'CAPRICORN')
  assert.equal(capricorn.zodiacDate, '2026-12-22')

  const januaryBirthday = getHistoricalBirthdayEligibility(user(1, 5, '2026-12-20T00:00:00+08:00'), range('2026-12-20', '2027-01-10'))
  assert.equal(januaryBirthday.birthdayDate, '2027-01-05')
  assert.equal(januaryBirthday.zodiacDate, '2026-12-22')
})

test('2 月 29 日只在实际闰年日期出现，2 月 30 日永远无效', () => {
  assert.equal(getHistoricalBirthdayEligibility(user(2, 29, '2027-01-01T00:00:00+08:00'), range('2027-02-28', '2027-03-01')).birthdayDate, null)
  const leap = getHistoricalBirthdayEligibility(user(2, 29, '2028-01-01T00:00:00+08:00'), range('2028-02-29', '2028-02-29'))
  assert.equal(leap.birthdayDate, '2028-02-29')
  assert.equal(leap.zodiac, 'PISCES')
  assert.equal(leap.zodiacDate, '2028-02-29')
  assert.equal(getHistoricalBirthdayEligibility(user(2, 30, '2028-01-01T00:00:00+08:00'), range('2028-02-29', '2028-03-01')).birthdayDate, null)
})

test('输入校验支持跨年、默认双范围，并拒绝空范围和错误边界', () => {
  const parseError = (value: unknown) => {
    const result = parseBirthdayHistoryBackfillInput(value)
    return 'error' in result ? result.error : ''
  }

  assert.deepEqual(parseBirthdayHistoryBackfillInput({ startDate: '2026-12-20', endDate: '2027-01-10' }), {
    input: range('2026-12-20', '2027-01-10'),
  })
  assert.match(parseError({ startDate: '2026-09-01', endDate: '2026-07-01' }), /不能晚于/)
  assert.match(parseError({ startDate: '2026-02-30', endDate: '2026-03-01' }), /有效的日期/)
  assert.match(parseError({ startDate: '2026-07-01', endDate: '2026-09-01', includeBirthday: false, includeZodiac: false }), /至少选择/)
})

test('预览只读，执行必须二次确认并写入单次操作日志', () => {
  const preview = read('app/api/admin/badges/birthday-backfill/preview/route.ts')
  const execute = read('app/api/admin/badges/birthday-backfill/execute/route.ts')
  const ui = read('app/admin/badges/BirthdayHistoryBackfill.tsx')
  assert.match(preview, /previewBirthdayHistoryBackfill/)
  assert.doesNotMatch(preview, /grantBadge|adminActionLog|writeBadgeAdminAction/)
  assert.match(execute, /body\?\.confirmed !== true/)
  assert.match(execute, /executeBirthdayHistoryBackfill/)
  assert.match(execute, /BADGE_HISTORY_BACKFILL/)
  assert.match(ui, /2026-07-01/)
  assert.match(ui, /2026-09-01/)
  assert.match(ui, /预览补发/)
  assert.match(ui, /window\.confirm/)
  assert.match(ui, /确认补发历史生日 \/ 星座勋章/)
})

test('历史授予复用集中式 grant service，使用当前发放时间并记录历史资格日期', () => {
  const service = read('lib/birthday-history-backfill.ts')
  assert.match(service, /grantBadge\(/)
  assert.match(service, /processBadgeGrantEffects\(/)
  assert.match(service, /sourceType: BIRTHDAY_HISTORY_BACKFILL_SOURCE/)
  assert.match(service, /sourceId: plan\.eligibleDate/)
  assert.match(service, /obtainedAt: now/)
  assert.match(service, /availabilityMode: 'HISTORICAL_WINDOW'/)
  assert.match(service, /historicalWindow: \{ from: window\.from, until: window\.until \}/)
  assert.match(service, /userBadge\.findMany/)
  assert.doesNotMatch(service, /userBadge\.create/)
})

test('生日和星座 target 只读 active AUTO 规则，公开开关不会参与筛选', () => {
  const service = read('lib/birthday-history-backfill.ts')
  assert.match(service, /grantType: 'AUTO'/)
  assert.match(service, /isEnabled: true/)
  assert.match(service, /isActive: true/)
  assert.match(service, /BIRTHDAY_TODAY.*BIRTHDAY_ZODIAC/)
  assert.match(service, /OR:\s*\[/)
  assert.match(service, /BIRTHDAY_BADGE_SLUG/)
  assert.match(service, /isLegacyBirthdayBadge/)
  assert.doesNotMatch(service, /birthdayPublic/)
  assert.match(service, /getZodiacFromRuleConfig/)
  assert.match(service, /getZodiacSignFromBirthday/)
  assert.match(service, /getCurrentZodiacSign/)
})

test('无 Schema、migration 或生产执行入口变更', () => {
  const service = read('lib/birthday-history-backfill.ts')
  assert.doesNotMatch(service, /prisma\.\$executeRaw|prisma\.\$queryRaw|DROP TABLE|migrate|db\.push/i)
  assert.doesNotMatch(read('app/api/admin/badges/birthday-backfill/preview/route.ts'), /executeBirthdayHistoryBackfill/)
})
