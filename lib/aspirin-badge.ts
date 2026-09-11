import type { Prisma } from '@prisma/client'
import { getShanghaiDateKey, shiftShanghaiDateKey } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'
import {
  getAspirinDailyQualifiedCaseIds,
  getAspirinDailyProgress,
  getAspirinQualifiedDateKeys,
  calculateAspirinCurrentStreak,
  isValidAspirinConsultation,
  type AspirinConsultationFact,
} from '@/lib/aspirin-consultation'
import { getAspirinRuleConfig, type AspirinRuleConfig } from '@/lib/aspirin-badge-config'
import { isAcquisitionOnlyBadgeRule, type SupportedBadgeRuleType } from '@/lib/badge-rules'
import {
  getSustainedBadgeOwnership,
  grantBadge,
  markBadgeGrayed,
  recordBadgeQualificationDay,
  restoreGrayedBadge,
  revokeBadgeAcquisitionSource,
} from '@/lib/badge-service'

export type AspirinRuleRecord = {
  id: string
  badgeId: string
  ruleType: SupportedBadgeRuleType
  threshold: number | null
  secondaryThreshold: number | null
  configJson: unknown
  isEnabled: boolean
  sustainedQualification: boolean
  inactiveAfterDays: number | null
  revokeAfterDays: number | null
}

export type AspirinConsultationQueryRow = {
  id: string
  recordId: string
  authorId: string
  content: string
  status: string
  deletedAt: Date | null
  createdAt: Date
  record: { authorId: string; category: string; status: string; deletedAt: Date | null }
}

export function toAspirinConsultationFact(row: AspirinConsultationQueryRow): AspirinConsultationFact {
  return {
    id: row.id,
    recordId: row.recordId,
    authorId: row.authorId,
    content: row.content,
    status: row.status,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    record: row.record,
  }
}

function asFacts(rows: readonly AspirinConsultationQueryRow[]): AspirinConsultationFact[] {
  return rows.map(toAspirinConsultationFact)
}

/**
 * Load only the real clinic consultation stream. Forum Post/Comment, salon,
 * activity and ClinicAspirin interaction rows are intentionally absent here.
 */
async function loadAspirinConsultationFacts(userId: string, now: Date) {
  const rows = await prisma.clinicConsultation.findMany({
    where: {
      authorId: userId,
      status: 'ACTIVE',
      deletedAt: null,
      createdAt: { lte: now },
      record: { category: 'ASK_DOCTORS', status: 'ACTIVE', deletedAt: null },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      recordId: true,
      authorId: true,
      content: true,
      status: true,
      deletedAt: true,
      createdAt: true,
      record: { select: { authorId: true, category: true, status: true, deletedAt: true } },
    },
  })
  return asFacts(rows)
}

/**
 * Detail and tracking views need today's live case count, not the acquisition
 * cursor used after a formal revoke. In particular, a previous revoke must
 * never make a valid consultation disappear from the current X/5 display.
 */
export async function getAspirinDailyProgressForUser(input: { userId: string; rule: AspirinRuleRecord; now?: Date }) {
  const now = input.now || new Date()
  const facts = await loadAspirinConsultationFacts(input.userId, now)
  const config = getAspirinRuleConfig(input.rule.configJson)
  const dailyTarget = Number.isSafeInteger(input.rule.threshold) && (input.rule.threshold || 0) > 0 ? input.rule.threshold! : 1
  if (!config) return { current: 0, target: dailyTarget, caseIds: new Set<string>(), dateKey: getShanghaiDateKey(now), config: null }
  const progress = getAspirinDailyProgress(facts, input.userId, getShanghaiDateKey(now), config, dailyTarget)
  return { ...progress, dateKey: getShanghaiDateKey(now), config }
}

export type AspirinRuleEvaluation = {
  config: AspirinRuleConfig | null
  dailyTarget: number
  initialStreakDays: number
  dateKey: string
  /** When a prior formal revoke exists, only facts after that revoke start a new acquisition streak. */
  qualificationStartsAt: Date | null
  dailyCount: number
  qualifiedToday: boolean
  qualifiedDateKeys: ReadonlySet<string>
  currentStreakDays: number
  validFacts: AspirinConsultationFact[]
  totalFacts: number
}

