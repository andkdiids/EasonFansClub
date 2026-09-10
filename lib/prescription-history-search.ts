import { getBeijingDateKey } from '@/lib/beijing-time'
import { parseBeijingDate } from '@/lib/checkin'

const SEARCH_SPACE_RE = /\s+/gu

export function normalizePrescriptionHistoryQuery(value: string | null | undefined) {
  return (value || '')
    .normalize('NFKC')
    .trim()
    .replace(SEARCH_SPACE_RE, ' ')
    .toLocaleLowerCase('zh-CN')
}

export function getPrescriptionHistorySearchTerms(value: string | null | undefined) {
  const normalized = normalizePrescriptionHistoryQuery(value)
  if (!normalized) return []
  const compact = normalized.replace(SEARCH_SPACE_RE, '')
  return [...new Set([normalized, compact].filter(Boolean))]
}

function dateKeyFromParts(year: number, month: number, day: number) {
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return parseBeijingDate(candidate) ? candidate : null
}

/**
 * Parses the compact date formats supported by prescription history search.
 * Month/day-only input intentionally uses the current Shanghai year.
 */
export function parsePrescriptionHistoryDateQuery(value: string | null | undefined, now = new Date()) {
  const input = (value || '').normalize('NFKC').trim().replace(SEARCH_SPACE_RE, '')
  if (!input) return null

  const fullChinese = input.match(/^(\d{4})年(\d{1,2})月(\d{1,2})[日号]?$/u)
  if (fullChinese) return dateKeyFromParts(Number(fullChinese[1]), Number(fullChinese[2]), Number(fullChinese[3]))

  const shortChinese = input.match(/^(\d{1,2})月(\d{1,2})[日号]?$/u)
  if (shortChinese) {
    return dateKeyFromParts(
      Number(getBeijingDateKey(now).slice(0, 4)),
      Number(shortChinese[1]),
      Number(shortChinese[2]),
    )
  }

  const fullSeparated = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u)
  if (fullSeparated) return dateKeyFromParts(Number(fullSeparated[1]), Number(fullSeparated[2]), Number(fullSeparated[3]))

  const shortSeparated = input.match(/^(\d{1,2})[-/.](\d{1,2})$/u)
  if (shortSeparated) {
    return dateKeyFromParts(
      Number(getBeijingDateKey(now).slice(0, 4)),
      Number(shortSeparated[1]),
      Number(shortSeparated[2]),
    )
  }

  return null
}

function normalizedLyricText(value: string) {
  return value.replace(/\r\n?/gu, '\n').replace(/[ \t]+/gu, ' ').trim()
}

/** Returns a small context window around the first lyric hit, never the full lyric. */
export function buildLyricMatchSnippet(text: string | null | undefined, query: string | null | undefined, radius = 24) {
  const source = normalizedLyricText(text || '')
  const terms = getPrescriptionHistorySearchTerms(query)
  if (!source || terms.length === 0) return null

  const sourceForMatch = source.toLocaleLowerCase('zh-CN')
  let hitIndex = -1
  let hitLength = 0
  for (const term of terms) {
    const index = sourceForMatch.indexOf(term)
    if (index >= 0 && (hitIndex < 0 || index < hitIndex)) {
      hitIndex = index
      hitLength = term.length
    }
  }
  if (hitIndex < 0) return null

  const start = Math.max(0, hitIndex - radius)
  const end = Math.min(source.length, hitIndex + hitLength + radius)
  const snippet = source.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${snippet}${end < source.length ? '…' : ''}`
}
