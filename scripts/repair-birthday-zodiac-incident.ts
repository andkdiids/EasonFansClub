import 'dotenv/config'

import { getZodiacFromRuleConfig } from '../lib/badge-rules'
import { revokeBadgeAcquisitionSource } from '../lib/badge-service'
import { prisma } from '../lib/prisma'
import { getCurrentZodiacSign, resolveZodiac, ZODIAC_SIGNS, type ZodiacSign } from '../lib/zodiac'

export const INCIDENT_REVOKE_REASON = 'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT'
export const INCIDENT_TIMEZONE = 'Asia/Shanghai'

type SourceHistory = {
  id: string
  sourceType: string
  sourceId: string | null
  isActive: boolean
  grantedAt: Date
  revokedAt: Date | null
}

export type ZodiacIncidentSourceRow = {
  id: string
  userId: string
  badgeId: string
  userBadgeId: string
  sourceType: string
  sourceId: string | null
  isActive: boolean
  grantedAt: Date
  revokedAt: Date | null
  User: {
    id: string
    uid: number
    birthMonth: number | null
    birthDay: number | null
  }
  Badge: {
    id: string
    name: string
    slug: string
    BadgeRule: { id: string; configJson: unknown } | null
  }
  UserBadge: {
    id: string
    status: string
    grantedAt: Date
    awardedAt: Date
    grantReason: string | null
    UserBadgeSource: SourceHistory[]
  }
}

export type ZodiacIncidentFallbackRow = {
  id: string
  userId: string
  badgeId: string
  status: string
  grantedAt: Date
  awardedAt: Date
  sourceType: string | null
  sourceId: string | null
  User: {
    id: string
    uid: number
    birthMonth: number | null
    birthDay: number | null
  }
  Badge: {
    id: string
    name: string
    slug: string
    BadgeRule: { id: string; configJson: unknown } | null
  }
  UserBadgeSource: Array<{ id: string }>
}

type IncidentSourceClassification = 'VALID_CURRENT_PERIOD' | 'FALSE_GRANT' | 'MANUAL' | 'AMBIGUOUS'

export type ZodiacIncidentFalseGrant = {
  sourceRowId: string
  userId: string
  uid: number
  badgeId: string
  badgeName: string
  badgeSlug: string
  ruleId: string | null
  currentBirthday: string | null
  resolvedZodiac: ZodiacSign | null
  badgeZodiac: ZodiacSign | null
  grantAt: string
  sourceType: string
  sourceId: string | null
  zodiacPeriodAtGrant: ZodiacSign | null
  userBadgeId: string
  userBadgeStatus: string
  isActive: boolean
  priorLegitimateOwnership: boolean
  action: 'REVOKE_SOURCE' | 'ALREADY_REVOKED'
  reason: string
}

export type ZodiacIncidentDryRun = {
  mode: 'DRY_RUN'
  incidentStart: string
  incidentEnd: string
  timezone: typeof INCIDENT_TIMEZONE
  totalGrantsInWindow: number
  totalAutoZodiacGrantsInWindow: number
  validCurrentPeriodGrants: number
  falseFuturePreviousPeriodGrants: number
  manualGrants: number
  ambiguousGrants: number
  falseGrantsByZodiac: Record<ZodiacSign, number>
  legitimateHistoricalOwnershipProtected: number
  usersToRevoke: number
  ownershipsToRevoke: number
  falseGrants: ZodiacIncidentFalseGrant[]
  manualGrantSamples: Array<Record<string, unknown>>
  ambiguousGrantSamples: Array<Record<string, unknown>>
  productionMutated: false
  note: string
}

export type ZodiacIncidentAuditResult = {
  report: ZodiacIncidentDryRun
  revocable: ZodiacIncidentFalseGrant[]
}

const KNOWN_MANUAL_SOURCE_TYPES = new Set(['ADMIN_GRANT', 'ADMIN_BACKFILL', 'MANUAL', 'BIRTHDAY_HISTORY_BACKFILL'])

function formatBirthday(month: number | null, day: number | null) {
  return month != null && day != null
    ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : null
}

function dateIso(value: Date) {
  return value.toISOString()
}

function periodAt(value: Date) {
  return getCurrentZodiacSign(value, INCIDENT_TIMEZONE)
}

