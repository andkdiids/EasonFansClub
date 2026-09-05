import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evaluateBadgeRule } from '@/lib/badge-rule-engine'
import { generateBadgeAcquisitionDescription, parseBadgeRuleInput } from '@/lib/badge-rules'
import { getCurrentZodiacSign, getZodiacSignFromBirthday, isBirthdayToday } from '@/lib/zodiac'

const read = (path: string) => readFileSync(path, 'utf8')

const boundaries: Array<[number, number, string]> = [
  [3, 20, 'PISCES'], [3, 21, 'ARIES'],
  [4, 19, 'ARIES'], [4, 20, 'TAURUS'],
  [5, 20, 'TAURUS'], [5, 21, 'GEMINI'],
  [6, 21, 'GEMINI'], [6, 22, 'CANCER'],
  [7, 22, 'CANCER'], [7, 23, 'LEO'],
  [8, 22, 'LEO'], [8, 23, 'VIRGO'],
  [9, 22, 'VIRGO'], [9, 23, 'LIBRA'],
  [10, 23, 'LIBRA'], [10, 24, 'SCORPIO'],
  [11, 22, 'SCORPIO'], [11, 23, 'SAGITTARIUS'],
  [12, 21, 'SAGITTARIUS'], [12, 22, 'CAPRICORN'],
  [1, 19, 'CAPRICORN'], [1, 20, 'AQUARIUS'],
  [2, 18, 'AQUARIUS'], [2, 19, 'PISCES'],
  [2, 29, 'PISCES'],
]

const zodiacRule = {
  ruleType: 'BIRTHDAY_ZODIAC' as const,
  operator: 'GTE' as const,
  threshold: null,
  configJson: { zodiac: 'ARIES' },
}

test('zodiac resolver uses month/day only and honors every configured boundary', () => {
  for (const [month, day, expected] of boundaries) {
    assert.equal(getZodiacSignFromBirthday({ month, day }), expected, `${month}/${day}`)
  }
  assert.equal(getZodiacSignFromBirthday({ month: 4, day: 5 }), 'ARIES')
  assert.equal(getZodiacSignFromBirthday({ month: 4, day: 5 }), getZodiacSignFromBirthday({ month: 4, day: 5 }))
  assert.equal(getZodiacSignFromBirthday(null), null)
  assert.equal(getZodiacSignFromBirthday({ month: 2, day: 30 }), null)
})

test('birthday-today uses Asia/Shanghai calendar boundaries', () => {
  assert.equal(isBirthdayToday({ month: 4, day: 5 }, new Date('2026-04-04T16:05:00.000Z')), true)
  assert.equal(isBirthdayToday({ month: 4, day: 5 }, new Date('2026-04-05T15:59:59.999Z')), true)
  assert.equal(isBirthdayToday({ month: 4, day: 5 }, new Date('2026-04-05T16:00:00.000Z')), false)
})

test('current zodiac period uses Asia/Shanghai boundaries', () => {
  const dates: Array<[string, string]> = [
    ['2026-03-20T04:00:00.000Z', 'PISCES'],
    ['2026-03-21T04:00:00.000Z', 'ARIES'],
    ['2026-04-19T04:00:00.000Z', 'ARIES'],
    ['2026-04-20T04:00:00.000Z', 'TAURUS'],
    ['2026-12-21T04:00:00.000Z', 'SAGITTARIUS'],
    ['2026-12-22T04:00:00.000Z', 'CAPRICORN'],
    ['2027-01-19T04:00:00.000Z', 'CAPRICORN'],
    ['2027-01-20T04:00:00.000Z', 'AQUARIUS'],
  ]
  for (const [date, expected] of dates) assert.equal(getCurrentZodiacSign(new Date(date)), expected, date)
})

test('BIRTHDAY_ZODIAC requires user zodiac and current zodiac period, not birthday today', () => {
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: zodiacRule, now: new Date('2026-03-25T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: zodiacRule, now: new Date('2026-04-05T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: zodiacRule, now: new Date('2026-04-19T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: zodiacRule, now: new Date('2026-04-20T04:00:00.000Z') }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: { ...zodiacRule, configJson: { zodiac: 'TAURUS' } }, now: new Date('2026-03-25T04:00:00.000Z') }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: null, birthDay: null }, rule: zodiacRule, now: new Date('2026-03-25T04:00:00.000Z') }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 2, birthDay: 30 }, rule: zodiacRule, now: new Date('2026-03-25T04:00:00.000Z') }), false)
})

test('BIRTHDAY_ZODIAC handles Capricorn across the year boundary and Feb 29 without waiting for birthday', () => {
  const capricornRule = { ...zodiacRule, configJson: { zodiac: 'CAPRICORN' } }
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 12, birthDay: 25 }, rule: capricornRule, now: new Date('2026-12-25T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 12, birthDay: 25 }, rule: capricornRule, now: new Date('2027-01-05T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 12, birthDay: 25 }, rule: capricornRule, now: new Date('2027-01-20T04:00:00.000Z') }), false)
  const piscesRule = { ...zodiacRule, configJson: { zodiac: 'PISCES' } }
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 2, birthDay: 29 }, rule: piscesRule, now: new Date('2027-02-20T04:00:00.000Z') }), true)
})

test('BIRTHDAY_TODAY is independent and keeps Feb 29 strict', () => {
  const birthdayRule = { ruleType: 'BIRTHDAY_TODAY' as const, operator: 'GTE' as const, threshold: null, configJson: {} }
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: birthdayRule, now: new Date('2026-04-05T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: birthdayRule, now: new Date('2026-04-04T04:00:00.000Z') }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 4, birthDay: 5 }, rule: birthdayRule, now: new Date('2026-04-06T04:00:00.000Z') }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 2, birthDay: 29 }, rule: birthdayRule, now: new Date('2028-02-29T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 2, birthDay: 29 }, rule: birthdayRule, now: new Date('2027-02-28T04:00:00.000Z') }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 2, birthDay: 29 }, rule: birthdayRule, now: new Date('2027-03-01T04:00:00.000Z') }), false)
})

