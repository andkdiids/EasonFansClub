export const RATING_PAGE_SIZE = 30

export const RATING_LANGUAGE_OPTIONS = [
  { value: 'ALL', label: '全部' },
  { value: 'CANTONESE', label: '粤语' },
  { value: 'MANDARIN', label: '国语' },
  { value: 'FOREIGN', label: '外语' },
] as const

export type RatingLanguage = (typeof RATING_LANGUAGE_OPTIONS)[number]['value']
export type RatingTarget = 'song' | 'album'
export type RatingReviewSort = 'hot' | 'latest'

export function parseRatingLanguage(value: unknown): RatingLanguage {
  const normalized = String(value || '').toUpperCase()
  return RATING_LANGUAGE_OPTIONS.some((option) => option.value === normalized)
    ? normalized as RatingLanguage
    : 'ALL'
}

export function parseRatingTarget(value: unknown): RatingTarget {
  return value === 'album' || value === 'albums' ? 'album' : 'song'
}

export function parseRatingReviewSort(value: unknown): RatingReviewSort {
  return value === 'latest' ? 'latest' : 'hot'
}

/**
 * The music catalog stores human-entered language values.  Keep this mapping
 * in one place so the ratings UI never guesses from a song title.
 */
export function normalizeRatingLanguage(value?: string | null): Exclude<RatingLanguage, 'ALL'> {
  const text = String(value || '').trim().toLocaleLowerCase()

  if (
    /cantonese|粵語|粤语|廣東話|广东话|zh[-_ ]?hk|zh[-_ ]?mo|yue|hong[ -]?kong/.test(text)
  ) return 'CANTONESE'

  if (
    /mandarin|普通話|普通话|國語|国语|華語|华语|zh[-_ ]?(cn|sg|my)|putonghua/.test(text)
  ) return 'MANDARIN'

  return 'FOREIGN'
}

export function ratingLanguageLabel(value?: string | null) {
  const language = normalizeRatingLanguage(value)
  return RATING_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label || '外语'
}

export function parseRatingScore(value: unknown) {
  const score = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 10 ? score : null
}

export function formatAverageScore(value: number | string | null | undefined) {
  const score = Number(value)
  return Number.isFinite(score) ? score.toFixed(1) : '0.0'
}

export function scoreToStars(value: number | string | null | undefined) {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(0, Math.min(5, score / 2)) : 0
}

export function ratingScoreForStarHalf(starIndex: number, half: 'left' | 'right') {
  if (!Number.isInteger(starIndex) || starIndex < 0 || starIndex > 4) return null
  return starIndex * 2 + (half === 'left' ? 1 : 2)
}

export function formatRatingCount(value: number | string | null | undefined) {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)).toLocaleString('zh-CN') : '0'
}

export function ratingTargetPath(target: RatingTarget, id: string) {
  return target === 'album' ? `/ratings/albums/${id}` : `/ratings/songs/${id}`
}
