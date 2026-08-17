import type { UndercoverPrivateState, UndercoverPublicMatchSnapshot, UndercoverRoomState } from '@/lib/undercover-star-protocol'

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

// Room state has no numeric revision, so lastActivityAt (bumped on every room
// mutation server-side) is the monotonic authority. A realtime room update is
// applied only when it targets the same room and is at least as fresh as what
// the client already holds — this prevents a stale in-flight HTTP/fallback
// response (e.g. fetched before a join landed) from clobbering a newer WS
// broadcast. A room switch is driven by explicit user action, not by this guard.
export function canApplyUndercoverRoomState(
  current: UndercoverRoomState | null,
  next: UndercoverRoomState,
) {
  if (!current) return true
  if (current.roomId !== next.roomId) return false
  return next.lastActivityAt >= current.lastActivityAt
}
