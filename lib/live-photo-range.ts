export type ResolvedByteRange = { start: number; end: number; total: number }

/** RFC 7233 single-range parser for private live-photo video responses. */
export function resolveByteRange(header: string | null | undefined, total: number): ResolvedByteRange | null {
  if (!total || total <= 0) return null
  const raw = header?.trim() || ''
  if (!raw) return { start: 0, end: total - 1, total }
  const match = raw.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) return null

  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, total - suffix), end: total - 1, total }
  }
  const start = Number(match[1])
  if (!Number.isSafeInteger(start) || start < 0 || start >= total) return null
  const end = match[2] ? Number(match[2]) : total - 1
  if (!Number.isSafeInteger(end) || end < start) return null
  return { start, end: Math.min(end, total - 1), total }
}