/** Evaluate a preloaded consultation stream with the same resolver used by runtime reconciliation. */
export function evaluateAspirinConsultationFacts(input: {
  userId: string
  rule: AspirinRuleRecord
  facts: readonly AspirinConsultationFact[]
  now?: Date
  qualificationStartsAt?: Date | null
}): AspirinRuleEvaluation {
  const now = input.now || new Date()
  const config = getAspirinRuleConfig(input.rule.configJson)
  const dailyTarget = Number.isSafeInteger(input.rule.threshold) && (input.rule.threshold || 0) > 0 ? input.rule.threshold! : 1
  const initialStreakDays = Number.isSafeInteger(input.rule.secondaryThreshold) && (input.rule.secondaryThreshold || 0) > 0
    ? input.rule.secondaryThreshold!
    : config?.initialStreakDays || 1
  const dateKey = getShanghaiDateKey(now)
  const facts = input.facts.filter((fact) => new Date(fact.createdAt).getTime() <= now.getTime())
  const validFacts = config ? facts.filter((fact) => isValidAspirinConsultation(fact, input.userId, config)) : []
  const qualificationStartsAt = input.qualificationStartsAt || null
  const qualificationFacts = qualificationStartsAt
    ? validFacts.filter((fact) => new Date(fact.createdAt).getTime() > qualificationStartsAt.getTime())
    : validFacts
  const qualifiedDateKeys = config ? getAspirinQualifiedDateKeys(qualificationFacts, input.userId, config, dailyTarget) : new Set<string>()
  const caseIds = config ? getAspirinDailyQualifiedCaseIds(qualificationFacts, input.userId, dateKey, config) : new Set<string>()
  return {
    config,
    dailyTarget,
    initialStreakDays,
    dateKey,
    qualificationStartsAt,
    dailyCount: caseIds.size,
    qualifiedToday: caseIds.size >= dailyTarget,
    qualifiedDateKeys,
    currentStreakDays: calculateAspirinCurrentStreak(qualifiedDateKeys, dateKey),
    validFacts,
    totalFacts: facts.length,
  }
}

export async function getAspirinRuleEvaluation(input: { userId: string; rule: AspirinRuleRecord; now?: Date }): Promise<AspirinRuleEvaluation> {
  const now = input.now || new Date()
  const facts = await loadAspirinConsultationFacts(input.userId, now)
  const current = await getSustainedBadgeOwnership(input.userId, input.rule.badgeId, input.rule.id, now)
  const lastRevocation = current
    ? null
    : await prisma.userBadgeSource.findFirst({
      where: {
        userId: input.userId,
        badgeId: input.rule.badgeId,
        sourceType: 'AUTO_RULE',
        sourceId: input.rule.id,
        isActive: false,
        revokedAt: { not: null, lte: now },
      },
      orderBy: [{ revokedAt: 'desc' }, { id: 'desc' }],
      select: { revokedAt: true },
    })
  return evaluateAspirinConsultationFacts({ ...input, now, facts, qualificationStartsAt: lastRevocation?.revokedAt || null })
}

export type SustainedQualificationState = 'ACTIVE' | 'GRAYED' | 'REVOKED'

/** Natural-day difference in Asia/Shanghai; it never relies on elapsed milliseconds. */
export function countShanghaiNaturalDaysSince(lastQualifiedAt: Date | string | null, now: Date) {
  if (!lastQualifiedAt) return Number.POSITIVE_INFINITY
  const from = getShanghaiDateKey(lastQualifiedAt instanceof Date ? lastQualifiedAt : new Date(lastQualifiedAt))
  const to = getShanghaiDateKey(now)
  if (from >= to) return 0
  let cursor = from
  let days = 0
  while (cursor < to && days <= 10_000) {
    cursor = shiftShanghaiDateKey(cursor, 1)
    days += 1
  }
  return days
}

