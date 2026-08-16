import type { UndercoverPrivateState, UndercoverPublicMatchSnapshot } from '@/lib/undercover-star-protocol'

export function canApplyUndercoverSnapshot(
  current: UndercoverPublicMatchSnapshot | null,
  next: UndercoverPublicMatchSnapshot,
) {
  if (current && current.matchId !== next.matchId) return false
  if (!current) return true
  if (current.phase === 'FINISHED' && next.phase !== 'FINISHED') return false
  if (next.round < current.round) return false
  if (next.revision < current.revision) return false
  return true
}

export function canApplyUndercoverPrivateState(
  current: UndercoverPublicMatchSnapshot | null,
  next: UndercoverPrivateState,
) {
  if (current && current.matchId !== next.matchId) return false
  if (current && current.phase === 'FINISHED' && next.phase !== 'FINISHED') return false
  if (current && next.round < current.round) return false
  if (current && next.revision < current.revision) return false
  return true
}
