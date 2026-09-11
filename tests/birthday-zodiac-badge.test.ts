import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evaluateBadgeRule } from '@/lib/badge-rule-engine'
import { generateBadgeAcquisitionDescription, parseBadgeRuleInput } from '@/lib/badge-rules'
import { getCurrentZodiacSign, getZodiacSignFromBirthday, isBirthdayToday, resolveZodiac, resolveZodiacGrantEligibility } from '@/lib/zodiac'

const read = (path: string) => readFileSync(path, 'utf8')

const boundaries: Array<[number, number, string]> = [
  [3, 20, 'PISCES'], [3, 21, 'ARIES'],
  [4, 19, 'ARIES'], [4, 20, 'TAURUS'],
  [5, 20, 'TAURUS'], [5, 21, 'GEMINI'],
  [6, 21, 'GEMINI'], [6, 22, 'CANCER'],
  [7, 22, 'CANCER'], [7, 23, 'LEO'],
  [8, 8, 'LEO'],
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
    assert.equal(resolveZodiac(month, day), expected, `${month}/${day}`)
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

test('BIRTHDAY_ZODIAC grant eligibility requires the birthday match and current Shanghai period', () => {
  const virgoRule = { ...zodiacRule, configJson: { zodiac: 'VIRGO' } }
  const now = new Date('2026-09-10T04:00:00.000Z')
  assert.equal(getCurrentZodiacSign(now), 'VIRGO')
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 9, birthDay: 1 }, rule: virgoRule, now }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 8, birthDay: 8 }, rule: { ...zodiacRule, configJson: { zodiac: 'LEO' } }, now }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 12, birthDay: 25 }, rule: { ...zodiacRule, configJson: { zodiac: 'CAPRICORN' } }, now }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 9, birthDay: 1 }, rule: { ...virgoRule, configJson: { zodiac: 'LEO' } }, now }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: null, birthDay: null }, rule: virgoRule, now }), false)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 2, birthDay: 30 }, rule: virgoRule, now }), false)
  assert.deepEqual(resolveZodiacGrantEligibility({ birthMonth: 9, birthDay: 1, targetZodiac: 'VIRGO', now }), {
    birthdayZodiac: 'VIRGO',
    targetZodiac: 'VIRGO',
    currentZodiac: 'VIRGO',
    birthdayMatches: true,
    currentPeriodMatches: true,
    eligible: true,
  })
})

test('AUTO and ADMIN_BACKFILL keep the current-period gate while RETENTION ignores calendar period', () => {
  const now = new Date('2026-09-07T04:00:00.000Z')
  const user = { birthMonth: 8, birthDay: 10 }
  const leoRule = { ...zodiacRule, configJson: { zodiac: 'LEO' } }

  assert.equal(getZodiacSignFromBirthday({ month: user.birthMonth, day: user.birthDay }), 'LEO')
  assert.equal(getCurrentZodiacSign(now), 'VIRGO')
  assert.equal(evaluateBadgeRule({ user, rule: leoRule, now }), false)
  assert.equal(evaluateBadgeRule({ user, rule: leoRule, now, mode: 'ADMIN_BACKFILL' }), false)
  assert.equal(evaluateBadgeRule({ user, rule: leoRule, now, mode: 'RETENTION' }), true)
  assert.equal(evaluateBadgeRule({ user, rule: { ...leoRule, configJson: { zodiac: 'VIRGO' } }, now, mode: 'ADMIN_BACKFILL' }), false)
})

test('grant resolver honors all zodiac period boundaries in Shanghai time', () => {
  const cases: Array<[string, string, { birthMonth: number; birthDay: number }]> = [
    ['2026-07-23T00:00:00.000+08:00', 'LEO', { birthMonth: 8, birthDay: 10 }],
    ['2026-08-22T23:59:59.999+08:00', 'LEO', { birthMonth: 8, birthDay: 10 }],
    ['2026-08-23T00:00:00.000+08:00', 'VIRGO', { birthMonth: 9, birthDay: 1 }],
    ['2026-09-22T23:59:59.999+08:00', 'VIRGO', { birthMonth: 9, birthDay: 1 }],
    ['2026-09-23T00:00:00.000+08:00', 'LIBRA', { birthMonth: 10, birthDay: 1 }],
  ]

  for (const [date, zodiac, user] of cases) {
    const now = new Date(date)
    assert.equal(getCurrentZodiacSign(now), zodiac, date)
    assert.equal(evaluateBadgeRule({ user, rule: { ...zodiacRule, configJson: { zodiac } }, now }), true)
  }
})