export function getSustainedQualificationState(input: {
  currentStatus: 'ACTIVE' | 'GRAYED'
  lastQualifiedAt: Date | string | null
  now: Date
  inactiveAfterDays: number
  revokeAfterDays: number
}) {
  const daysSince = countShanghaiNaturalDaysSince(input.lastQualifiedAt, input.now)
  if (daysSince > input.revokeAfterDays) return { state: 'REVOKED' as const, daysSince }
  if (daysSince > input.inactiveAfterDays) return { state: 'GRAYED' as const, daysSince }
  return { state: 'ACTIVE' as const, daysSince }
}

export type AspirinReconcileResult = {
  dailyCount: number
  dailyTarget: number
  initialStreakDays: number
  qualifiedToday: boolean
  currentStreakDays: number
  granted: boolean
  restored: boolean
  grayed: boolean
  revoked: boolean
  recordId: string | null
  state: SustainedQualificationState | null
  reason: string
}

/**
 * One live reconciliation path for the Aspirin rule. It is used by event
 * hooks, scans and previews' underlying evaluator; none of them count forum
 * content or maintain a second ownership record.
 */
export async function reconcileAspirinBadgeRule(input: { userId: string; rule: AspirinRuleRecord; now?: Date; applyStateTransitions?: boolean }): Promise<AspirinReconcileResult> {
  const now = input.now || new Date()
  const evaluation = await getAspirinRuleEvaluation({ userId: input.userId, rule: input.rule, now })
  const base: AspirinReconcileResult = {
    dailyCount: evaluation.dailyCount,
    dailyTarget: evaluation.dailyTarget,
    initialStreakDays: evaluation.initialStreakDays,
    qualifiedToday: evaluation.qualifiedToday,
    currentStreakDays: evaluation.currentStreakDays,
    granted: false,
    restored: false,
    grayed: false,
    revoked: false,
    recordId: null,
    state: null,
    reason: evaluation.config ? '当前门诊问诊资格已重新计算' : '阿士匹灵规则配置无效',
  }
  if (!evaluation.config || !input.rule.isEnabled) return base

  const current = await getSustainedBadgeOwnership(input.userId, input.rule.badgeId, input.rule.id, now)
  const applyStateTransitions = input.applyStateTransitions !== false
  const initialQualified = evaluation.qualifiedToday && evaluation.currentStreakDays >= evaluation.initialStreakDays

  if (!current) {
    if (!initialQualified) {
      return { ...base, reason: evaluation.qualifiedToday ? '当前仅达到当日目标，连续获取天数不足' : '当前未达到当日不同病例目标' }
    }
    if (!applyStateTransitions) {
      return { ...base, reason: `已完成连续 ${evaluation.initialStreakDays} 天获取条件，可发放` }
    }
    const result = await grantBadge({
      userId: input.userId,
      badgeId: input.rule.badgeId,
      sourceType: 'AUTO_RULE',
      sourceId: input.rule.id,
      // A new acquisition cycle must not reactivate the old revoked row. The
      // Shanghai qualification date keeps retries for the same completed
      // cycle idempotent while preserving the previous revoke audit record.
      grantKey: `aspirin-clinic:${input.rule.id}:${evaluation.dateKey}`,
      acquisitionCycleKey: `aspirin-clinic:${input.rule.id}:${evaluation.dateKey}`,
      initialQualificationAt: now,
      grantReason: `自动达成：连续 ${evaluation.initialStreakDays} 天完成阿士匹灵门诊部每日问诊目标`,
      obtainedAt: now,
      deferPhase3Effects: true,
    })
    if (evaluation.qualifiedToday) await recordBadgeQualificationDay({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: now })
    return { ...base, granted: result.created, recordId: result.recordId, state: 'ACTIVE', reason: result.created ? '完成连续获取条件，已发放' : '已满足连续获取条件且当前已有合法来源' }
  }

  base.recordId = current.id
  base.state = current.status
  if (!input.rule.sustainedQualification || input.rule.inactiveAfterDays == null || input.rule.revokeAfterDays == null) {
    if (evaluation.qualifiedToday && applyStateTransitions) await recordBadgeQualificationDay({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: now })
    return { ...base, reason: '勋章未启用持续资格，保留现有所有权' }
  }

  if (evaluation.qualifiedToday) {
    if (current.status === 'GRAYED') {
      if (!applyStateTransitions) return { ...base, reason: '当前符合持续资格，可恢复' }
      const restored = await restoreGrayedBadge({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: now })
      return { ...base, restored: restored.changed, state: 'ACTIVE', reason: restored.changed ? '完成当日持续资格，已恢复' : '当前已是有效所有权' }
    }
    if (applyStateTransitions) await recordBadgeQualificationDay({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: now })
    return { ...base, state: 'ACTIVE', reason: '完成当日持续资格，已刷新最近合格日' }
  }

  const lifecycle = getSustainedQualificationState({
    currentStatus: current.status,
    lastQualifiedAt: current.lastQualifiedAt || current.awardedAt,
    now,
    inactiveAfterDays: input.rule.inactiveAfterDays,
    revokeAfterDays: input.rule.revokeAfterDays,
  })
  base.state = lifecycle.state
  if (!applyStateTransitions) return { ...base, reason: `持续资格已连续 ${lifecycle.daysSince} 个自然日未达标，预计${lifecycle.state === 'GRAYED' ? '暂时失效' : lifecycle.state === 'REVOKED' ? '自动收回' : '保持有效'}` }
  if (lifecycle.state === 'GRAYED') {
    const grayed = await markBadgeGrayed({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: current.lastQualifiedAt || current.awardedAt, now })
    return { ...base, grayed: grayed.changed, state: 'GRAYED', reason: grayed.blockedByOtherSource ? '存在其他有效来源，保持整体所有权' : '持续资格超过暂时失效期限，已灰化' }
  }
  if (lifecycle.state === 'REVOKED') {
    const revoked = await revokeBadgeAcquisitionSource({
      userId: input.userId,
      badgeId: input.rule.badgeId,
      sourceType: 'AUTO_RULE',
      sourceId: input.rule.id,
      reason: '阿士匹灵持续资格超过自动收回期限',
      revokeReason: 'SYSTEM_REVOKED',
    })
    return { ...base, revoked: revoked.revoked, state: 'REVOKED', reason: revoked.revoked ? '持续资格超过自动收回期限，已收回' : '自动来源已经收回' }
  }
  return { ...base, state: 'ACTIVE', reason: '持续资格仍在有效宽限期内' }
}

