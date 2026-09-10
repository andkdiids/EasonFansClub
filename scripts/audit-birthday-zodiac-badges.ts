import { isUserBadgeActive } from '../lib/badge-validity'
import { getZodiacFromRuleConfig } from '../lib/badge-rules'
import { prisma as appPrisma } from '../lib/prisma'
import { resolveZodiacBadgeGrantEligibility } from '../lib/birthday-zodiac-grant'
import { getCurrentZodiacSign, resolveZodiac, ZODIAC_SIGNS, type ZodiacSign } from '../lib/zodiac'

type BirthdayUserRow = {
  id: string
  uid: number
  createdAt: Date
  birthMonth: number | null
  birthDay: number | null
}

type ZodiacBadgeRow = {
  id: string
  name: string
  slug: string
  BadgeRule: { id: string; configJson: unknown } | null
}

type UserBadgeRow = {
  userId: string
  badgeId: string
  status: string
  awardedAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
  sourceType: string | null
  sourceId: string | null
  revokeReason?: string | null
}

type ReadonlyAuditPrisma = {
  user: {
    findMany(args: {
      where: unknown
      orderBy: { id: 'asc' }
      select: { id: true; uid: true; createdAt: true; birthMonth: true; birthDay: true }
    }): Promise<BirthdayUserRow[]>
  }
  badge: {
    findMany(args: {
      where: unknown
      orderBy: Array<{ createdAt: 'asc' } | { id: 'asc' }>
      select: { id: true; name: true; slug: true; BadgeRule: { select: { id: true; configJson: true } } }
    }): Promise<ZodiacBadgeRow[]>
  }
  userBadge: {
    findMany(args: {
      where: unknown
      select: { userId: true; badgeId: true; status: true; awardedAt: true; expiresAt: true; revokedAt: true; revokeReason: true; sourceType: true; sourceId: true }
    }): Promise<UserBadgeRow[]>
  }
  $disconnect(): Promise<void>
}

type AuditSample = {
  uid: number
  registeredAt: string
  resolvedZodiac: ZodiacSign | null
  badge?: string
  reason: string
  source?: string | null
}

function dateValue(value: Date) {
  return value.toISOString()
}

function sampleUser(user: BirthdayUserRow, resolvedZodiac: ZodiacSign | null, reason: string, extra: Partial<AuditSample> = {}): AuditSample {
  return { uid: user.uid, registeredAt: dateValue(user.createdAt), resolvedZodiac, reason, ...extra }
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1)
}

type TargetZodiacAudit = {
  totalUsersInCurrentPeriod: number
  activeOwnership: number
  missingOwnership: number
  missingButEligible: number
  otherZodiacHistoryPresent: number
  blockedByOtherZodiacHistory: number
  blockedByIdempotency: number
  blockedByTargetRevoke: number
  unknown: number
  samples: AuditSample[]
}

function emptyTargetAudit(): TargetZodiacAudit {
  return {
    totalUsersInCurrentPeriod: 0,
    activeOwnership: 0,
    missingOwnership: 0,
    missingButEligible: 0,
    otherZodiacHistoryPresent: 0,
    blockedByOtherZodiacHistory: 0,
    blockedByIdempotency: 0,
    blockedByTargetRevoke: 0,
    unknown: 0,
    samples: [],
  }
}

