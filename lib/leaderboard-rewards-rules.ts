/**
 * Pure settlement business rules — no DB, no IO. Fully unit-testable.
 *
 * Holds: per-user weekly cap clipping, badge rollover with ownership dedup,
 * and idempotency-key builders. These are the rules the paid integration tests
 * assert against; keeping them pure makes the important money logic provable.
 */

import type { LeaderboardRewardCategory } from '@/lib/leaderboard-rewards-config'
import type { RankedCandidate } from '@/lib/leaderboard-rewards-sources'

export type CapDecision = {
  /** Reward rank already grants 0 => no payout, no cap touch. */
  eligible: boolean
  originalAmount: number
  capUsedBefore: number
  capUsedAfter: number
  actualAmount: number
  clippedAmount: number
}

/**
 * Apply the per-user weekly cap. `rankReward` already produced originalAmount
 * (0 when rank > 10). Returns a decision the caller executes inside a locked
 * transaction. Pure: no mutation, no DB.
 */
export function decideCap(
  originalAmount: number,
  capUsedBefore: number,
  weeklyCap: number,
): CapDecision {
  if (originalAmount <= 0) {
    return {
      eligible: false,
      originalAmount: 0,
      capUsedBefore,
      capUsedAfter: capUsedBefore,
      actualAmount: 0,
      clippedAmount: 0,
    }
  }
  const remaining = Math.max(0, weeklyCap - Math.max(0, capUsedBefore))
  const actual = Math.min(originalAmount, remaining)
  return {
    eligible: actual > 0,
    originalAmount,
    capUsedBefore,
    capUsedAfter: capUsedBefore + actual,
    actualAmount: actual,
    clippedAmount: originalAmount - actual,
  }
}

export type BadgeAward = {
  userId: string
  /** The board rank that qualified the user (may be beyond 3 after rollover). */
  rank: number
  boardKey: string
}

/**
 * Resolve badge grants across one or many boards with rollover and global
 * dedup. Walk candidates by ascending rank (caller supplies boards in a stable
 * order), skip users that already own the badge, give at most `maxPerBoard`
 * per board, and never award the same user twice across all boards.
 *
 * @param boards stable-ordered boards with their ranked candidates
 * @param alreadyOwned user ids that already own the badge (DB truth)
 * @param maxPerBoard maximum new recipients per board (3 for both badges)
 */
export function resolveBadgeAwards(
  boards: Array<{ boardKey: string; candidates: RankedCandidate[] }>,
  alreadyOwned: ReadonlySet<string>,
  maxPerBoard = 3,
): BadgeAward[] {
  const awarded = new Set<string>(alreadyOwned)
  const result: BadgeAward[] = []
  for (const board of boards) {
    let grantedForBoard = 0
    // Candidates are already in rank order from the authoritative service.
    for (const candidate of [...board.candidates].sort((a, b) => a.rank - b.rank)) {
      if (grantedForBoard >= maxPerBoard) break
      if (awarded.has(candidate.userId)) continue
      awarded.add(candidate.userId)
      result.push({ userId: candidate.userId, rank: candidate.rank, boardKey: board.boardKey })
      grantedForBoard += 1
    }
  }
  return result
}

/** Stable idempotency key for a wallet reward: type + period + board + user. */
export function rewardBusinessKey(
  kind: 'weekly' | 'monthly',
  periodKey: string,
  category: LeaderboardRewardCategory,
  boardKey: string,
  userId: string,
): string {
  return `leaderboard:${kind}:${periodKey}:${category}:${boardKey}:${userId}`
}

/** Stable grant key for a badge: badge + period + board + user. */
export function badgeGrantKey(
  badgeKey: 'thankYou' | 'kSongKing',
  periodKey: string,
  boardKey: string,
  userId: string,
): string {
  return `leaderboard-badge:${badgeKey}:${periodKey}:${boardKey}:${userId}`
}

/** Dedup-safe notification key (ties to the same business identity). */
export function rewardNotificationKey(businessKey: string): string {
  return `notify:${businessKey}`
}