export type SustainedBadgeScanSummary = {
  rules: number
  users: number
  evaluated: number
  granted: number
  restored: number
  grayed: number
  revoked: number
  failed: number
  failures: string[]
}

type SustainedRuleRecord = AspirinRuleRecord

/** Reuse the ordinary rule resolver for non-clinic sustained rules. */
async function isGenericSustainedRuleQualified(userId: string, rule: SustainedRuleRecord, now: Date) {
  const { isBadgeRuleSatisfied } = await import('@/lib/badge-retention')
  return isBadgeRuleSatisfied(userId, {
    ruleType: rule.ruleType,
    operator: 'GTE',
    threshold: rule.threshold,
    configJson: rule.configJson,
  }, now)
}

async function reconcileGenericSustainedBadgeRule(input: { userId: string; rule: SustainedRuleRecord; now: Date }) {
  if (isAcquisitionOnlyBadgeRule(input.rule.ruleType)) return { granted: false, restored: false, grayed: false, revoked: false }
  const current = await getSustainedBadgeOwnership(input.userId, input.rule.badgeId, input.rule.id, input.now)
  if (!current || !input.rule.sustainedQualification || input.rule.inactiveAfterDays == null || input.rule.revokeAfterDays == null) return { granted: false, restored: false, grayed: false, revoked: false }
  const qualified = await isGenericSustainedRuleQualified(input.userId, input.rule, input.now)
  if (qualified) {
    if (current.status === 'GRAYED') {
      const restored = await restoreGrayedBadge({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: input.now })
      return { granted: false, restored: restored.changed, grayed: false, revoked: false }
    }
    await recordBadgeQualificationDay({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: input.now })
    return { granted: false, restored: false, grayed: false, revoked: false }
  }
  const lifecycle = getSustainedQualificationState({
    currentStatus: current.status,
    lastQualifiedAt: current.lastQualifiedAt || current.awardedAt,
    now: input.now,
    inactiveAfterDays: input.rule.inactiveAfterDays,
    revokeAfterDays: input.rule.revokeAfterDays,
  })
  if (lifecycle.state === 'GRAYED') {
    const grayed = await markBadgeGrayed({ userId: input.userId, badgeId: input.rule.badgeId, ruleId: input.rule.id, lastQualifiedAt: current.lastQualifiedAt || current.awardedAt, now: input.now })
    return { granted: false, restored: false, grayed: grayed.changed, revoked: false }
  }
  if (lifecycle.state === 'REVOKED') {
    const revoked = await revokeBadgeAcquisitionSource({
      userId: input.userId,
      badgeId: input.rule.badgeId,
      sourceType: 'AUTO_RULE',
      sourceId: input.rule.id,
      reason: `持续资格超过${input.rule.revokeAfterDays}天未达标，已自动收回`,
      revokeReason: 'SYSTEM_REVOKED',
    })
    return { granted: false, restored: false, grayed: false, revoked: revoked.revoked }
  }
  return { granted: false, restored: false, grayed: false, revoked: false }
}

