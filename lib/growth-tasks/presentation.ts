export const LISTEN_DUEL_PROGRESS_TARGET = 7

function normalizeListenDuelProgress(current: number) {
  return Math.min(LISTEN_DUEL_PROGRESS_TARGET, Math.max(0, Math.floor(Number.isFinite(current) ? current : 0)))
}

export function formatListenDuelProgress(current: number) {
  return `${normalizeListenDuelProgress(current)}/${LISTEN_DUEL_PROGRESS_TARGET}`
}

export function isListenDuelProgressComplete(current: number) {
  return normalizeListenDuelProgress(current) >= LISTEN_DUEL_PROGRESS_TARGET
}
