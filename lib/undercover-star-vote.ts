export type UndercoverVoteInput = {
  voterId?: string
  targetId: string | null
  isAbstain: boolean
}

export type UndercoverVoteResolution = {
  outcome: 'TIE' | 'NO_ELIMINATION' | 'ELIMINATED'
  reason: 'TIE' | 'NO_VALID_VOTES' | 'ROUND_ONE_THRESHOLD' | null
  highestVoteCount: number
  candidates: string[]
  voteCounts: Array<{ playerId: string; count: number }>
  eliminatedPlayerId: string | null
}

/**
 * The only vote rule used by the match service.
 *
 * Abstentions are completed votes, but they never enter the candidate pool.
 * The target list is intersected with alivePlayerIds so an old/stale row can
 * never eliminate a player who is no longer alive.
 */
export function resolveVoteResult(input: {
  round: number
  alivePlayerIds: string[]
  votes: UndercoverVoteInput[]
}): UndercoverVoteResolution {
  const alivePlayerIds = [...new Set(input.alivePlayerIds)]
  const alive = new Set(alivePlayerIds)
  const counts = new Map<string, number>()

  for (const vote of input.votes) {
    if (vote.voterId && !alive.has(vote.voterId)) continue
    if (vote.isAbstain || !vote.targetId || !alive.has(vote.targetId)) continue
    counts.set(vote.targetId, (counts.get(vote.targetId) || 0) + 1)
  }

  const highestVoteCount = Math.max(0, ...counts.values())
  const candidates = highestVoteCount > 0
    ? alivePlayerIds.filter((playerId) => counts.get(playerId) === highestVoteCount)
    : []
  const voteCounts = alivePlayerIds
    .map((playerId) => ({ playerId, count: counts.get(playerId) || 0 }))
    .filter((entry) => entry.count > 0)

  if (candidates.length > 1) {
    return {
      outcome: 'TIE',
      reason: 'TIE',
      highestVoteCount,
      candidates,
      voteCounts,
      eliminatedPlayerId: null,
    }
  }

  if (!candidates.length) {
    return {
      outcome: 'NO_ELIMINATION',
      reason: 'NO_VALID_VOTES',
      highestVoteCount,
      candidates,
      voteCounts,
      eliminatedPlayerId: null,
    }
  }

  // The first round requires a clear signal of at least three votes. This
  // protection is intentionally scoped to round 1; later rounds use the
  // ordinary unique-highest-vote rule.
  if (input.round === 1 && highestVoteCount <= 2) {
    return {
      outcome: 'NO_ELIMINATION',
      reason: 'ROUND_ONE_THRESHOLD',
      highestVoteCount,
      candidates,
      voteCounts,
      eliminatedPlayerId: null,
    }
  }

  return {
    outcome: 'ELIMINATED',
    reason: null,
    highestVoteCount,
    candidates,
    voteCounts,
    eliminatedPlayerId: candidates[0],
  }
}