/** Periodic reconciliation for every enabled sustained rule, starting with Aspirin. */
export async function scanSustainedBadgeQualifications(now = new Date()): Promise<SustainedBadgeScanSummary> {
  const summary: SustainedBadgeScanSummary = { rules: 0, users: 0, evaluated: 0, granted: 0, restored: 0, grayed: 0, revoked: 0, failed: 0, failures: [] }
  const rules = await prisma.badgeRule.findMany({
    where: { isEnabled: true, sustainedQualification: true, ruleType: { not: 'BIRTHDAY_TODAY' }, Badge: { isEnabled: true, isActive: true, grantType: 'AUTO' } },
    select: { id: true, badgeId: true, ruleType: true, threshold: true, secondaryThreshold: true, configJson: true, isEnabled: true, sustainedQualification: true, inactiveAfterDays: true, revokeAfterDays: true },
  })
  summary.rules = rules.length
  for (const rule of rules) {
    const sources = await prisma.userBadgeSource.findMany({
      where: {
        sourceType: 'AUTO_RULE',
        sourceId: rule.id,
        isActive: true,
        UserBadge: { status: { in: ['ACTIVE', 'GRAYED'] } },
      },
      distinct: ['userId'],
      select: { userId: true },
    })
    summary.users += sources.length
    for (const source of sources) {
      summary.evaluated += 1
      try {
        const result = rule.ruleType === 'CLINIC_CONSULTATION_STREAK'
          ? await reconcileAspirinBadgeRule({ userId: source.userId, rule, now })
          : await reconcileGenericSustainedBadgeRule({ userId: source.userId, rule, now })
        if (result.granted) summary.granted += 1
        if (result.restored) summary.restored += 1
        if (result.grayed) summary.grayed += 1
        if (result.revoked) summary.revoked += 1
      } catch (error) {
        summary.failed += 1
        summary.failures.push(`${source.userId}:${rule.id}:${error instanceof Error ? error.message : '持续资格复核失败'}`)
      }
    }
  }
  return summary
}

export function isAspirinConsultationFactValidForRule(fact: AspirinConsultationFact, userId: string, config: AspirinRuleConfig) {
  return isValidAspirinConsultation(fact, userId, config)
}

// Keep the Prisma import in this module's type surface for callers that build
// dry-run adapters without weakening the production query type.
export type AspirinPrismaClient = Prisma.TransactionClient