function sourceWasLegitimateAtGrant(source: SourceHistory, targetZodiac: ZodiacSign, ruleId: string) {
  return source.sourceType === 'AUTO_RULE'
    && source.sourceId === ruleId
    && source.isActive
    && periodAt(source.grantedAt) === targetZodiac
}

function hasPriorLegitimateOwnership(row: ZodiacIncidentSourceRow, targetZodiac: ZodiacSign, ruleId: string, incidentStart: Date) {
  return row.UserBadge.UserBadgeSource.some((source) => {
    if (source.id === row.id || source.grantedAt >= incidentStart) return false
    if (sourceWasLegitimateAtGrant(source, targetZodiac, ruleId)) return true
    return KNOWN_MANUAL_SOURCE_TYPES.has(source.sourceType) && source.isActive
  })
}

function detailForSource(row: ZodiacIncidentSourceRow, incidentStart: Date): { classification: IncidentSourceClassification; detail: ZodiacIncidentFalseGrant | Record<string, unknown> } {
  const targetZodiac = row.Badge.BadgeRule ? getZodiacFromRuleConfig(row.Badge.BadgeRule.configJson) : null
  const resolvedZodiac = row.User.birthMonth != null && row.User.birthDay != null
    ? resolveZodiac(row.User.birthMonth, row.User.birthDay)
    : null
  const grantPeriod = periodAt(row.grantedAt)
  const common = {
    sourceRowId: row.id,
    userId: row.userId,
    uid: row.User.uid,
    badgeId: row.badgeId,
    badgeName: row.Badge.name,
    badgeSlug: row.Badge.slug,
    ruleId: row.Badge.BadgeRule?.id || null,
    currentBirthday: formatBirthday(row.User.birthMonth, row.User.birthDay),
    resolvedZodiac,
    badgeZodiac: targetZodiac,
    grantAt: dateIso(row.grantedAt),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    zodiacPeriodAtGrant: grantPeriod,
    userBadgeId: row.userBadgeId,
    userBadgeStatus: row.UserBadge.status,
    isActive: row.isActive,
  }

  if (row.sourceType !== 'AUTO_RULE') {
    const classification = KNOWN_MANUAL_SOURCE_TYPES.has(row.sourceType) ? 'MANUAL' : 'AMBIGUOUS'
    return {
      classification,
      detail: { ...common, reason: classification === 'MANUAL' ? '非自动星座规则来源，保留不处理' : '来源类型无法安全归类，列入 REVIEW_REQUIRED' },
    }
  }

  if (!row.sourceId || !row.Badge.BadgeRule || !targetZodiac || row.sourceId !== row.Badge.BadgeRule.id || !resolvedZodiac || resolvedZodiac !== targetZodiac) {
    return {
      classification: 'AMBIGUOUS',
      detail: { ...common, reason: '自动来源、规则、当前生日快照无法完整对应，列入 REVIEW_REQUIRED' },
    }
  }

  if (grantPeriod === targetZodiac) {
    return {
      classification: 'VALID_CURRENT_PERIOD',
      detail: { ...common, reason: '发放当日处于该勋章对应星座周期，合法保留' },
    }
  }

  const priorLegitimateOwnership = hasPriorLegitimateOwnership(row, targetZodiac, row.Badge.BadgeRule.id, incidentStart)
  const falseGrant: ZodiacIncidentFalseGrant = {
    ...common,
    priorLegitimateOwnership,
    action: row.isActive ? 'REVOKE_SOURCE' : 'ALREADY_REVOKED',
    reason: `发放当日上海时区星座周期为${grantPeriod || 'UNKNOWN'}，规则要求${targetZodiac}；仅撤回本次自动来源${priorLegitimateOwnership ? '，历史合法 ownership 由其他来源保护' : ''}`,
  }
  return { classification: 'FALSE_GRANT', detail: falseGrant }
}