test('birthday rule configs are independent and never use a numeric threshold', () => {
  const parsed = parseBadgeRuleInput({ ruleType: 'BIRTHDAY_ZODIAC', operator: 'GTE', configJson: { zodiac: 'aries' } })
  assert.equal(parsed.error, undefined)
  assert.deepEqual(parsed.rule, {
    ruleType: 'BIRTHDAY_ZODIAC',
    operator: 'GTE',
    threshold: null,
    secondaryThreshold: null,
    configJson: { zodiac: 'ARIES' },
    isEnabled: true,
    retentionPolicy: null,
  })
  assert.match(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_ZODIAC', configJson: { zodiac: 'ARIES' }, threshold: 1 }).error || '', /不需要数值阈值/)
  assert.match(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_ZODIAC', configJson: { zodiac: 'UNKNOWN' } }).error || '', /所属星座/)
  assert.equal(generateBadgeAcquisitionDescription('BIRTHDAY_ZODIAC', null, { zodiac: 'ARIES' }), '用户生日属于白羊座，并在白羊座星座周期内自动获得。')
  assert.deepEqual(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_TODAY', operator: 'GTE' }).rule, {
    ruleType: 'BIRTHDAY_TODAY', operator: 'GTE', threshold: null, secondaryThreshold: null, configJson: {}, isEnabled: true, retentionPolicy: null,
  })
  assert.match(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_TODAY', configJson: { zodiac: 'ARIES' } }).error || '', /不需要星座/)
  assert.equal(generateBadgeAcquisitionDescription('BIRTHDAY_TODAY', null, {}), '生日当天自动获得。')
})

test('daily scans select the current zodiac period while birthday scans stay on today', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const birthdayBranch = engine.slice(engine.indexOf("if (type === 'BIRTHDAY_ZODIAC' || type === 'BIRTHDAY_TODAY')"), engine.indexOf("if (type === 'BADGE_SERIES_COMPLETE')"))
  assert.match(birthdayBranch, /getCurrentZodiacSign/)
  assert.match(birthdayBranch, /getBirthdayWhereForZodiac/)
  assert.match(birthdayBranch, /BIRTHDAY_TODAY/)
  assert.match(birthdayBranch, /evaluateBadgeRule\(/)
  assert.doesNotMatch(birthdayBranch, /isBirthdayToday/)
  assert.match(read('lib/birthday.ts'), /grantCurrentZodiacBadgeRewards\(date\)/)
  assert.match(read('lib/birthday.ts'), /evaluateUserAutoBadges\(user\.id, \['BIRTHDAY_TODAY'\], date, `birthday:\$\{dateKey\}`\)/)
  assert.match(read('app/api/auth/login/route.ts'), /triggerBadgeEvaluation\(user\.id, 'USER_LOGIN', randomUUID\(\)\)/)
  assert.match(read('app/profile/page.tsx'), /triggerBadgeEvaluation\(user\.id, 'USER_ACTIVE', getShanghaiDateKey\(\)\)/)
  assert.match(read('app/api/users/me/route.ts'), /triggerBadgeEvaluation\(guard\.user\.id, 'USER_BIRTHDAY_UPDATED', profile\.birthdaySetAt/)
})

test('admin and public acquisition copy keep zodiac period and birthday-day rules separate', () => {
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  assert.match(manager, /BIRTHDAY_ZODIAC/)
  assert.match(manager, /BIRTHDAY_TODAY/)
  assert.match(manager, /ZODIAC_SIGNS/)
  assert.match(manager, /!isBirthdayRule\(draft\.ruleType\)/)
  assert.match(manager, /星座周期内自动获得/)
  assert.match(manager, /生日当天自动获得/)
  assert.doesNotMatch(manager, /BIRTHDAY_ZODIAC[\s\S]{0,500}仅在生日当天自动发放/)
  assert.match(read('lib/badge-service.ts'), /configJson: true/)
  assert.match(read('lib/badge-service.ts'), /generateBadgeAcquisitionDescription/)
})

test('schema and migration add only the controlled birthday rule enums; seed does not create duplicate badges', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260902100000_add_birthday_badge_rules/migration.sql')
  assert.match(schema, /enum BadgeRuleType[\s\S]*BIRTHDAY_ZODIAC/)
  assert.match(schema, /enum BadgeRuleType[\s\S]*BIRTHDAY_TODAY/)
  assert.match(migration, /'BIRTHDAY_ZODIAC'/)
  assert.match(migration, /'BIRTHDAY_TODAY'/)
  assert.doesNotMatch(migration, /UPDATE `Badge`|UPDATE `UserBadge`|DELETE FROM/i)
  assert.doesNotMatch(read('prisma/seed.ts'), /BIRTHDAY_ZODIAC|白羊座生日|金牛座生日/)
})

test('central grant contract is repeatable by period and no revoke path is attached to birthday updates', () => {
  const schema = read('prisma/schema.prisma')
  const service = read('lib/badge-service.ts')
  const route = read('app/api/users/me/route.ts')
  const userBadge = schema.slice(schema.indexOf('model UserBadge'), schema.indexOf('model UserBadgeShowcase'))
  assert.match(userBadge, /activeKey\s+String\?\s+@unique/)
  assert.match(service, /activeUserBadgeWhere/)
  assert.match(service, /grantKey/)
  assert.doesNotMatch(route, /revokeBadge\(/)
})
