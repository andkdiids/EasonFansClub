import type { ParsedSetlistItem } from '@/lib/music-live'
import { parseLiveDate } from '@/lib/music-live'

export const DEFAULT_CONCERT_COUNTRY = '中国'
export const MAX_CONCERT_DATES_PER_BATCH = 40

export function parseConcertDates(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  const unique = [...new Set(values.map((item) => String(item ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_CONCERT_DATES_PER_BATCH + 1)
  if (!unique.length) return { message: '请至少选择一个演出日期' } as const
  if (unique.length > MAX_CONCERT_DATES_PER_BATCH) {
    return { message: `一次最多创建 ${MAX_CONCERT_DATES_PER_BATCH} 个演出日期` } as const
  }
  const dates = unique.map((item) => parseLiveDate(item, true))
  if (dates.some((date) => !date)) return { message: '演出日期格式无效' } as const
  return { dates: dates as Date[], dateKeys: unique } as const
}

export function buildConcertSequenceUpdates(
  concerts: Array<{ id: string; city?: string; concertDate: Date | string; createdAt?: Date | string }>,
) {
  const citySequence = new Map<string, number>()
  return [...concerts]
    .sort((left, right) => {
      const dateDifference = new Date(left.concertDate).getTime() - new Date(right.concertDate).getTime()
      if (dateDifference) return dateDifference
      const createdDifference = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
      return createdDifference || left.id.localeCompare(right.id)
    })
    .map((concert, index) => {
      const groupKey = concert.city || '__all__'
      const sessionNumber = (citySequence.get(groupKey) || 0) + 1
      citySequence.set(groupKey, sessionNumber)
      return {
        id: concert.id,
        sessionNumber: String(sessionNumber),
        sortOrder: index + 1,
      }
    })
}

export function cloneSetlistItems(items: ParsedSetlistItem[], concertId: string) {
  return items.map((item, index) => ({
    ...item,
    concertId,
    position: index + 1,
  }))
}
