/**
 * Leaderboard automatic reward settlement engine.
 *
 * Safety model (mirrors the shun-master ledger):
 *  - A LeaderboardSettlementRun row is the durable idempotency gate. Creating it
 *    is guarded by a unique (kind, periodKey); processing is a state machine
 *    claiming PENDING -> PROCESSING with a conditional update.
 *  - Every wallet payout uses awardRegistrationFee(tx) with a stable businessKey
 *    and a FOR UPDATE row lock, so repeated / parallel runs never double pay.
 *  - The 270 weekly cap is computed and persisted in the SAME transaction as the
 *    payout, using a locked LeaderboardWeeklyCapUsage row.
 *  - Badge grants use grantBadgeWithTransaction with a stable grantKey; the
 *    badge system's unique keys are the final dedup guard.
 *  - Notifications use a deterministic key and upsert, so no duplicates.
 *  - A period that starts before config.enabledAt is never auto-settled: this
 *    is the first-launch historical protection.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { grantBadgeWithTransaction } from '@/lib/badge-service'
import { currentUserBadgeWhere } from '@/lib/badge-validity'
import { upsertNotificationWithDb } from '@/lib/notification-write'
import {
  rankReward,
  type LeaderboardRewardsConfig,
  type LeaderboardRewardCategory,
} from '@/lib/leaderboard-rewards-config'
import {
  resolveSettlementPeriod,
  isPeriodAllowed,
  periodLabel,
  beijingDayStart,
  type SettlementKind,
  type SettlementPeriod,
} from '@/lib/leaderboard-rewards-period'
import {
  getEntertainmentCandidates,
  getDashboardCandidates,
  type BoardCandidates,
} from '@/lib/leaderboard-rewards-sources'

/**
 * Injectable candidate source. Production uses the authoritative ranking
 * services; isolated-MySQL tests inject deterministic boards. This is the only
 * seam — all money / cap / badge / notification logic below stays identical.
 */
export type CandidatesProvider = {
  entertainment(period: SettlementPeriod, now: Date): Promise<BoardCandidates[]>
  dashboard(period: SettlementPeriod): Promise<{ comment: BoardCandidates; aspirin: BoardCandidates }>
}
const defaultCandidatesProvider: CandidatesProvider = {
  entertainment: getEntertainmentCandidates,
  dashboard: getDashboardCandidates,
}
import {
  decideCap,
  resolveBadgeAwards,
  rewardBusinessKey,
  badgeGrantKey,
  rewardNotificationKey,
} from '@/lib/leaderboard-rewards-rules'

export type SettlementSummary = {
  periodKey: string
  kind: SettlementKind
  boards: number
  candidates: number
  walletGrants: number
  walletPoints: number
  clippedGrants: number
  clippedPoints: number
  badgeGrants: number
  notifications: number
}

type Tx = Prisma.TransactionClient

const STATUS = {
  pending: 'PENDING',
  processing: 'PROCESSING',
  completed: 'COMPLETED',
  failed: 'FAILED',
} as const

/**
 * Ensure a run row exists for (kind, period) with an immutable config snapshot.
 * Returns the row. Unique violation on a concurrent create is treated as the
 * row already existing (idempotent).
 */
async function ensureRun(
  kind: SettlementKind,
  period: SettlementPeriod,
  config: LeaderboardRewardsConfig,
  db: typeof prisma | Tx = prisma,
) {
  const snapshot = { period: period.periodKey, config } as unknown as Prisma.InputJsonValue
  // Prisma's upsert is SELECT-then-INSERT on MySQL and races under parallelism.
  // Use an atomic INSERT ... ON DUPLICATE KEY UPDATE so concurrent workers get
  // one row deterministically. The snapshot is never overwritten on conflict.
  const { randomUUID } = await import('node:crypto')
  await db.$executeRaw`
    INSERT INTO LeaderboardSettlementRun
      (id, kind, periodKey, status, attempts, configSnapshot, createdAt, updatedAt)
    VALUES
      (${randomUUID()}, ${kind}, ${period.periodKey}, ${STATUS.pending}, 0,
       ${JSON.stringify(snapshot)}, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE id = id
  `
  const row = await db.leaderboardSettlementRun.findUnique({
    where: { kind_periodKey: { kind, periodKey: period.periodKey } },
  })
  if (!row) throw new Error('SETTLEMENT_RUN_CREATE_FAILED')
  return row
}

