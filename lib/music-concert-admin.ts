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
  concerts: Array<{ id: string; city?: string; stageType?: string; concertDate: Date | string; startTime?: Date | string | null; createdAt?: Date | string; sortOrder?: number }>,
) {
  const chronological = [...concerts].sort((left, right) => {
    const dateDifference = new Date(left.concertDate).getTime() - new Date(right.concertDate).getTime()
    if (dateDifference) return dateDifference
    const timeDifference = new Date(left.startTime || 0).getTime() - new Date(right.startTime || 0).getTime()
    if (timeDifference) return timeDifference
    const createdDifference = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
    return createdDifference || left.id.localeCompare(right.id)
  })
  const hasExplicitOrder = concerts.some((concert) => Number.isFinite(concert.sortOrder) && (concert.sortOrder || 0) > 0)
  const ordered = hasExplicitOrder
    ? [...concerts].sort((left, right) => {
      const leftOrder = (left.sortOrder || 0) > 0 ? left.sortOrder! : Number.MAX_SAFE_INTEGER
      const rightOrder = (right.sortOrder || 0) > 0 ? right.sortOrder! : Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || new Date(left.concertDate).getTime() - new Date(right.concertDate).getTime() || new Date(left.startTime || 0).getTime() - new Date(right.startTime || 0).getTime() || new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime() || left.id.localeCompare(right.id)
    })
    : chronological
  // 场次编号按（城市 + 场次类型）分组：普通场与返场/最终站即使城市相同也各自独立编号。
  const citySequence = new Map<string, number>()
  const chronologicalSessionNumbers = new Map<string, string>()
  for (const concert of chronological) {
    const groupKey = `${concert.city || '__all__'}::${concert.stageType || 'NORMAL'}`
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

// 将「演出日期 + 开始/结束时间(HH:mm)」合并为 DateTime；时间缺失或格式非法返回 null。
// 日期部分取自 concertDate（store 中以 12:00 UTC 存储），时间部分取自用户输入，保证排序与展示一致。
export function combineDateAndTime(baseDate: Date, time?: string | null): Date | null {
  if (!time || typeof time !== 'string') return null
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  const result = new Date(baseDate)
  result.setUTCHours(hours, minutes, 0, 0)
  return result
}

// 从 DateTime 提取 HH:mm（UTC，与 formatLiveDate 一致）；缺失或非法返回空串。
export function formatConcertTime(value?: Date | string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function cloneSetlistItems(items: ParsedSetlistItem[], concertId: string) {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.position - right.item.position || left.index - right.index)
  const cloneGroup = (isEncore: boolean) => ordered
    .filter(({ item }) => item.isEncore === isEncore)
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

  return [...cloneGroup(false), ...cloneGroup(true)]
}
