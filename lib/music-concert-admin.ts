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
  concerts: Array<{ id: string; city?: string; concertDate: Date | string; createdAt?: Date | string; sortOrder?: number }>,
) {
  const chronological = [...concerts].sort((left, right) => {
    const dateDifference = new Date(left.concertDate).getTime() - new Date(right.concertDate).getTime()
    if (dateDifference) return dateDifference
    const createdDifference = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
    return createdDifference || left.id.localeCompare(right.id)
  })
  const hasExplicitOrder = concerts.some((concert) => Number.isFinite(concert.sortOrder) && (concert.sortOrder || 0) > 0)
  const ordered = hasExplicitOrder
    ? [...concerts].sort((left, right) => {
      const leftOrder = (left.sortOrder || 0) > 0 ? left.sortOrder! : Number.MAX_SAFE_INTEGER
      const rightOrder = (right.sortOrder || 0) > 0 ? right.sortOrder! : Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || new Date(left.concertDate).getTime() - new Date(right.concertDate).getTime() || new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime() || left.id.localeCompare(right.id)
    })
    : chronological
  const citySequence = new Map<string, number>()
  const chronologicalSessionNumbers = new Map<string, string>()
  for (const concert of chronological) {
    const groupKey = concert.city || '__all__'
    const sessionNumber = (citySequence.get(groupKey) || 0) + 1
    citySequence.set(groupKey, sessionNumber)
    chronologicalSessionNumbers.set(concert.id, String(sessionNumber))
  }
  return ordered.map((concert, index) => {
    return {
      id: concert.id,
      sessionNumber: chronologicalSessionNumbers.get(concert.id) || String(index + 1),
      sortOrder: index + 1,
    }
  })
}

export function cloneSetlistItems(items: ParsedSetlistItem[], concertId: string) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.position - right.item.position || left.index - right.index)
    .map(({ item }, index) => ({
      songId: item.songId,
      displayName: item.displayName,
      section: item.section,
      versionName: item.versionName,
      note: item.note,
      isEncore: item.isEncore,
      isRequest: item.isRequest,
      isDebut: item.isDebut,
      isGuest: item.isGuest,
      isMedley: item.isMedley,
      isSpecial: item.isSpecial,
      concertId,
      position: index + 1,
    }))
}
