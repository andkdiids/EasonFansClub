import { prisma } from '../lib/prisma'
import {
  evaluateAspirinConsultationFacts,
  type AspirinRuleRecord,
} from '../lib/aspirin-badge'
import type { AspirinConsultationFact } from '../lib/aspirin-consultation'
import { currentUserBadgeWhere } from '../lib/badge-validity'

const BATCH_SIZE = 1000

type RuleRow = AspirinRuleRecord & {
  Badge: { id: string; name: string; slug: string }
}

type FactRow = AspirinConsultationFact & {
  record: AspirinConsultationFact['record']
}

type OwnershipRow = {
  userId: string
  sourceId: string | null
  UserBadge: { status: 'ACTIVE' | 'GRAYED'; lastQualifiedAt: Date | null }
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '阿士匹灵 dry-run 失败'
  return message.replace(/mysql:\/\/[^\s]+/gi, 'mysql://[redacted]')
}

async function loadConsultationFacts() {
  const facts: FactRow[] = []
  let cursor: string | undefined
  while (true) {
    const page = await prisma.clinicConsultation.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        record: { category: 'ASK_DOCTORS' },
      },
      orderBy: [{ id: 'asc' }],
      take: BATCH_SIZE,
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
    facts.push(...(page as FactRow[]))
    if (page.length < BATCH_SIZE) break
    cursor = page[page.length - 1]?.id
    if (!cursor) break
  }
  return facts
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('该审计脚本只允许 dry-run，不支持写入参数')
  const now = new Date()
  try {
    const rules = await prisma.badgeRule.findMany({
      where: {
        ruleType: 'CLINIC_CONSULTATION_STREAK',
        isEnabled: true,
        Badge: { isEnabled: true, isActive: true, grantType: 'AUTO' },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        badgeId: true,
        ruleType: true,
        threshold: true,
        secondaryThreshold: true,
        configJson: true,
        isEnabled: true,
        sustainedQualification: true,
        inactiveAfterDays: true,
        revokeAfterDays: true,
        Badge: { select: { id: true, name: true, slug: true } },
      },
    }) as RuleRow[]
    const facts = await loadConsultationFacts()
    const factsByUser = new Map<string, FactRow[]>()
    for (const fact of facts) {
      const rows = factsByUser.get(fact.authorId) || []
      rows.push(fact)
      factsByUser.set(fact.authorId, rows)
    }

    const ownership = await prisma.userBadge.findMany({
      where: {
        ...currentUserBadgeWhere(now),
        UserBadgeSource: { some: { sourceType: 'AUTO_RULE', sourceId: { in: rules.map((rule) => rule.id) }, isActive: true } },
      },
      select: {
        userId: true,
        status: true,
        lastQualifiedAt: true,
        UserBadgeSource: { where: { sourceType: 'AUTO_RULE', sourceId: { in: rules.map((rule) => rule.id) }, isActive: true }, select: { sourceId: true } },
      },
    })
    const ownershipRows: OwnershipRow[] = ownership.flatMap((row) => row.UserBadgeSource.map((source) => ({
      userId: row.userId,
      sourceId: source.sourceId,
      UserBadge: { status: row.status as 'ACTIVE' | 'GRAYED', lastQualifiedAt: row.lastQualifiedAt },
    })))
    const ownershipByKey = new Map(ownershipRows.map((row) => [`${row.userId}:${row.sourceId}`, row]))
    const candidateUserIds = new Set<string>([
      ...factsByUser.keys(),
      ...ownershipRows.map((row) => row.userId),
    ])

    let usersScanned = 0
    let currentlyQualified = 0
    let initialStreakComplete = 0
    let currentActive = 0
    let currentGrayed = 0
    let needRegrant = 0
    let currentlyNotQualified = 0
    let invalidConfig = 0
    const perRule = rules.map((rule) => ({
      badge: rule.Badge.name,
      ruleId: rule.id,
      users: 0,
      qualifiedToday: 0,
      initialStreakComplete: 0,
      active: 0,
      grayed: 0,
      needRegrant: 0,
      notQualified: 0,
      invalidConfig: 0,
    }))

    for (const rule of rules) {
      const ruleSummary = perRule.find((item) => item.ruleId === rule.id)!
      for (const userId of candidateUserIds) {
        const userFacts = factsByUser.get(userId) || []
        const current = ownershipByKey.get(`${userId}:${rule.id}`)
        if (!userFacts.length && !current) continue
        usersScanned += 1
        ruleSummary.users += 1
        const evaluation = evaluateAspirinConsultationFacts({ userId, rule, facts: userFacts, now })
        if (!evaluation.config) {
          invalidConfig += 1
          ruleSummary.invalidConfig += 1
          continue
        }
        if (evaluation.qualifiedToday) {
          currentlyQualified += 1
          ruleSummary.qualifiedToday += 1
        } else {
          currentlyNotQualified += 1
          ruleSummary.notQualified += 1
        }
        if (evaluation.qualifiedToday && evaluation.currentStreakDays >= evaluation.initialStreakDays) {
          initialStreakComplete += 1
          ruleSummary.initialStreakComplete += 1
        }
        if (current?.UserBadge.status === 'ACTIVE') {
          currentActive += 1
          ruleSummary.active += 1
        } else if (current?.UserBadge.status === 'GRAYED') {
          currentGrayed += 1
          ruleSummary.grayed += 1
        }
        if (!current && evaluation.qualifiedToday && evaluation.currentStreakDays >= evaluation.initialStreakDays) {
          needRegrant += 1
          ruleSummary.needRegrant += 1
        }
      }
    }

    console.info(JSON.stringify({
      mode: 'read-only',
      generatedAt: now.toISOString(),
      ruleCount: rules.length,
      rules: perRule,
      usersScanned,
      currentlyQualified,
      currentlyNotQualified,
      initialStreakComplete,
      currentActive,
      currentGrayed,
      needRegrant,
      invalidConfig,
      productionDataMutated: false,
      note: '只读 dry-run；未执行 grant、revoke、gray、restore、update、delete 或 migration。',
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && process.argv[1].endsWith('audit-aspirin-badges.ts')) {
  main().catch((error) => {
    console.error('[audit-aspirin-badges] failed', safeErrorMessage(error))
    process.exitCode = 1
  })
}
