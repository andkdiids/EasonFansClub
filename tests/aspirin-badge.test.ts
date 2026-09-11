import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ASPIRIN_CLINIC_MODULE,
  ASPIRIN_MAX_REPEAT_RATE,
  ASPIRIN_MIN_LENGTH,
  getAspirinRuleConfig,
  validateSustainedQualificationSettings,
} from '@/lib/aspirin-badge-config'
import {
  calculateAspirinRepeatRate,
  getAspirinDailyQualifiedCaseIds,
  getAspirinDailyProgress,
  getAspirinQualifiedDateKeys,
  isAspirinInitialQualificationComplete,
  isValidAspirinConsultation,
  type AspirinConsultationFact,
} from '@/lib/aspirin-consultation'
import {
  countShanghaiNaturalDaysSince,
  evaluateAspirinConsultationFacts,
  getSustainedQualificationState,
} from '@/lib/aspirin-badge'

const userId = 'user-a'
const config = {
  module: ASPIRIN_CLINIC_MODULE,
  minLength: ASPIRIN_MIN_LENGTH,
  maxRepeatRate: ASPIRIN_MAX_REPEAT_RATE,
  initialStreakDays: 2,
} as const

const rule = {
  id: 'aspirin-rule',
  badgeId: 'aspirin-badge',
  ruleType: 'CLINIC_CONSULTATION_STREAK' as const,
  threshold: 5,
  secondaryThreshold: 2,
  configJson: config,
  isEnabled: true,
  sustainedQualification: true,
  inactiveAfterDays: 2,
  revokeAfterDays: 7,
}