/**
 * Atomically claim a PENDING/FAILED run for processing. FAILED is retryable by
 * design; COMPLETED is final (never re-paid). Returns true only for the winner.
 */
async function claimRun(runId: string, db: typeof prisma | Tx = prisma): Promise<boolean> {
  const claimed = await db.leaderboardSettlementRun.updateMany({
    where: { id: runId, status: { in: [STATUS.pending, STATUS.failed] } },
    data: { status: STATUS.processing, startedAt: new Date() },
  })
  return claimed.count === 1
}

/**
 * Read-and-lock the weekly cap row. Returns the current `used`. Creates the row
 * (0) if absent; the unique key makes concurrent creates safe.
 */
async function readCapForUpdate(
  tx: Tx,
  userId: string,
  category: LeaderboardRewardCategory,
  capPeriodKey: string,
): Promise<{ id: string; used: number }> {
  let row = await tx.leaderboardWeeklyCapUsage.findUnique({
    where: { userId_category_periodKey: { userId, category, periodKey: capPeriodKey } },
    select: { id: true, used: true },
  })
  if (!row) {
    try {
      row = await tx.leaderboardWeeklyCapUsage.create({
        data: { userId, category, periodKey: capPeriodKey, used: 0 },
        select: { id: true, used: true },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        row = await tx.leaderboardWeeklyCapUsage.findUnique({
          where: { userId_category_periodKey: { userId, category, periodKey: capPeriodKey } },
          select: { id: true, used: true },
        })
      }
      if (!row) throw error
    }
  }
  // Lock the row for the rest of this transaction so concurrent grants to the
  // same (user, category, week) serialize on the cap.
  await tx.$queryRaw`SELECT id FROM LeaderboardWeeklyCapUsage WHERE id = ${row.id} FOR UPDATE`
  const fresh = await tx.leaderboardWeeklyCapUsage.findUnique({
    where: { id: row.id },
    select: { used: true },
  })
  return { id: row.id, used: fresh?.used ?? row.used }
}

function payoutMeta(category: LeaderboardRewardCategory, period: SettlementPeriod, rank: number, boardLabel: string) {
  const label = periodLabel(period)
  return {
    reason: `排行榜自动奖励 · ${category} · ${label} · ${boardLabel} · 第${rank}名`,
    title: {
      entertainment: period.kind === 'weekly' ? '娱乐天空周榜奖励' : '娱乐天空月榜奖励',
      comment: 'E院广场评论榜奖励',
      aspirin: '阿士匹灵门诊部会诊榜奖励',
    }[category],
    content: (actual: number) =>
      period.kind === 'weekly'
        ? `恭喜你获得${boardLabel}${label}第 ${rank} 名，奖励 ${actual} 挂号费！`
        : `恭喜你获得${boardLabel}${label}第 ${rank} 名，额外奖励 ${actual} 挂号费！`,
  }
}

/** Pay one wallet reward + write its audit row + notification, atomically. */
async function payOne(
  tx: Tx,
  input: {
    runId: string
    period: SettlementPeriod
    kind: SettlementKind
    category: LeaderboardRewardCategory
    boardKey: string
    boardLabel: string
    candidate: { rank: number; userId: string }
    top3: number
    top4To10: number
    weeklyCap: number | null
    capPeriodKey: string
    now: Date
  },
): Promise<{ paid: number; clipped: number; notified: boolean }> {
  const { rank, userId } = input.candidate
  const original = rankReward(rank, input.top3, input.top4To10)
  if (original <= 0) return { paid: 0, clipped: 0, notified: false }

  const businessKey = rewardBusinessKey(input.kind, input.period.periodKey, input.category, input.boardKey, userId)

  // The audit row doubles as an idempotency gate independent of PointLog.
  const already = await tx.leaderboardRewardGrant.findUnique({ where: { businessKey } })
  if (already) return { paid: 0, clipped: 0, notified: false }

  let capDecision = decideCap(original, 0, input.weeklyCap ?? Number.MAX_SAFE_INTEGER)
  if (input.weeklyCap !== null) {
    const capRow = await readCapForUpdate(tx, userId, input.category, input.capPeriodKey)
    capDecision = decideCap(original, capRow.used, input.weeklyCap)
    if (capDecision.eligible) {
      await tx.leaderboardWeeklyCapUsage.update({ where: { id: capRow.id }, data: { used: capDecision.capUsedAfter } })
    }
  }

  const meta = payoutMeta(input.category, input.period, rank, input.boardLabel)

  if (capDecision.eligible) {
    const action = input.kind === 'weekly' ? 'LEADERBOARD_WEEKLY_REWARD' : 'LEADERBOARD_MONTHLY_REWARD'
    const posted = await awardRegistrationFee(tx, {
      userId,
      requestedAmount: capDecision.actualAmount,
      action,
      reason: meta.reason,
      now: input.now,
      businessKey,
    })
    if (posted.duplicate) {
      // Parallel writer already paid; do not write a second audit row.
      return { paid: 0, clipped: 0, notified: false }
    }
    await upsertNotificationWithDb(tx, {
      where: { recipientId_key: { recipientId: userId, key: rewardNotificationKey(businessKey) } },
      update: {},
      create: {
        recipientId: userId,
        type: 'SYSTEM',
        title: meta.title,
        content: meta.content(capDecision.actualAmount),
        link: '/leaderboard',
        key: rewardNotificationKey(businessKey),
        isRead: false,
      },
    }, { operation: 'leaderboard-rewards.notification', userId })
  }

  await tx.leaderboardRewardGrant.create({
    data: {
      businessKey,
      runId: input.runId,
      category: input.category,
      boardKey: input.boardKey,
      userId,
      rank,
      originalAmount: capDecision.originalAmount,
      capUsedBefore: capDecision.capUsedBefore,
      capUsedAfter: capDecision.capUsedAfter,
      actualAmount: capDecision.actualAmount,
      clippedAmount: capDecision.clippedAmount,
    },
  })
  return {
    paid: capDecision.actualAmount,
    clipped: capDecision.clippedAmount,
    notified: capDecision.eligible,
  }
}

/** Grant a badge with ownership dedup + notification, atomically. */
async function grantBadgeOne(
  tx: Tx,
  input: {
    runId: string
    period: SettlementPeriod
    badgeKey: 'thankYou' | 'kSongKing'
    badgeId: string
    boardKey: string
    award: { userId: string; rank: number }
    now: Date
  },
): Promise<boolean> {
  const key = badgeGrantKey(input.badgeKey, input.period.periodKey, input.boardKey, input.award.userId)
  const already = await tx.leaderboardBadgeGrant.findUnique({ where: { grantKey: key } })
  if (already) return false

  const badge = await tx.badge.findUnique({ where: { id: input.badgeId }, select: { name: true } })
  if (!badge) return false

  const result = await grantBadgeWithTransaction(tx, {
    userId: input.award.userId,
    badgeId: input.badgeId,
    sourceType: 'LEADERBOARD_REWARD',
    sourceId: `${input.period.periodKey}:${input.boardKey}`,
    grantKey: key,
    grantReason: `排行榜自动奖励 · ${input.badgeKey} · ${input.period.periodKey} · 第${input.award.rank}名`,
    actorId: null,
    obtainedAt: input.now,
  })
  if (!result.created && !result.sourceAttached) return false

  await tx.leaderboardBadgeGrant.create({
    data: {
      grantKey: key,
      runId: input.runId,
      badgeKey: input.badgeKey,
      badgeId: input.badgeId,
      boardKey: input.boardKey,
      userId: input.award.userId,
      rank: input.award.rank,
    },
  })
  const title = input.badgeKey === 'thankYou' ? '恭喜你获得『谢谢侬』勋章！' : '恭喜你获得『K歌之王』勋章！'
  await upsertNotificationWithDb(tx, {
    where: { recipientId_key: { recipientId: input.award.userId, key: `notify:${key}` } },
    update: {},
    create: {
      recipientId: input.award.userId,
      type: 'BADGE',
      title,
      content: `${badge.name} 已发放到你的勋章馆。`,
      link: '/badges',
      key: `notify:${key}`,
      isRead: false,
    },
  }, { operation: 'leaderboard-rewards.badge-notification', userId: input.award.userId })
  return true
}

/** Collect users that currently own a badge, for rollover dedup. */
async function ownedUserIds(tx: Tx, badgeId: string, now: Date): Promise<Set<string>> {
  const rows = await tx.userBadge.findMany({
    where: { badgeId, ...currentUserBadgeWhere(now) },
    select: { userId: true },
  })
  return new Set(rows.map((r) => r.userId))
}

/**
 * Run one settlement period end-to-end. Safe to call repeatedly and in
 * parallel: the run state machine and per-grant keys make re-entry a no-op.
 */
export async function runLeaderboardSettlement(input: {
  kind: SettlementKind
  config: LeaderboardRewardsConfig
  now?: Date
  /** Explicit period (used by controlled admin retry/backfill); defaults to the period ending at `now`. */
  periodOverride?: SettlementPeriod
  /** Admin-controlled backfill bypasses the go-live guard. Never used by cron/worker. */
  allowHistorical?: boolean
  /** Test seam for deterministic boards; production path uses authoritative services. */
  candidatesProvider?: CandidatesProvider
}): Promise<{ status: 'SKIPPED' | 'COMPLETED' | 'ALREADY' | 'FAILED'; runId?: string; reason?: string; summary?: SettlementSummary; periodKey?: string }> {
  const now = input.now ?? new Date()
  const period = input.periodOverride ?? resolveSettlementPeriod(input.kind, now)
  const config = input.config

  // First-settlement protection. An explicit per-kind boundary (when set) is
  // authoritative and allows the configured first cycle to settle even if it
  // began before go-live; anything earlier stays blocked. Without a boundary the
  // strict enabledAt full-cycle guard applies, so existing configs are unchanged.
  if (!input.allowHistorical && !isPeriodAllowed(period, config, config.enabledAt)) {
    return { status: 'SKIPPED', reason: 'PERIOD_BEFORE_GO_LIVE', periodKey: period.periodKey }
  }
  // Feature-category gate.
  if (input.kind === 'weekly' && !(config.entertainment.weeklyEnabled || config.comment.weeklyEnabled || config.aspirin.weeklyEnabled)) {
    return { status: 'SKIPPED', reason: 'WEEKLY_DISABLED', periodKey: period.periodKey }
  }
  if (input.kind === 'monthly' && !config.entertainment.monthlyEnabled && !config.entertainment.kSongKingEnabled) {
    return { status: 'SKIPPED', reason: 'MONTHLY_DISABLED', periodKey: period.periodKey }
  }

  const run = await ensureRun(input.kind, period, config)
  if (run.status === STATUS.completed) {
    return { status: 'ALREADY', runId: run.id, summary: (run.result as unknown as SettlementSummary) ?? undefined }
  }
  const claimed = await claimRun(run.id)
  if (!claimed) return { status: 'ALREADY', runId: run.id }

  const summary: SettlementSummary = {
    periodKey: period.periodKey,
    kind: input.kind,
    boards: 0,
    candidates: 0,
    walletGrants: 0,
    walletPoints: 0,
    clippedGrants: 0,
    clippedPoints: 0,
    badgeGrants: 0,
    notifications: 0,
  }

  try {
    // Read authoritative boards OUTSIDE the transaction (network/source reads).
    const provider = input.candidatesProvider ?? defaultCandidatesProvider
    const [entertainment, dashboard] = await Promise.all([
      input.kind === 'weekly' || input.kind === 'monthly'
        ? provider.entertainment(period, now)
        : Promise.resolve([] as BoardCandidates[]),
      input.kind === 'weekly' ? provider.dashboard(period) : Promise.resolve(null),
    ])

    const executeTx = async (tx: Tx, tallies: SettlementSummary) => {
      if (input.kind === 'weekly') {
        // THREE independent 270 caps: entertainment / comment / aspirin.
        if (config.entertainment.weeklyEnabled) {
          for (const board of entertainment) {
            for (const candidate of board.candidates) {
              const r = await payOne(tx, {
                runId: run.id, period, kind: 'weekly', category: 'entertainment',
                boardKey: board.boardKey, boardLabel: board.boardLabel, candidate,
                top3: config.entertainment.weeklyTop3, top4To10: config.entertainment.weeklyTop4To10,
                weeklyCap: config.entertainment.weeklyCap, capPeriodKey: period.startDateKey, now,
              })
              accumulate(tallies, r)
            }
          }
        }
        if (dashboard) {
          for (const [category, board] of [['comment', dashboard.comment], ['aspirin', dashboard.aspirin]] as const) {
            const cfg = config[category]
            if (!cfg.weeklyEnabled) continue
            for (const candidate of board.candidates) {
              const r = await payOne(tx, {
                runId: run.id, period, kind: 'weekly', category,
                boardKey: board.boardKey, boardLabel: board.boardLabel, candidate,
                top3: cfg.weeklyTop3, top4To10: cfg.weeklyTop4To10,
                weeklyCap: cfg.weeklyCap, capPeriodKey: period.startDateKey, now,
              })
              accumulate(tallies, r)
            }
          }
        }
        // 谢谢侬: top-3 of the comment board with rollover, cross-user dedup.
        if (config.comment.thankYouEnabled && config.comment.thankYouBadgeId && dashboard) {
          const owned = await ownedUserIds(tx, config.comment.thankYouBadgeId, now)
          const awards = resolveBadgeAwards([dashboard.comment], owned, 3)
          for (const award of awards) {
            const ok = await grantBadgeOne(tx, {
              runId: run.id, period, badgeKey: 'thankYou', badgeId: config.comment.thankYouBadgeId,
              boardKey: dashboard.comment.boardKey, award, now,
            })
            if (ok) tallies.badgeGrants += 1
          }
        }
      }

      if (input.kind === 'monthly') {
        // Monthly extra reward: INDEPENDENT, does NOT consume any weekly cap.
        if (config.entertainment.monthlyEnabled) {
          for (const board of entertainment) {
            for (const candidate of board.candidates) {
              const r = await payOne(tx, {
                runId: run.id, period, kind: 'monthly', category: 'entertainment',
                boardKey: board.boardKey, boardLabel: board.boardLabel, candidate,
                top3: config.entertainment.monthlyTop3, top4To10: config.entertainment.monthlyTop4To10,
                weeklyCap: null, capPeriodKey: '', now,
              })
              accumulate(tallies, r)
            }
          }
        }
        // K歌之王: every board's top 3 with rollover + cross-board dedup.
        if (config.entertainment.kSongKingEnabled && config.entertainment.kSongKingBadgeId) {
          const owned = await ownedUserIds(tx, config.entertainment.kSongKingBadgeId, now)
          const awards = resolveBadgeAwards(entertainment, owned, 3)
          for (const award of awards) {
            const ok = await grantBadgeOne(tx, {
              runId: run.id, period, badgeKey: 'kSongKing', badgeId: config.entertainment.kSongKingBadgeId,
              boardKey: award.boardKey, award, now,
            })
            if (ok) tallies.badgeGrants += 1
          }
        }
      }
    }

    // Retry deadlocks / write conflicts exactly like the shun ledger. Each retry
    // rolls back the whole transaction, so re-run from a fresh tally; the grant
    // audit rows + businessKeys guarantee a partial attempt doubles nothing.
    for (let retry = 0; ; retry++) {
      const tallies: SettlementSummary = { ...summary, walletGrants: 0, walletPoints: 0, clippedGrants: 0, clippedPoints: 0, badgeGrants: 0, notifications: 0 }
      try {
        await prisma.$transaction(
          (tx) => executeTx(tx, tallies),
          { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 },
        )
        summary.walletGrants = tallies.walletGrants
        summary.walletPoints = tallies.walletPoints
        summary.clippedGrants = tallies.clippedGrants
        summary.clippedPoints = tallies.clippedPoints
        summary.badgeGrants = tallies.badgeGrants
        summary.notifications = tallies.notifications
        break
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || (error.code === 'P2010' && String(error.meta?.code) === '1213'))
        if (retryable && retry < 3) continue
        throw error
      }
    }

    summary.boards = entertainment.length + (dashboard ? 2 : 0)
    summary.candidates = entertainment.reduce((n, b) => n + b.candidates.length, 0) +
      (dashboard ? dashboard.comment.candidates.length + dashboard.aspirin.candidates.length : 0)

    await prisma.leaderboardSettlementRun.update({
      where: { id: run.id },
      data: {
        status: STATUS.completed,
        result: summary as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        attempts: { increment: 1 },
        error: null,
      },
    })
    return { status: 'COMPLETED', runId: run.id, summary }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    await prisma.leaderboardSettlementRun.update({
      where: { id: run.id },
      data: {
        status: STATUS.failed,
        error: message.slice(0, 2000),
        attempts: { increment: 1 },
        finishedAt: new Date(),
      },
    }).catch(() => undefined)
    throw error
  }
}