function fallbackDetail(row: ZodiacIncidentFallbackRow) {
  return {
    sourceRowId: null,
    userId: row.userId,
    uid: row.User.uid,
    badgeId: row.badgeId,
    badgeName: row.Badge.name,
    badgeSlug: row.Badge.slug,
    ruleId: row.Badge.BadgeRule?.id || null,
    currentBirthday: formatBirthday(row.User.birthMonth, row.User.birthDay),
    resolvedZodiac: row.User.birthMonth != null && row.User.birthDay != null ? resolveZodiac(row.User.birthMonth, row.User.birthDay) : null,
    badgeZodiac: row.Badge.BadgeRule ? getZodiacFromRuleConfig(row.Badge.BadgeRule.configJson) : null,
    grantAt: dateIso(row.grantedAt),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    zodiacPeriodAtGrant: periodAt(row.grantedAt),
    userBadgeId: row.id,
    userBadgeStatus: row.status,
    isActive: row.status === 'ACTIVE',
    reason: '没有归一化 UserBadgeSource，无法证明是本次自动星座来源，列入 REVIEW_REQUIRED',
  }
}

function emptyZodiacCounts(): Record<ZodiacSign, number> {
  return Object.fromEntries(ZODIAC_SIGNS.map((sign) => [sign, 0])) as Record<ZodiacSign, number>
}

function sampleDetail(value: Record<string, unknown>) {
  return {
    userId: value.userId,
    uid: value.uid,
    badgeId: value.badgeId,
    badgeName: value.badgeName,
    badgeZodiac: value.badgeZodiac,
    grantAt: value.grantAt,
    sourceType: value.sourceType,
    sourceId: value.sourceId,
    reason: value.reason,
  }
}

export function buildZodiacIncidentDryRun({
  incidentStart,
  incidentEnd,
  sources,
  fallbackRows = [],
}: {
  incidentStart: Date
  incidentEnd: Date
  sources: readonly ZodiacIncidentSourceRow[]
  fallbackRows?: readonly ZodiacIncidentFallbackRow[]
}): ZodiacIncidentAuditResult {
  const falseGrants: ZodiacIncidentFalseGrant[] = []
  const manualGrantSamples: Array<Record<string, unknown>> = []
  const ambiguousGrantSamples: Array<Record<string, unknown>> = []
  const falseGrantsByZodiac = emptyZodiacCounts()
  let validCurrentPeriodGrants = 0
  let manualGrants = 0
  let ambiguousGrants = fallbackRows.length

  for (const row of sources) {
    const { classification, detail } = detailForSource(row, incidentStart)
    if (classification === 'VALID_CURRENT_PERIOD') validCurrentPeriodGrants += 1
    if (classification === 'MANUAL') {
      manualGrants += 1
      if (manualGrantSamples.length < 100) manualGrantSamples.push(sampleDetail(detail as Record<string, unknown>))
    }
    if (classification === 'AMBIGUOUS') {
      ambiguousGrants += 1
      if (ambiguousGrantSamples.length < 100) ambiguousGrantSamples.push(sampleDetail(detail as Record<string, unknown>))
    }
    if (classification === 'FALSE_GRANT') {
      const falseGrant = detail as ZodiacIncidentFalseGrant
      falseGrants.push(falseGrant)
      if (falseGrant.badgeZodiac) falseGrantsByZodiac[falseGrant.badgeZodiac] += 1
    }
  }

  for (const row of fallbackRows) {
    if (ambiguousGrantSamples.length < 100) ambiguousGrantSamples.push(sampleDetail(fallbackDetail(row)))
  }

  const revocable = falseGrants.filter((grant) => grant.action === 'REVOKE_SOURCE')
  const protectedUsers = new Set(falseGrants.filter((grant) => grant.priorLegitimateOwnership).map((grant) => grant.userId))
  const usersToRevoke = new Set(revocable.map((grant) => grant.userId)).size
  const report: ZodiacIncidentDryRun = {
    mode: 'DRY_RUN',
    incidentStart: dateIso(incidentStart),
    incidentEnd: dateIso(incidentEnd),
    timezone: INCIDENT_TIMEZONE,
    totalGrantsInWindow: sources.length + fallbackRows.length,
    totalAutoZodiacGrantsInWindow: sources.filter((source) => source.sourceType === 'AUTO_RULE').length,
    validCurrentPeriodGrants,
    falseFuturePreviousPeriodGrants: falseGrants.length,
    manualGrants,
    ambiguousGrants,
    falseGrantsByZodiac,
    legitimateHistoricalOwnershipProtected: protectedUsers.size,
    usersToRevoke,
    ownershipsToRevoke: revocable.length,
    falseGrants,
    manualGrantSamples,
    ambiguousGrantSamples,
    productionMutated: false,
    note: '只读 dry-run；未执行 grant、revoke、update、delete、migration 或生产数据库写入。',
  }
  return { report, revocable }
}

