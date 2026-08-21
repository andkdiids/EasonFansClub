import type { DuelMatchState, DuelQuestionState, DuelRealtimeEvent } from '@/lib/guess-song-duel-protocol'

export type DuelQuestionIdentity = {
  matchId: string
  questionIndex: number
  roundId: string | null
  questionId: string | null
  questionToken: string | null
}

export function getDuelQuestionIdentity(match: DuelMatchState): DuelQuestionIdentity {
  return {
    matchId: match.matchId,
    questionIndex: match.question?.questionIndex ?? match.currentQuestionIndex,
    roundId: match.question?.roundId ?? match.roundId,
    questionId: match.question?.questionId ?? match.questionId,
    questionToken: match.question?.publicToken ?? match.questionToken,
  }
}

export function sameDuelQuestionIdentity(left: DuelQuestionIdentity, right: DuelQuestionIdentity) {
  return left.matchId === right.matchId
    && left.questionIndex === right.questionIndex
    && left.roundId === right.roundId
    && left.questionId === right.questionId
    && left.questionToken === right.questionToken
}

export function duelQuestionIdentityKey(identity: DuelQuestionIdentity) {
  return [identity.matchId, identity.questionIndex, identity.roundId || '', identity.questionId || '', identity.questionToken || ''].join(':')
}

export function canApplyDuelAnswerAccepted(
  current: DuelMatchState | null,
  event: Extract<DuelRealtimeEvent, { type: 'ANSWER_ACCEPTED' }>,
) {
  if (!current || current.status !== 'PLAYING' || !current.question) return false
  return sameDuelQuestionIdentity(getDuelQuestionIdentity(current), {
    matchId: event.matchId,
    questionIndex: event.questionIndex,
    roundId: event.roundId,
    questionId: event.questionId,
    questionToken: event.questionToken,
  })
}

export function canApplyDuelMatchSnapshot(
  activeMatchId: string | null,
  current: DuelMatchState | null,
  next: DuelMatchState,
) {
  if (activeMatchId !== next.matchId) return false
  if (!current || current.matchId !== next.matchId) return true
  if (current.status !== 'PLAYING' && next.status === 'PLAYING') return false
  if (next.revision === current.revision && !sameDuelQuestionIdentity(getDuelQuestionIdentity(current), getDuelQuestionIdentity(next))) return false
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
