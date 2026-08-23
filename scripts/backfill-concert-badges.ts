import { getBadgeAvailability } from '@/lib/badge-phase2'
import {
  evaluateConcertBadges,
  loadConcertBadgeDefinitions,
  planConcertBadgeAwards,
  type ConcertAttendanceFact,
} from '@/lib/concert-badge'
import { prisma } from '@/lib/prisma'

const BATCH_SIZE = 200

type Scope = { mode: 'all' } | { mode: 'user'; value: string }

function parseArguments(argv: readonly string[]) {
  const apply = argv.includes('--apply')
  const explicitDryRun = argv.includes('--dry-run')
  const all = argv.includes('--all')
  const userArgument = argv.find((argument) => argument.startsWith('--user='))
  if (apply && explicitDryRun) throw new Error('--apply 与 --dry-run 不能同时使用')
  if (apply && Number(all) + Number(Boolean(userArgument)) !== 1) throw new Error('正式补发必须明确指定 --all 或 --user=<UID或userId>')
  if (!apply && all && userArgument) throw new Error('--all 与 --user 不能同时使用')
  const scope: Scope = userArgument
    ? { mode: 'user', value: userArgument.slice('--user='.length).trim() }
    : { mode: 'all' }
  if (scope.mode === 'user' && !scope.value) throw new Error('--user 缺少 UID 或 userId')
  return { apply, dryRun: !apply, scope }
}

function userWhere(scope: Scope) {
  const base = { status: 'ACTIVE' as const, isDeleted: false, UserMusicConcert: { some: {} } }
  if (scope.mode === 'all') return base
  const uid = Number(scope.value)
  return {
    ...base,
    OR: [
      { id: scope.value },
      ...(Number.isSafeInteger(uid) && uid > 0 ? [{ uid }] : []),
    ],
  }
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7)
}

function minDate(left: Date | null, right: Date) {
  return !left || right < left ? right : left
}