async function loadIncidentRows(incidentStart: Date, incidentEnd: Date) {
  const sourceWhere = {
    grantedAt: { gte: incidentStart, lt: incidentEnd },
    Badge: { grantType: 'AUTO' as const, BadgeRule: { is: { ruleType: 'BIRTHDAY_ZODIAC' as const } } },
  }
  const [sources, aggregateRows] = await Promise.all([
    prisma.userBadgeSource.findMany({
      where: sourceWhere,
      orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        userId: true,
        badgeId: true,
        userBadgeId: true,
        sourceType: true,
        sourceId: true,
        isActive: true,
        grantedAt: true,
        revokedAt: true,
        User: { select: { id: true, uid: true, birthMonth: true, birthDay: true } },
        Badge: { select: { id: true, name: true, slug: true, BadgeRule: { select: { id: true, configJson: true } } } },
        UserBadge: {
          select: {
            id: true,
            status: true,
            grantedAt: true,
            awardedAt: true,
            grantReason: true,
            UserBadgeSource: { select: { id: true, sourceType: true, sourceId: true, isActive: true, grantedAt: true, revokedAt: true } },
          },
        },
      },
    }),
    prisma.userBadge.findMany({
      where: sourceWhere,
      orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        userId: true,
        badgeId: true,
        status: true,
        grantedAt: true,
        awardedAt: true,
        sourceType: true,
        sourceId: true,
        User: { select: { id: true, uid: true, birthMonth: true, birthDay: true } },
        Badge: { select: { id: true, name: true, slug: true, BadgeRule: { select: { id: true, configJson: true } } } },
        UserBadgeSource: { select: { id: true } },
      },
    }),
  ])
  const sourceUserBadgeIds = new Set(sources.map((source) => source.userBadgeId))
  const fallbackRows = aggregateRows.filter((row) => !sourceUserBadgeIds.has(row.id) && row.UserBadgeSource.length === 0)
  return { sources, fallbackRows }
}

function argumentValue(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || null : null
}

function parseDateArgument(name: string) {
  const value = argumentValue(name)
  if (!value) throw new Error(`${name} 必须提供 ISO 时间，例如 2026-09-07T13:01:25.000Z`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} 不是有效 ISO 时间`)
  return parsed
}

async function main() {
  const incidentStart = parseDateArgument('--incident-start')
  const incidentEnd = parseDateArgument('--incident-end')
  if (incidentEnd <= incidentStart) throw new Error('--incident-end 必须晚于 --incident-start')
  const apply = process.argv.includes('--apply')
  const { sources, fallbackRows } = await loadIncidentRows(incidentStart, incidentEnd)
  const initial = buildZodiacIncidentDryRun({ incidentStart, incidentEnd, sources, fallbackRows })
  console.info(JSON.stringify(initial.report, null, 2))
  if (!apply) return

  const confirmation = argumentValue('--confirm-false-grants')
  const expected = Number(confirmation)
  if (!Number.isSafeInteger(expected) || expected !== initial.report.ownershipsToRevoke) {
    throw new Error(`正式撤回必须使用 --confirm-false-grants ${initial.report.ownershipsToRevoke}，且脚本会在写入前重新执行 dry-run`)
  }

  let revoked = 0
  for (const grant of initial.revocable) {
    const result = await revokeBadgeAcquisitionSource({
      userId: grant.userId,
      badgeId: grant.badgeId,
      sourceType: grant.sourceType,
      sourceId: grant.sourceId || '',
      reason: INCIDENT_REVOKE_REASON,
    })
    if (result.revoked) revoked += 1
  }

  const afterRows = await loadIncidentRows(incidentStart, incidentEnd)
  const after = buildZodiacIncidentDryRun({ incidentStart, incidentEnd, ...afterRows })
  console.info(JSON.stringify({
    mode: 'APPLY_RESULT',
    productionMutated: true,
    falseGrantsRevoked: revoked,
    secondDryRun: after.report,
  }, null, 2))
}

if (process.argv[1]?.endsWith('repair-birthday-zodiac-incident.ts')) {
  main().catch(async (error) => {
    console.error('[repair-birthday-zodiac-incident] failed', error)
    await prisma.$disconnect().catch(() => undefined)
    process.exitCode = 1
  }).finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
}
