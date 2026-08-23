import { Prisma } from '@prisma/client'
import { getShanghaiDayRange } from '@/lib/checkin'
import { DUEL_REWARD_BUSINESS_KEY_PREFIX } from '@/lib/guess-song-duel-reward'
import { prisma } from '@/lib/prisma'

type RewardLedgerRow = {
  id: string
  userId: string
  points: number
  reason: string | null
  createdAt: Date
  dateKey: string | null
  businessKey: string | null
}

type RawDuelMatch = {
  id: string
  roomId: string
  winnerId: string | null
  isDraw: boolean | number
  isSuspicious: boolean | number
  rewardAmount: number
  finishedAt: Date | null
  rewardGranted?: boolean | number | null
  rewardReason?: string | null
  rewardedAt?: Date | null
}

type DuelPlayerRow = { matchId: string; userId: string; suspicious: boolean | number }

function parseDays(argv: string[]) {
  const value = argv.find((arg) => arg.startsWith('--days='))?.slice('--days='.length)
  if (!value) return 30
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('--days must be an integer between 1 and 3650')
  return days
}

function printHelp() {
  console.log('Read-only Guess Song Duel reward audit')
  console.log('Usage: pnpm exec tsx scripts/audit-guess-song-duel-rewards.ts [--days=30]')
  console.log('The script only performs SELECT queries and never repairs or awards historical rewards.')
}

function matchIdFromBusinessKey(value: string | null) {
  return value?.startsWith(DUEL_REWARD_BUSINESS_KEY_PREFIX)
    ? value.slice(DUEL_REWARD_BUSINESS_KEY_PREFIX.length)
    : null
}