function maxDate(left: Date | null, right: Date) {
  return !left || right > left ? right : left
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  console.log(options.dryRun
    ? '===== CONCERT BADGE AUDIT: READ-ONLY DRY RUN ====='
    : '===== CONCERT BADGE BACKFILL: APPLY MODE =====')
  if (options.dryRun) console.log('Dry-run path contains no grant/update/create/delete calls.')

  const [definitions, inventory, totalUsers] = await Promise.all([
    loadConcertBadgeDefinitions(),
    prisma.badge.findMany({
      where: {
        OR: [
          { category: 'CONCERT', musicTourId: { not: null } },
          {
            BadgeRule: {
              is: {
                ruleType: {
                  in: ['CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED'],
                },
              },
            },
          },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        code: true,
        slug: true,
        name: true,
        category: true,
        musicTourId: true,
        isEnabled: true,
        isActive: true,
        createdAt: true,
        availableFrom: true,
        availableUntil: true,
        BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, isEnabled: true } },
        musicTour: { select: { name: true } },
      },
    }),
    prisma.user.count({ where: userWhere(options.scope) }),
  ])

  console.log('\n===== CONCERT BADGE RULES =====')
  for (const badge of inventory) {
    const structuredRule = badge.BadgeRule && [
      'CONCERT_ATTENDANCE_COUNT',
      'CONCERT_SHOW_ATTENDED',
      'CONCERT_TOUR_ATTENDED',
    ].includes(badge.BadgeRule.ruleType) ? badge.BadgeRule : null
    const condition = structuredRule
      ? `${structuredRule.ruleType} ${structuredRule.operator}${structuredRule.threshold === null ? '' : ` ${structuredRule.threshold}`}`
      : `ATTENDED_TOUR ${badge.musicTour?.name || 'UNKNOWN'} (${badge.musicTourId || 'INVALID_NULL'})`
    console.log(`${badge.code} | slug=${badge.slug} | ${badge.name} | ${condition} | enabled=${badge.isEnabled && badge.isActive && (structuredRule?.isEnabled ?? true)} | availability=${getBadgeAvailability(badge)} | createdAt=${badge.createdAt.toISOString()}`)
  }

  const inventoryBadgeIds = inventory.map((badge) => badge.id)
  const missingUsers = new Set<string>()
  const usersWithAnyConcertBadge = new Set<string>()
  const inventoryById = new Map(inventory.map((badge) => [badge.id, badge]))
  const missingByBadge = new Map(definitions.map((badge) => [badge.id, {
    badge,
    count: 0,
    earliest: null as Date | null,
    latest: null as Date | null,
    beforeBadgeCreated: 0,
    afterBadgeCreated: 0,
  }]))
  const missingUserFirstRecordMonth = new Map<string, number>()
  let earliestMissingRecord: Date | null = null
  let latestMissingRecord: Date | null = null
  let cursor: string | undefined
  let applied = 0
  let alreadyOwned = 0
  let failed = 0

  while (true) {
    const users = await prisma.user.findMany({
      where: { ...userWhere(options.scope), ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    })
    if (!users.length) break
    const userIds = users.map((user) => user.id)
    const [attendanceRows, ownedRows] = await Promise.all([
      prisma.userMusicConcert.findMany({
        where: { userId: { in: userIds } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { userId: true, concertId: true, createdAt: true, MusicConcert: { select: { tourId: true } } },
      }),
      inventoryBadgeIds.length
        ? prisma.userBadge.findMany({ where: { userId: { in: userIds }, badgeId: { in: inventoryBadgeIds } }, select: { userId: true, badgeId: true } })
        : Promise.resolve([]),
    ])
    const factsByUser = new Map<string, ConcertAttendanceFact[]>()
    for (const row of attendanceRows) {
      const facts = factsByUser.get(row.userId) || []
      facts.push({ concertId: row.concertId, tourId: row.MusicConcert.tourId, createdAt: row.createdAt })
      factsByUser.set(row.userId, facts)
    }
    const ownedByUser = new Map<string, Set<string>>()
    for (const row of ownedRows) {
      usersWithAnyConcertBadge.add(row.userId)
      const owned = ownedByUser.get(row.userId) || new Set<string>()
      owned.add(row.badgeId)
      ownedByUser.set(row.userId, owned)
    }

    for (const user of users) {
      const facts = factsByUser.get(user.id) || []
      const awards = planConcertBadgeAwards({ attendances: facts, badges: definitions, ownedBadgeIds: ownedByUser.get(user.id) })
      if (awards.length) {
        missingUsers.add(user.id)
        const first = facts[0]?.createdAt
        const last = facts.at(-1)?.createdAt
        if (first) {
          earliestMissingRecord = minDate(earliestMissingRecord, first)
          missingUserFirstRecordMonth.set(monthKey(first), (missingUserFirstRecordMonth.get(monthKey(first)) || 0) + 1)
        }
        if (last) latestMissingRecord = maxDate(latestMissingRecord, last)
        for (const award of awards) {
          const item = missingByBadge.get(award.badge.id)
          if (item) {
            item.count += 1
            item.earliest = minDate(item.earliest, award.obtainedAt)
            item.latest = maxDate(item.latest, award.obtainedAt)
            const badgeCreatedAt = inventoryById.get(award.badge.id)?.createdAt
            if (badgeCreatedAt && award.obtainedAt < badgeCreatedAt) item.beforeBadgeCreated += 1
            else item.afterBadgeCreated += 1
          }
        }
      }

      if (options.apply) {
        const result = await evaluateConcertBadges(user.id)
        applied += result.granted
        alreadyOwned += result.alreadyOwned
        failed += result.failed
      }
    }

    cursor = users.at(-1)?.id
    if (users.length < BATCH_SIZE || options.scope.mode === 'user') break
  }

  console.log('\n===== AUDIT SUMMARY =====')
  console.log(`Users with My Live records: ${totalUsers}`)
  console.log(`Users owning at least one concert badge: ${usersWithAnyConcertBadge.size}`)
  console.log(`Eligible users missing at least one concert badge: ${missingUsers.size}`)
  console.log(`Total missing concert badge awards: ${[...missingByBadge.values()].reduce((total, item) => total + item.count, 0)}`)
  console.log(`Missing-record range: ${earliestMissingRecord?.toISOString() || 'N/A'} .. ${latestMissingRecord?.toISOString() || 'N/A'}`)
  console.log('\nMissing awards by badge:')
  for (const { badge, count, earliest, latest, beforeBadgeCreated, afterBadgeCreated } of missingByBadge.values()) {
    console.log(`${badge.code} | slug=${badge.slug} | missing=${count} | achievementRange=${earliest?.toISOString() || 'N/A'}..${latest?.toISOString() || 'N/A'} | beforeBadgeCreated=${beforeBadgeCreated} | afterBadgeCreated=${afterBadgeCreated}`)
  }
  console.log('\nMissing users by first My Live record month:')
  for (const [month, count] of [...missingUserFirstRecordMonth].sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`${month}: ${count}`)
  }
  if (options.apply) console.log(`\nApplied grants=${applied}, alreadyOwned=${alreadyOwned}, failed=${failed}`)
  else console.log('\nNo database writes were performed.')
}

main()
  .catch((error) => {
    console.error('[concert-badge-backfill]', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
