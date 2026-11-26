/**
 * Ranking data adapters for settlement. They ONLY read the platform's
 * authoritative ranking services — no scoring rules are reimplemented here.
 *
 * Every adapter returns a normalized candidate list keyed by a stable
 * `boardKey` plus ranked user ids. Reward amounts and caps are applied in the
 * settlement layer, never here.
 */

import { getRankableEntertainmentLeaderboardTargets } from '@/lib/entertainment-leaderboard-registry'
import { getEntertainmentLeaderboard } from '@/lib/entertainment-leaderboard'
import { getDashboardRankings } from '@/lib/admin-dashboard-rankings'
import type { SettlementPeriod } from '@/lib/leaderboard-rewards-period'

export type RankedCandidate = {
  rank: number
  userId: string
}

export type BoardCandidates = {
  boardKey: string
  boardLabel: string
  candidates: RankedCandidate[]
}

/** Exclusive date key → inclusive date key (previous calendar day). */
function shiftEndInclusive(exclusiveDateKey: string): string {
  const d = new Date(`${exclusiveDateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Entertainment: iterate every rankable concrete board (game × mode). Each
 * board is settled independently for the per-board badge rule, but all boards
 * share ONE weekly cap (applied in the settlement layer).
 *
 * We pass an explicit `date` range so the window is locked to the settlement
 * period rather than the worker wall clock. The underlying service keeps all
 * filtering / tie-break / exclusion rules.
 */
export async function getEntertainmentCandidates(
  period: SettlementPeriod,
  now: Date,
): Promise<BoardCandidates[]> {
  const targets = getRankableEntertainmentLeaderboardTargets()
  const endDateInclusive = shiftEndInclusive(period.endDateKey)
  const results = await Promise.all(targets.map(async (target) => {
    try {
      const result = await getEntertainmentLeaderboard({
        gameKey: target.gameKey,
        mode: target.mode || undefined,
        range: 'date',
        startDate: period.startDateKey,
        endDate: endDateInclusive,
        userId: '',
        limit: 10,
        now,
      })
      return result.status === 'ready' ? result.rows : []
    } catch (error) {
      console.error('[leaderboard-rewards.entertainment]', { key: target.key }, error)
      return []
    }
  }))
  return targets.map((target, index) => ({
    boardKey: `ent:${target.key}`,
    boardLabel: target.mode ? `${target.gameName}·${target.modeLabel}` : target.gameName,
    candidates: results[index]
      .map((row) => ({ rank: row.rank, userId: row.user.id }))
      .filter((candidate) => candidate.rank >= 1 && candidate.rank <= 10),
  }))
}

/**
 * Dashboard boards (comment / aspirin) are single authoritative boards. We
 * call getDashboardRankings once with an explicit custom range so the window
 * matches the settlement period exactly, reusing the existing effective-comment
 * dedup and effective-consultation rules.
 */
export async function getDashboardCandidates(
  period: SettlementPeriod,
): Promise<{ comment: BoardCandidates; aspirin: BoardCandidates }> {
  const empty = (key: string, label: string): BoardCandidates => ({ boardKey: key, boardLabel: label, candidates: [] })
  try {
    const result = await getDashboardRankings({
      period: 'custom',
      startDate: period.startDateKey,
      endDate: shiftEndInclusive(period.endDateKey),
      now: new Date(period.start.getTime()),
    })
    return {
      comment: {
        boardKey: 'comment:main',
        boardLabel: 'E院广场评论榜',
        candidates: result.commentRanking.map((row) => ({ rank: row.rank, userId: row.userId })),
      },
      aspirin: {
        boardKey: 'aspirin:main',
        boardLabel: '阿士匹灵门诊部会诊榜',
        candidates: result.consultationRanking.map((row) => ({ rank: row.rank, userId: row.userId })),
      },
    }
  } catch (error) {
    console.error('[leaderboard-rewards.dashboard]', error)
    return {
      comment: empty('comment:main', 'E院广场评论榜'),
      aspirin: empty('aspirin:main', '阿士匹灵门诊部会诊榜'),
    }
  }
}