function legacyBusinessKey(userId: string, dateKey: string) {
  return `guess-song-duel-reward:${userId}:${dateKey}`
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp()
    return
  }

  const days = parseDays(process.argv.slice(2))
  const now = new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const columns = await prisma.$queryRaw<Array<{ COLUMN_NAME: string }>>`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'GuessSongDuelMatch'
      AND COLUMN_NAME IN ('rewardGranted', 'rewardReason', 'rewardedAt')
  `
  const columnNames = new Set(columns.map((column) => column.COLUMN_NAME))
  const hasRewardSnapshot = ['rewardGranted', 'rewardReason', 'rewardedAt'].every((column) => columnNames.has(column))
  const rewardFields = hasRewardSnapshot
    ? Prisma.sql`, rewardGranted, rewardReason, rewardedAt`
    : Prisma.empty
  const rawMatches = await prisma.$queryRaw<RawDuelMatch[]>(Prisma.sql`
    SELECT id, roomId, winnerId, isDraw, isSuspicious, rewardAmount, finishedAt
      ${rewardFields}
    FROM GuessSongDuelMatch
    WHERE status = 'FINISHED' AND finishedAt >= ${cutoff}
    ORDER BY finishedAt ASC
  `)
  const matchIds = rawMatches.map((match) => match.id)
  const players = matchIds.length
    ? await prisma.$queryRaw<DuelPlayerRow[]>(Prisma.sql`
        SELECT matchId, userId, suspicious
        FROM GuessSongDuelPlayer
        WHERE matchId IN (${Prisma.join(matchIds)})
      `)
    : []
  const playersByMatch = new Map<string, DuelPlayerRow[]>()
  for (const player of players) playersByMatch.set(player.matchId, [...(playersByMatch.get(player.matchId) || []), player])
  const matches = rawMatches.map((match) => ({
    ...match,
    isDraw: Boolean(match.isDraw),
    isSuspicious: Boolean(match.isSuspicious),
    rewardGranted: hasRewardSnapshot ? Boolean(match.rewardGranted) : false,
    rewardReason: hasRewardSnapshot ? match.rewardReason || 'NOT_APPLICABLE' : (match.rewardAmount > 0 ? 'LEGACY_UNVERIFIED' : 'NOT_APPLICABLE'),
    rewardedAt: hasRewardSnapshot ? match.rewardedAt || null : null,
    GuessSongDuelPlayer: playersByMatch.get(match.id) || [],
  }))
  const ledgers = await prisma.$queryRaw<RewardLedgerRow[]>(Prisma.sql`
    SELECT id, userId, points, reason, createdAt, dateKey, businessKey
    FROM PointLog
    WHERE action = 'GUESS_SONG_DUEL_WIN' AND points > 0 AND createdAt >= ${cutoff}
    ORDER BY createdAt ASC
  `)

  const rewardLedgers = ledgers as RewardLedgerRow[]
  const exactByMatch = new Map<string, RewardLedgerRow[]>()
  for (const ledger of rewardLedgers) {
    const matchId = matchIdFromBusinessKey(ledger.businessKey)
    if (!matchId) continue
    const rows = exactByMatch.get(matchId) || []
    rows.push(ledger)
    exactByMatch.set(matchId, rows)
  }

  const eligibleMatches = matches.filter((match) => {
    if (!match.winnerId || match.isDraw) return false
    const winner = match.GuessSongDuelPlayer.find((player) => player.userId === match.winnerId)
    return Boolean(winner && !winner.suspicious)
  })
  const matchesWithLedger = eligibleMatches.filter((match) => exactByMatch.has(match.id))
  const matchesWithoutLedger = eligibleMatches.filter((match) => !exactByMatch.has(match.id))
  const suspectedBalanceWithoutLedger = matchesWithoutLedger.filter((match) => match.rewardAmount > 0 || match.rewardGranted)

  const approximateMatches = matchesWithoutLedger.flatMap((match) => {
    if (!match.winnerId || !match.finishedAt) return []
    const { dateKey } = getShanghaiDayRange(match.finishedAt)
    const exactLegacy = rewardLedgers.find((ledger) => ledger.userId === match.winnerId && ledger.dateKey === dateKey && ledger.businessKey === legacyBusinessKey(match.winnerId as string, dateKey))
    const sameUserSameDay = rewardLedgers.find((ledger) => ledger.userId === match.winnerId && ledger.dateKey === dateKey)
    return [{
      matchId: match.id,
      userId: match.winnerId,
      dateKey,
      exactLegacyBusinessKeyMatch: Boolean(exactLegacy),
      approximateLedgerId: (exactLegacy || sameUserSameDay)?.id || null,
      limitation: exactLegacy ? 'legacy businessKey identifies the user/day, not this Match' : 'same user/day +7 record cannot be linked to one Match with certainty',
    }]
  })
  const approximateByMatch = new Map(approximateMatches.map((item) => [item.matchId, item]))
  const matchesWithLegacyApproximateLedger = approximateMatches.filter((item) => item.exactLegacyBusinessKeyMatch)
  const matchesWithAnyApproximateLedger = approximateMatches.filter((item) => Boolean(item.approximateLedgerId))
  const suspectedWithoutAnyApproximateLedger = suspectedBalanceWithoutLedger.filter((match) => !approximateByMatch.get(match.id)?.approximateLedgerId)

  const duplicateExactMatchGroups = [...exactByMatch.entries()].filter(([, rows]) => rows.length > 1)
  const byUserDay = new Map<string, RewardLedgerRow[]>()
  for (const ledger of rewardLedgers) {
    const dateKey = ledger.dateKey || getShanghaiDayRange(ledger.createdAt).dateKey
    const key = `${ledger.userId}:${dateKey}`
    const rows = byUserDay.get(key) || []
    rows.push(ledger)
    byUserDay.set(key, rows)
  }
  const duplicateUserDayGroups = [...byUserDay.entries()].filter(([, rows]) => rows.length > 1)
  const matchedIds = new Set(matches.map((match) => match.id))
  const ledgerWithoutRecentMatch = rewardLedgers
    .map((ledger) => ({ ledger, matchId: matchIdFromBusinessKey(ledger.businessKey) }))
    .filter((item): item is { ledger: RewardLedgerRow; matchId: string } => item.matchId !== null && !matchedIds.has(item.matchId))

  console.log(JSON.stringify({
    readOnly: true,
    generatedAt: now.toISOString(),
    businessTimezone: 'Asia/Shanghai',
    schemaCapabilities: { matchRewardSnapshotColumns: hasRewardSnapshot, mode: hasRewardSnapshot ? 'persisted-reward-state' : 'legacy-approximation' },
    window: { days, cutoff: cutoff.toISOString() },
    counts: {
      finishedMatches: matches.length,
      finishedMatchesWithWinner: matches.filter((match) => Boolean(match.winnerId)).length,
      eligibleWinnerMatches: eligibleMatches.length,
      matchesWithExactRewardLedger: matchesWithLedger.length,
      matchesWithoutExactRewardLedger: matchesWithoutLedger.length,
      matchesWithLegacyApproximateLedger: matchesWithLegacyApproximateLedger.length,
      matchesWithAnyApproximateLedger: matchesWithAnyApproximateLedger.length,
      suspectedBalanceWithoutExactLedger: suspectedBalanceWithoutLedger.length,
      suspectedBalanceWithoutAnyApproximateLedger: suspectedWithoutAnyApproximateLedger.length,
      rewardLedgerRows: rewardLedgers.length,
      duplicateRewardLedgersForExactMatch: duplicateExactMatchGroups.length,
      usersWithMultipleDuelRewardRowsSameShanghaiDay: duplicateUserDayGroups.length,
      exactRewardLedgersWithoutRecentMatch: ledgerWithoutRecentMatch.length,
    },
    samples: {
      suspectedBalanceWithoutExactLedger: suspectedBalanceWithoutLedger.slice(0, 50).map((match) => ({
        matchId: match.id,
        roomId: match.roomId,
        winnerId: match.winnerId,
        rewardAmount: match.rewardAmount,
        rewardGranted: match.rewardGranted,
        rewardReason: match.rewardReason,
        finishedAt: match.finishedAt?.toISOString() || null,
      })),
      approximateLegacyLinks: approximateMatches.slice(0, 50),
      duplicateRewardLedgersForExactMatch: duplicateExactMatchGroups.slice(0, 50).map(([matchId, rows]) => ({ matchId, ledgerIds: rows.map((row) => row.id) })),
      usersWithMultipleDuelRewardRowsSameShanghaiDay: duplicateUserDayGroups.slice(0, 50).map(([key, rows]) => ({ key, ledgerIds: rows.map((row) => row.id) })),
      exactRewardLedgersWithoutRecentMatch: ledgerWithoutRecentMatch.slice(0, 50).map(({ ledger, matchId }) => ({ matchId, ledgerId: ledger.id, userId: ledger.userId, createdAt: ledger.createdAt.toISOString() })),
    },
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('[audit-guess-song-duel-rewards]', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