function uniqueText(length = 24) {
  return Array.from({ length }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('')
}

function fact(overrides: Partial<AspirinConsultationFact> = {}): AspirinConsultationFact {
  return {
    id: `consultation-${Math.random()}`,
    recordId: 'case-1',
    authorId: userId,
    content: uniqueText(),
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date('2026-09-11T04:00:00.000Z'),
    record: { authorId: 'case-owner', category: 'ASK_DOCTORS', status: 'ACTIVE', deletedAt: null },
    ...overrides,
  }
}

function dailyFacts(count: number, date = '2026-09-11T04:00:00.000Z') {
  return Array.from({ length: count }, (_, index) => fact({
    id: `consultation-${index}`,
    recordId: `case-${index}`,
    createdAt: new Date(date),
  }))
}

test('阿士匹灵规则只接受稳定的 ASPIRIN_CLINIC 配置，并校验持续资格边界', () => {
  assert.deepEqual(getAspirinRuleConfig(config), config)
  assert.equal(getAspirinRuleConfig({ ...config, module: 'FORUM' }), null)
  assert.deepEqual(validateSustainedQualificationSettings({ sustainedQualification: true, inactiveAfterDays: 2, revokeAfterDays: 7 }), {
    sustainedQualification: true,
    inactiveAfterDays: 2,
    revokeAfterDays: 7,
  })
  assert.match(String(validateSustainedQualificationSettings({ sustainedQualification: true, inactiveAfterDays: 7, revokeAfterDays: 2 }).error), /大于/)
})

test('只有阿士匹灵门诊部中回答他人病例才进入进度', () => {
  const forum = fact({ record: { authorId: 'case-owner', category: 'FORUM', status: 'ACTIVE', deletedAt: null } })
  const salon = fact({ record: { authorId: 'case-owner', category: 'SALON', status: 'ACTIVE', deletedAt: null } })
  const activity = fact({ record: { authorId: 'case-owner', category: 'ACTIVITY', status: 'ACTIVE', deletedAt: null } })
  const selfCase = fact({ record: { authorId: userId, category: 'ASK_DOCTORS', status: 'ACTIVE', deletedAt: null } })
  const clinic = fact()
  assert.equal(isValidAspirinConsultation(forum, userId, config), false)
  assert.equal(isValidAspirinConsultation(salon, userId, config), false)
  assert.equal(isValidAspirinConsultation(activity, userId, config), false)
  assert.equal(isValidAspirinConsultation(selfCase, userId, config), false)
  assert.equal(isValidAspirinConsultation(clinic, userId, config), true)
  assert.equal(getAspirinDailyQualifiedCaseIds([forum, salon, activity, selfCase], userId, '2026-09-11', config).size, 0)
  assert.equal(getAspirinDailyQualifiedCaseIds([...dailyFacts(3), forum], userId, '2026-09-11', config).size, 3)
})

test('每日按不同病例去重，重复回答和无效内容不会污染进度', () => {
  const repeated = Array.from({ length: 5 }, (_, index) => fact({ id: `same-${index}` }))
  assert.equal(getAspirinDailyQualifiedCaseIds(repeated, userId, '2026-09-11', config).size, 1)
  assert.equal(getAspirinDailyQualifiedCaseIds(dailyFacts(5), userId, '2026-09-11', config).size, 5)
  assert.equal(getAspirinDailyProgress([fact()], userId, '2026-09-11', config, 5).current, 1)
  assert.equal(getAspirinDailyProgress(dailyFacts(5), userId, '2026-09-11', config, 5).current, 5)
  assert.equal(isValidAspirinConsultation(fact({ content: uniqueText(20) }), userId, config), false)
  assert.equal(isValidAspirinConsultation(fact({ content: uniqueText(21) }), userId, config), true)
  assert.equal(isValidAspirinConsultation(fact({ status: 'DELETED' }), userId, config), false)
  assert.equal(isValidAspirinConsultation(fact({ record: { authorId: 'case-owner', category: 'ASK_DOCTORS', status: 'REMOVED', deletedAt: null } }), userId, config), false)
  const afterDeletion = dailyFacts(5)
  afterDeletion[0] = fact({ id: 'deleted', recordId: 'case-0', status: 'DELETED' })
  assert.equal(getAspirinDailyQualifiedCaseIds(afterDeletion, userId, '2026-09-11', config).size, 4)
})

test('字符重复率严格使用小于 70% 的边界', () => {
  const distinctTail = (length: number) => Array.from({ length }, (_, index) => String.fromCodePoint(0x5000 + index)).join('')
  assert.equal(calculateAspirinRepeatRate(`${'a'.repeat(69)}${distinctTail(31)}`), 0.69)
  assert.equal(calculateAspirinRepeatRate(`${'a'.repeat(70)}${distinctTail(30)}`), 0.7)
  assert.equal(calculateAspirinRepeatRate(`${'a'.repeat(71)}${distinctTail(29)}`), 0.71)
  assert.equal(isValidAspirinConsultation(fact({ content: `${'a'.repeat(69)}${distinctTail(31)}` }), userId, config), true)
  assert.equal(isValidAspirinConsultation(fact({ content: `${'a'.repeat(70)}${distinctTail(30)}` }), userId, config), false)
})

test('连续合格日按上海自然日计算，缺日不能凑成连续两天', () => {
  const dayOne = dailyFacts(5, '2026-09-10T04:00:00.000Z')
  const dayTwo = dailyFacts(5, '2026-09-11T04:00:00.000Z')
  const consecutive = isAspirinInitialQualificationComplete([...dayOne, ...dayTwo], userId, '2026-09-11', config, 5)
  assert.equal(consecutive.qualifiedToday, true)
  assert.equal(consecutive.streakDays, 2)
  assert.equal(getAspirinQualifiedDateKeys([...dayOne, ...dayTwo], userId, config, 5).size, 2)

  const dayThree = dailyFacts(5, '2026-09-12T04:00:00.000Z')
  const withGap = isAspirinInitialQualificationComplete([...dayOne, ...dayThree], userId, '2026-09-12', config, 5)
  assert.equal(withGap.streakDays, 1)

  const incompleteDay = dailyFacts(4, '2026-09-13T04:00:00.000Z')
  const completeAfterIncomplete = isAspirinInitialQualificationComplete([...incompleteDay, ...dayThree], userId, '2026-09-13', config, 5)
  assert.equal(completeAfterIncomplete.streakDays, 0)
})


test('持续资格使用统一上海自然日边界并区分灰化与正式收回', () => {
  assert.equal(countShanghaiNaturalDaysSince('2026-09-01T15:59:59.000Z', new Date('2026-09-01T16:00:00.000Z')), 1)
  assert.deepEqual(getSustainedQualificationState({
    currentStatus: 'ACTIVE',
    lastQualifiedAt: new Date('2026-09-01T04:00:00.000Z'),
    now: new Date('2026-09-04T04:00:00.000Z'),
    inactiveAfterDays: 2,
    revokeAfterDays: 7,
  }), { state: 'GRAYED', daysSince: 3 })
  assert.deepEqual(getSustainedQualificationState({
    currentStatus: 'GRAYED',
    lastQualifiedAt: new Date('2026-09-01T04:00:00.000Z'),
    now: new Date('2026-09-09T04:00:00.000Z'),
    inactiveAfterDays: 2,
    revokeAfterDays: 7,
  }), { state: 'REVOKED', daysSince: 8 })
})

test('正式收回后必须从撤回时刻开始重新累计两天获取周期', () => {
  const beforeRevoke = dailyFacts(5, '2026-09-10T04:00:00.000Z')
  const firstNewDay = dailyFacts(5, '2026-09-11T04:00:00.000Z')
  const evaluation = evaluateAspirinConsultationFacts({
    userId,
    rule,
    facts: [...beforeRevoke, ...firstNewDay],
    now: new Date('2026-09-11T05:00:00.000Z'),
    qualificationStartsAt: new Date('2026-09-10T05:00:00.000Z'),
  })
  assert.equal(evaluation.qualifiedToday, true)
  assert.equal(evaluation.currentStreakDays, 1)
  assert.equal(evaluation.qualificationStartsAt?.toISOString(), '2026-09-10T05:00:00.000Z')
})
