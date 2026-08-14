import type { DuelMatchState, DuelQuestionState } from '@/lib/guess-song-duel-protocol'

export function canApplyDuelMatchSnapshot(
  activeMatchId: string | null,
  current: DuelMatchState | null,
  next: DuelMatchState,
) {
  if (activeMatchId !== next.matchId) return false
  if (!current || current.matchId !== next.matchId) return true
  if (current.status !== 'PLAYING' && next.status === 'PLAYING') return false
  return next.revision >= current.revision
}

export function canApplyDuelQuestionResponse(
  current: DuelMatchState | null,
  question: DuelQuestionState,
  requestGeneration: number,
  currentGeneration: number,
) {
  if (!current || current.status !== 'PLAYING') return false
  if (requestGeneration !== currentGeneration) return false
  return question.matchId === current.matchId
    && current.currentQuestionIndex === question.questionIndex
    && current.roundId === question.roundId
    && current.questionToken === question.publicToken
}