test('BIRTHDAY_ZODIAC handles Capricorn across the year boundary and Feb 29', () => {
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
    sustainedQualification: false,
    inactiveAfterDays: null,
    revokeAfterDays: null,
  })
  assert.match(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_ZODIAC', configJson: { zodiac: 'ARIES' }, threshold: 1 }).error || '', /不需要数值阈值/)
  assert.match(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_ZODIAC', configJson: { zodiac: 'UNKNOWN' } }).error || '', /所属星座/)
  assert.equal(generateBadgeAcquisitionDescription('BIRTHDAY_ZODIAC', null, { zodiac: 'ARIES' }), '用户当前生日属于白羊座，且当前处于白羊座周期时自动获得。')
  assert.deepEqual(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_TODAY', operator: 'GTE' }).rule, {
    ruleType: 'BIRTHDAY_TODAY', operator: 'GTE', threshold: null, secondaryThreshold: null, configJson: {}, isEnabled: true, retentionPolicy: null, sustainedQualification: false, inactiveAfterDays: null, revokeAfterDays: null,
  })
  assert.match(parseBadgeRuleInput({ ruleType: 'BIRTHDAY_TODAY', configJson: { zodiac: 'ARIES' } }).error || '', /不需要星座/)
  assert.equal(generateBadgeAcquisitionDescription('BIRTHDAY_TODAY', null, {}), '生日当天自动获得。')
})