export function buildBirthdayZodiacAuditReport(
  users: readonly BirthdayUserRow[],
  badges: readonly ZodiacBadgeRow[],
  userBadges: readonly UserBadgeRow[],
  now = new Date(),
) {
  const zodiacBadges = badges.flatMap((badge) => {
    const zodiac = badge.BadgeRule ? getZodiacFromRuleConfig(badge.BadgeRule.configJson) : null
    return zodiac ? [{ ...badge, zodiac }] : []
  })
  const badgeById = new Map(zodiacBadges.map((badge) => [badge.id, badge]))
  const rowsByUser = new Map<string, UserBadgeRow[]>()
  for (const row of userBadges) {
    if (!badgeById.has(row.badgeId)) continue
    const rows = rowsByUser.get(row.userId) || []
    rows.push(row)
    rowsByUser.set(row.userId, rows)
  }

  const zodiacDistribution = new Map<ZodiacSign, number>()
  const currentActiveZodiacBadges = new Map<ZodiacSign, number>()
  const missingCorrectZodiac: AuditSample[] = []
  const wrongActiveZodiac: AuditSample[] = []
  const multipleActiveZodiacs: AuditSample[] = []
  const incorrectlyRevoked: AuditSample[] = []
  const staleBirthdayMismatch: AuditSample[] = []
  const usersWithoutConfiguredZodiacBadge = new Map<ZodiacSign, number>()
  const currentPeriodZodiac = getCurrentZodiacSign(now, 'Asia/Shanghai')
  const targetAudit = Object.fromEntries(ZODIAC_SIGNS.map((zodiac) => [zodiac, emptyTargetAudit()])) as Record<ZodiacSign, TargetZodiacAudit>

  for (const user of users) {
    const resolved = user.birthMonth != null && user.birthDay != null
      ? resolveZodiac(user.birthMonth, user.birthDay)
      : null
    if (resolved) increment(zodiacDistribution, resolved)
    const rows = rowsByUser.get(user.id) || []
    const active = rows.filter((row) => isUserBadgeActive(row, now))
    const activeZodiacs = new Set<ZodiacSign>()
    for (const row of active) {
      const badge = badgeById.get(row.badgeId)
      if (!badge) continue
      increment(currentActiveZodiacBadges, badge.zodiac)
      activeZodiacs.add(badge.zodiac)
      if (resolved && badge.zodiac !== resolved) {
        wrongActiveZodiac.push(sampleUser(user, resolved, `当前有效持有${badge.name}，但当前生日解析为${resolved}`, { badge: badge.name, source: row.sourceType }))
        if (row.sourceType === 'AUTO_RULE') staleBirthdayMismatch.push(sampleUser(user, resolved, '自动规则来源与当前生日解析不一致，疑似使用过旧生日', { badge: badge.name, source: row.sourceType }))
      }
    }
    if (activeZodiacs.size > 1) {
      multipleActiveZodiacs.push(sampleUser(user, resolved, `当前同时有效持有 ${[...activeZodiacs].join('、')} 多个互斥星座`, { source: 'ACTIVE' }))
    }
    if (resolved) {
      const correctBadgeIds = new Set(zodiacBadges.filter((badge) => badge.zodiac === resolved).map((badge) => badge.id))
      if (!correctBadgeIds.size) {
        increment(usersWithoutConfiguredZodiacBadge, resolved)
      } else if (!active.some((row) => correctBadgeIds.has(row.badgeId))) {
        const revokedCorrect = rows.find((row) => correctBadgeIds.has(row.badgeId) && row.status === 'REVOKED')
        if (revokedCorrect) {
          const badge = badgeById.get(revokedCorrect.badgeId)
          incorrectlyRevoked.push(sampleUser(user, resolved, `正确的${badge?.name || resolved}历史记录已被收回`, { badge: badge?.name, source: revokedCorrect.sourceType }))
        } else {
          missingCorrectZodiac.push(sampleUser(user, resolved, `当前没有有效的${resolved}星座勋章`))
        }
      }
    }

    // This audit deliberately evaluates each target zodiac independently. A
    // revoked/active badge from another sign is recorded as context only and
    // can never become a blocking reason for the current target.
    if (resolved && currentPeriodZodiac === resolved) {
      const target = targetAudit[resolved]
      const targetBadges = zodiacBadges.filter((badge) => badge.zodiac === resolved)
      const targetBadgeIds = new Set(targetBadges.map((badge) => badge.id))
      const targetRows = rows.filter((row) => targetBadgeIds.has(row.badgeId))
      target.totalUsersInCurrentPeriod += 1
      const eligibilities = targetBadges.map((badge) => resolveZodiacBadgeGrantEligibility({
        badgeId: badge.id,
        birthMonth: user.birthMonth,
        birthDay: user.birthDay,
        targetZodiac: resolved,
        history: targetRows,
        now,
      }))
      if (eligibilities.some((eligibility) => eligibility.hasActiveTargetOwnership)) {
        target.activeOwnership += 1
      } else {
        target.missingOwnership += 1
        const hasOtherZodiacHistory = rows.some((row) => {
          const badge = badgeById.get(row.badgeId)
          return Boolean(badge && badge.zodiac !== resolved)
        })
        if (hasOtherZodiacHistory) target.otherZodiacHistoryPresent += 1
        if (eligibilities.length > 0 && eligibilities.every((eligibility) => eligibility.hasBlockedTargetHistory)) {
          target.blockedByTargetRevoke += 1
        } else if (eligibilities.some((eligibility) => eligibility.eligible)) {
          target.missingButEligible += 1
          if (target.samples.length < 20) target.samples.push(sampleUser(user, resolved, `当前没有有效的${resolved}目标勋章`, { source: hasOtherZodiacHistory ? 'OTHER_ZODIAC_HISTORY_PRESENT' : null }))
        } else target.unknown += 1
      }
    }
  }

  const crossZodiacBlockCount = ZODIAC_SIGNS.reduce((total, zodiac) => total + targetAudit[zodiac].blockedByOtherZodiacHistory, 0)
  const virgoAudit = targetAudit.VIRGO

  return {
    mode: 'read-only' as const,
    totalUsersWithBirthday: users.length,
    zodiacDistribution: Object.fromEntries([...zodiacDistribution.entries()]),
    usersWithoutConfiguredZodiacBadge: Object.fromEntries([...usersWithoutConfiguredZodiacBadge.entries()]),
    currentActiveZodiacBadges: Object.fromEntries([...currentActiveZodiacBadges.entries()]),
    missingCorrectZodiac: { count: missingCorrectZodiac.length, samples: missingCorrectZodiac.slice(0, 20) },
    wrongActiveZodiac: { count: wrongActiveZodiac.length, samples: wrongActiveZodiac.slice(0, 20) },
    multipleActiveZodiacs: { count: multipleActiveZodiacs.length, samples: multipleActiveZodiacs.slice(0, 20) },
    incorrectlyRevoked: { count: incorrectlyRevoked.length, samples: incorrectlyRevoked.slice(0, 20) },
    falseRevokeCount: incorrectlyRevoked.length,
    staleBirthdayMismatch: { count: staleBirthdayMismatch.length, samples: staleBirthdayMismatch.slice(0, 20) },
    currentPeriodZodiac,
    virgoMissingGrantAudit: {
      totalUsersBirthdayResolvesVirgo: zodiacDistribution.get('VIRGO') || 0,
      activeVirgoOwnership: virgoAudit.activeOwnership,
      missingVirgoOwnership: virgoAudit.missingOwnership,
      missingButEligible: virgoAudit.missingButEligible,
      blockedByOtherZodiacHistory: virgoAudit.blockedByOtherZodiacHistory,
      blockedByLeoHistory: 0,
      blockedByIdempotency: virgoAudit.blockedByIdempotency,
      blockedByTargetVirgoRevoke: virgoAudit.blockedByTargetRevoke,
      unknown: virgoAudit.unknown,
      samples: virgoAudit.samples,
    },
    crossZodiacAudit: {
      crossZodiacBlockCount,
      byTarget: targetAudit,
    },
    productionDataMutated: false,
    note: '只读审计；未执行 grant、revoke、update、delete 或 migration。'
  }
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('该审计脚本只允许 dry-run，不支持写入参数')
  const prisma = appPrisma as unknown as ReadonlyAuditPrisma
  try {
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE', isDeleted: false, OR: [{ birthMonth: { not: null } }, { birthDay: { not: null } }] },
      orderBy: { id: 'asc' },
      select: { id: true, uid: true, createdAt: true, birthMonth: true, birthDay: true },
    })
    const badges = await prisma.badge.findMany({
      where: { grantType: 'AUTO', isEnabled: true, isActive: true, BadgeRule: { is: { isEnabled: true, ruleType: 'BIRTHDAY_ZODIAC' } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, slug: true, BadgeRule: { select: { id: true, configJson: true } } },
    })
    const userBadges = users.length && badges.length
      ? await prisma.userBadge.findMany({
          where: { userId: { in: users.map((user) => user.id) }, badgeId: { in: badges.map((badge) => badge.id) } },
          select: { userId: true, badgeId: true, status: true, awardedAt: true, expiresAt: true, revokedAt: true, revokeReason: true, sourceType: true, sourceId: true },
        })
      : []
    console.info(JSON.stringify(buildBirthdayZodiacAuditReport(users, badges, userBadges), null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && process.argv[1].endsWith('audit-birthday-zodiac-badges.ts')) {
  main().catch((error) => {
    console.error('[audit-birthday-zodiac-badges] failed', error)
    process.exitCode = 1
  })
}