function accumulate(summary: SettlementSummary, r: { paid: number; clipped: number; notified: boolean }) {
  if (r.paid > 0) { summary.walletGrants += 1; summary.walletPoints += r.paid }
  if (r.clipped > 0) { summary.clippedGrants += 1; summary.clippedPoints += r.clipped }
  if (r.notified) summary.notifications += 1
}

/** Re-run an existing FAILED/COMPLETED period under admin control. */
export async function retryLeaderboardSettlement(input: {
  runId: string
  config: LeaderboardRewardsConfig
  now?: Date
  allowHistorical?: boolean
}) {
  const run = await prisma.leaderboardSettlementRun.findUnique({ where: { id: input.runId } })
  if (!run) throw new Error('RUN_NOT_FOUND')
  // Reconstruct the exact period from the snapshot; retry must not re-read a
  // wall-clock period that could have moved. Reconstructing keeps the window
  // immutable so a re-run settles the SAME ranks it originally targeted.
  const snap = run.configSnapshot as { period?: string }
  if (!snap?.period) throw new Error('RUN_SNAPSHOT_INVALID')
  const kind = run.kind as SettlementKind
  const period = reconstructPeriod(kind, snap.period)
  await prisma.leaderboardSettlementRun.update({
    where: { id: run.id },
    data: { status: STATUS.failed, finishedAt: new Date() },
  })
  return runLeaderboardSettlement({
    kind,
    config: input.config,
    now: input.now ?? new Date(),
    allowHistorical: input.allowHistorical ?? true,
    periodOverride: period,
  })
}

function reconstructPeriod(kind: SettlementKind, periodKey: string): SettlementPeriod {
  if (kind === 'weekly') {
    const startKey = periodKey.replace(/^week:/, '')
    const endKey = addDaysKey(startKey, 7)
    return {
      kind, periodKey, startDateKey: startKey, endDateKey: endKey,
      start: beijingDayStart(startKey), endExclusive: beijingDayStart(endKey),
    }
  }
  const ym = periodKey.replace(/^month:/, '')
  const startKey = `${ym}-01`
  const endKey = nextMonthKey(ym)
  return {
    kind, periodKey, startDateKey: startKey, endDateKey: endKey,
    start: beijingDayStart(startKey), endExclusive: beijingDayStart(endKey),
  }
}

function nextMonthKey(ym: string): string {
  const [year, month] = ym.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month, 1)) // month is 1-based -> next month
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
