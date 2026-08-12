export type ConcertPosterSource = 'concert' | 'city' | 'tour' | 'system'

export type ConcertPosterResolution = {
  resolvedPosterUrl: string | null
  posterSource: ConcertPosterSource
}

export type ConcertPosterInput = {
  posterUrl?: string | null
  cityPosterUrl?: string | null
  tourPosterUrl?: string | null
}

function usablePosterUrl(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed || null
}

export function firstPosterUrl(values: Array<string | null | undefined>) {
  for (const value of values) {
    const posterUrl = usablePosterUrl(value)
    if (posterUrl) return posterUrl
  }
  return null
}

export function resolveConcertPoster({ posterUrl, cityPosterUrl, tourPosterUrl }: ConcertPosterInput): ConcertPosterResolution {
  const candidates: Array<[ConcertPosterSource, string | null | undefined]> = [
    ['concert', posterUrl],
    ['city', cityPosterUrl],
    ['tour', tourPosterUrl],
  ]
  for (const [posterSource, value] of candidates) {
    const resolvedPosterUrl = toPublicMediaUrl(usablePosterUrl(value))
    if (resolvedPosterUrl) return { resolvedPosterUrl, posterSource }
  }
  return { resolvedPosterUrl: null, posterSource: 'system' }
}

export function resolveConcertPosterUrl(input: ConcertPosterInput) {
  return resolveConcertPoster(input).resolvedPosterUrl
}

export function concertPosterSourceLabel(source: ConcertPosterSource) {
  if (source === 'concert') return '当前场次海报'
  if (source === 'city') return '继承城市默认海报'
  if (source === 'tour') return '继承巡演默认海报'
  return '系统默认占位海报'
}
import { toPublicMediaUrl } from '@/lib/media-url'