test('daily scans and admin preview/backfill use the current-period grant resolver', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const dailyScanStart = engine.indexOf('export async function grantCurrentZodiacBadgeRewards')
  const dailyScanEnd = engine.indexOf('\nexport async function evaluateBadgesForEvent', dailyScanStart)
  const dailyScan = engine.slice(dailyScanStart, dailyScanEnd)
  const backfill = engine.slice(engine.indexOf('export async function backfillBadgeRule'), engine.indexOf('export type BadgeRulePreview'))
  const preview = engine.slice(engine.indexOf('export async function previewBadgeRule'))
  assert.match(dailyScan, /getCurrentZodiacSign/)
  assert.match(dailyScan, /getBirthdayWhereForZodiac/)
  assert.match(dailyScan, /grantKey: grantKeyForRule\(rule, now\)/)
  assert.match(read('lib/birthday-zodiac-grant.ts'), /zodiacGrantKey/)
  assert.match(dailyScan, /evaluateBadgeRule\(/)
  assert.match(backfill, /mode: type === 'BIRTHDAY_ZODIAC' \? 'ADMIN_BACKFILL' : 'AUTO'/)
  assert.match(backfill, /getBirthdayWhereForZodiac/)
  assert.match(backfill, /configuredZodiac !== currentZodiac/)
  assert.match(preview, /mode: type === 'BIRTHDAY_ZODIAC' \? 'ADMIN_BACKFILL' : 'AUTO'/)
  assert.match(preview, /getCurrentZodiacSign\(now, 'Asia\/Shanghai'\) !== configuredZodiac/)
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
  assert.match(manager, /当前生日属于.*时自动获得/)
  assert.match(manager, /生日当天自动获得/)
  assert.match(manager, /自动发放预览要求：生日属于指定星座，且当前处于该星座周期/)
  assert.doesNotMatch(manager, /扫描当前星座周期/)
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

test('central grant contract is repeatable by period and birthday updates use retention-aware reconciliation', () => {
  const schema = read('prisma/schema.prisma')
  const service = read('lib/badge-service.ts')
  const route = read('app/api/users/me/route.ts')
  const engine = read('lib/badge-rule-engine.ts')
  const userBadge = schema.slice(schema.indexOf('model UserBadge'), schema.indexOf('model UserBadgeShowcase'))
  assert.match(userBadge, /activeKey\s+String\?\s+@unique/)
  assert.match(service, /activeUserBadgeWhere/)
  assert.match(service, /grantKey/)
  assert.match(service, /sameSource\.isActive/)
  assert.match(service, /regrantRecordId/)
  assert.doesNotMatch(route, /revokeBadge\(/)
  assert.match(route, /triggerBadgeEvaluation\(guard\.user\.id, 'USER_BIRTHDAY_UPDATED'/)
  assert.match(engine, /reconcileBirthdayAndZodiacBadges/)
  assert.match(engine, /evaluateBadgeRetentionForUser/)
  assert.match(engine, /'BIRTHDAY_ZODIAC', 'BIRTHDAY_TODAY'/)
})

test('birthday reconciliation separates current grant eligibility from retention', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const retention = read('lib/badge-retention.ts')
  const rules = read('lib/badge-rules.ts')
  const profileRoute = read('app/api/users/me/route.ts')
  const adminRoute = read('app/api/admin/users/[userId]/route.ts')
  assert.match(engine, /export async function reconcileBirthdayRelatedBadges\(userId: string, now = new Date\(\)\)/)
  assert.match(engine, /await ensureBirthdayBadge\(userId, getShanghaiDateKey\(now\)/)
  assert.match(engine, /await evaluateBadgeRetentionForUser\(userId, \{[\s\S]*ruleTypes,[\s\S]*now,[\s\S]*reason:/)
  assert.match(profileRoute, /if \(birthdayChanged\) await triggerBadgeEvaluation\(guard\.user\.id, 'USER_BIRTHDAY_UPDATED'/)
  assert.match(adminRoute, /await triggerBadgeEvaluation\(userId, 'USER_BIRTHDAY_UPDATED'/)
  assert.match(retention, /BIRTHDAY_BADGE_SLUG/)
  assert.match(retention, /sourceType: 'AUTO', sourceId: BIRTHDAY_BADGE_SLUG/)
  assert.match(retention, /sourceType: 'LEGACY', sourceId: null/)
  assert.match(retention, /ruleType: 'BIRTHDAY_TODAY'/)
  assert.match(rules, /BIRTHDAY_ZODIAC: 'RETAIN_WHILE_ELIGIBLE'/)
  assert.match(rules, /BIRTHDAY_TODAY:[\s\S]{0,500}supportsRetentionWhileEligible: false/)
  assert.match(retention, /isAcquisitionOnlyBadgeRule\(rule\.ruleType\)/)
  assert.match(engine, /getCurrentZodiacSign/)
  assert.match(retention, /mode: ruleType === 'BIRTHDAY_ZODIAC' \? 'RETENTION' : 'AUTO'/)
})

test('生日变更场景 A-E 使用最新生日判断旧资格、新资格与未来周期', () => {
  const birthdayRule = { ruleType: 'BIRTHDAY_TODAY' as const, operator: 'GTE' as const, threshold: null, configJson: {} }
  const evaluateChange = (
    oldBirthday: { birthMonth: number; birthDay: number },
    newBirthday: { birthMonth: number; birthDay: number },
    now: Date,
  ) => ({
    oldZodiac: evaluateBadgeRule({ user: oldBirthday, rule: { ...zodiacRule, configJson: { zodiac: getZodiacSignFromBirthday({ month: oldBirthday.birthMonth, day: oldBirthday.birthDay }) } }, now }),
    newZodiac: evaluateBadgeRule({ user: newBirthday, rule: { ...zodiacRule, configJson: { zodiac: getZodiacSignFromBirthday({ month: newBirthday.birthMonth, day: newBirthday.birthDay }) } }, now }),
    oldToday: evaluateBadgeRule({ user: oldBirthday, rule: birthdayRule, now }),
    newToday: evaluateBadgeRule({ user: newBirthday, rule: birthdayRule, now }),
  })

  // A: Cancer -> Virgo; only the new birthday is eligible during Virgo.
  const scenarioA = evaluateChange({ birthMonth: 7, birthDay: 15 }, { birthMonth: 9, birthDay: 5 }, new Date('2026-09-10T04:00:00.000Z'))
  assert.equal(scenarioA.oldZodiac, false)
  assert.equal(scenarioA.newZodiac, true)

  // B: Virgo -> Capricorn.
  const scenarioB = evaluateChange({ birthMonth: 9, birthDay: 5 }, { birthMonth: 12, birthDay: 25 }, new Date('2026-12-28T04:00:00.000Z'))
  assert.equal(scenarioB.oldZodiac, false)
  assert.equal(scenarioB.newZodiac, true)

  // C: today's birthday becomes a non-today birthday.
  const scenarioC = evaluateChange({ birthMonth: 9, birthDay: 7 }, { birthMonth: 9, birthDay: 8 }, new Date('2026-09-07T04:00:00.000Z'))
  assert.equal(scenarioC.oldToday, true)
  assert.equal(scenarioC.newToday, false)

  // D: a changed birthday is today and must be eligible immediately.
  const scenarioD = evaluateChange({ birthMonth: 9, birthDay: 8 }, { birthMonth: 9, birthDay: 7 }, new Date('2026-09-07T04:00:00.000Z'))
  assert.equal(scenarioD.oldToday, false)
  assert.equal(scenarioD.newToday, true)

  // E: the new Aquarius badge must wait for the Aquarius period.
  const scenarioENow = evaluateChange({ birthMonth: 7, birthDay: 15 }, { birthMonth: 1, birthDay: 25 }, new Date('2026-09-10T04:00:00.000Z'))
  assert.equal(scenarioENow.oldZodiac, false)
  assert.equal(scenarioENow.newZodiac, false)
  const scenarioELater = evaluateBadgeRule({
    user: { birthMonth: 1, birthDay: 25 },
    rule: { ...zodiacRule, configJson: { zodiac: 'AQUARIUS' } },
    now: new Date('2027-01-30T04:00:00.000Z'),
  })
  assert.equal(scenarioELater, true)
})

test('场景 F：星座来源软回收后保留历史并允许按稳定资格键重新激活', () => {
  const service = read('lib/badge-service.ts')
  const revokeStart = service.indexOf('export async function revokeBadgeAcquisitionSource')
  const revoke = service.slice(revokeStart)
  assert.match(service, /sameSource\.isActive/)
  assert.match(service, /regrantRecordId = sameGrant\.id/)
  assert.match(service, /regrantRecordId = sameSource\.userBadgeId/)
  assert.match(service, /grantKey,/)
  assert.match(service, /reactivated: true/)
  assert.match(revoke, /userBadgeSource\.update\(/)
  assert.doesNotMatch(revoke, /userBadge\.deleteMany|userBadge\.delete\(/i)
})

test('生日变更完整重算会修复当前持有来源并刷新资料页勋章状态', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const retention = read('lib/badge-retention.ts')
  const service = read('lib/badge-service.ts')
  const profileRoute = read('app/api/users/me/route.ts')
  const adminRoute = read('app/api/admin/users/[userId]/route.ts')
  const profileForm = read('app/profile/ProfileSettingsForm.tsx')
  const collectionPanel = read('components/BadgeCollectionPanel.tsx')

  assert.match(engine, /const latestBirthday = await prisma\.user\.findUnique\(/)
  assert.match(engine, /Retention runs first[\s\S]*evaluateUserAutoBadges\(userId, ruleTypes/)
  assert.match(retention, /async function repairBirthdayAutomaticSource\(/)
  assert.match(retention, /prisma\.userBadge\.findMany\(\{[\s\S]*badgeId: rule\.badgeId[\s\S]*activeUserBadgeWhere\(now\)/)
  assert.match(retention, /await grantBadge\(\{[\s\S]*sourceType: source\.sourceType[\s\S]*deferPhase3Effects: true/)
  assert.match(retention, /sourceIdFilter = !rule\.legacyBirthdaySource && isBirthdayRetentionRule\(rule\)/)
  assert.match(service, /sameGrant\.status === 'ACTIVE'/)
  assert.match(service, /regrantRecordId = sameGrant\.id/)
  assert.match(profileRoute, /getEquippedBadgesForUser\(guard\.user\.id\)/)
  assert.match(adminRoute, /getEquippedBadgesForUser\(userId\)/)
  assert.match(profileForm, /eason-badge-updated/)
  assert.match(profileForm, /eason-badge-collection-updated/)
  assert.match(collectionPanel, /addEventListener\('eason-badge-collection-updated'/)
})
