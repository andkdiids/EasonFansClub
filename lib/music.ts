import { sanitizeText } from '@/lib/security'

export const MUSIC_SOURCE_TYPES = ['netease', 'qq', 'apple', 'custom'] as const

export function parseMusicYear(value: unknown) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null
}

export function parseTrackNumber(value: unknown) {
  const trackNumber = Number(value)
  return Number.isInteger(trackNumber) && trackNumber >= 1 && trackNumber <= 999 ? trackNumber : null
}

export function parseOptionalDuration(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const duration = Number(value)
  return Number.isInteger(duration) && duration > 0 && duration <= 24 * 60 * 60 ? duration : null
}

export function optionalMusicText(value: unknown, maxLength: number) {
  const text = sanitizeText(value, maxLength)
  return text || null
}

export function parseMusicFeatured(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

export function parseMusicFeaturedOrder(value: unknown, isFeatured: boolean) {
  if (!isFeatured) return null
  const order = Number(value)
  return Number.isInteger(order) && order >= 0 ? order : 0
}

export function musicCover(albumCover?: string | null, songCover?: string | null) {
  return songCover || albumCover || null
}

export function formatTrackNumber(trackNumber: number) {
  return String(trackNumber).padStart(2, '0')
}

export function formatDuration(duration?: number | null) {
  if (!duration) return null
  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
