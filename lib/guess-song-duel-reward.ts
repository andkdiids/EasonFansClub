import { DUEL_WIN_REWARD } from '@/lib/guess-song-duel-config'

export const DUEL_REWARD_ACTION = 'GUESS_SONG_DUEL_WIN' as const
export const DUEL_REWARD_BUSINESS_KEY_PREFIX = 'guess-song-duel-reward:match:'

export function duelRewardBusinessKey(matchId: string) {
  return `${DUEL_REWARD_BUSINESS_KEY_PREFIX}${matchId}`
}

export type DuelRewardReason =
  | 'GRANTED'
  | 'DAILY_LIMIT_REACHED'
  | 'ALREADY_GRANTED_FOR_MATCH'
  | 'REWARD_FAILED'
  | 'NOT_ELIGIBLE'

export type DuelRewardDecision = {
  granted: boolean
  amount: number
  reason: DuelRewardReason
}

export function resolveDuelRewardDecision(input: {
  valid: boolean
  winnerId: string | null
  isDraw: boolean
  winnerSuspicious: boolean
  dailyRewardExists: boolean
  matchRewardAmount?: number
}): DuelRewardDecision {
  if (!input.valid || !input.winnerId || input.isDraw || input.winnerSuspicious) {
    return { granted: false, amount: 0, reason: 'NOT_ELIGIBLE' }
  }

  if (input.matchRewardAmount && input.matchRewardAmount > 0) {
    return { granted: true, amount: input.matchRewardAmount, reason: 'ALREADY_GRANTED_FOR_MATCH' }
  }

  if (input.dailyRewardExists) {
    return { granted: false, amount: 0, reason: 'DAILY_LIMIT_REACHED' }
  }

  return { granted: true, amount: DUEL_WIN_REWARD, reason: 'GRANTED' }
}
