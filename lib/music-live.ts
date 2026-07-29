export const MUSIC_SETLIST_SECTIONS = ['OPENING', 'MAIN', 'TALK', 'REQUEST', 'ENCORE', 'SPECIAL', 'OTHER'] as const
export const MUSIC_HIGHLIGHT_TYPES = ['TALK', 'GUEST', 'SONG', 'STAGE', 'INTERACTION', 'MEMORIAL', 'OTHER'] as const
export const MUSIC_SETLIST_SECTION_LABELS: Record<(typeof MUSIC_SETLIST_SECTIONS)[number], string> = {
  OPENING: '开场', MAIN: '正式歌单', TALK: '谈话环节', REQUEST: '点歌', ENCORE: 'Encore', SPECIAL: '特别环节', OTHER: '其他',
}
export const MUSIC_HIGHLIGHT_TYPE_LABELS: Record<(typeof MUSIC_HIGHLIGHT_TYPES)[number], string> = {
  TALK: '谈话', GUEST: '嘉宾', SONG: '歌曲', STAGE: '舞台', INTERACTION: '互动', MEMORIAL: '纪念', OTHER: '其他',
}

export type ParsedSetlistItem = {
  songId: string | null
  displayName: string | null
  section: (typeof MUSIC_SETLIST_SECTIONS)[number]
  position: number
  versionName: string | null
  note: string | null
  isEncore: boolean
  isRequest: boolean
  isDebut: boolean
  isGuest: boolean
  isMedley: boolean
  isSpecial: boolean
}

export type ParsedHighlight = {
  title: string
  content: string
  type: (typeof MUSIC_HIGHLIGHT_TYPES)[number]
  sortOrder: number
}

function sanitizeText(value: unknown, maxLength: number) {
  return String(value ?? '')
    .slice(0, Math.max(maxLength * 2, maxLength))
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, maxLength)
}

export function parseLiveDate(value: unknown, required = false) {
  const raw = sanitizeText(value, 20)
  if (!raw) return required ? undefined : null
  const date = new Date(`${raw.slice(0, 10)}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function parseLiveInteger(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : undefined
}

export function parsePublicationStatus(value: unknown) {
  return value === 'PUBLISHED' ? 'PUBLISHED' as const : 'DRAFT' as const
}

function optionalText(value: unknown, maxLength: number) {
  const text = sanitizeText(value, maxLength)
  return text || null
}

export function parseSetlistItems(value: unknown): { items?: ParsedSetlistItem[]; message?: string } {
  if (!Array.isArray(value)) return { message: '歌单格式无效' }
  const items: ParsedSetlistItem[] = []
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index] as Record<string, unknown>
    const songId = optionalText(row?.songId, 100)
    const displayName = optionalText(row?.displayName, 160)
    if (!songId && !displayName) return { message: `歌单第 ${index + 1} 行必须关联歌曲或填写显示名称` }
    const section = MUSIC_SETLIST_SECTIONS.includes(row?.section as never) ? row.section as ParsedSetlistItem['section'] : undefined
    if (!section) return { message: `歌单第 ${index + 1} 行的段落无效` }
    items.push({
      songId,
      displayName,
      section,
      position: index + 1,
      versionName: optionalText(row?.versionName, 160),
      note: optionalText(row?.note, 1000),
      isEncore: row?.isEncore === true,
      isRequest: row?.isRequest === true,
      isDebut: row?.isDebut === true,
      isGuest: row?.isGuest === true,
      isMedley: row?.isMedley === true,
      isSpecial: row?.isSpecial === true,
    })
  }
  return { items }
}

export function parseHighlights(value: unknown): { items?: ParsedHighlight[]; message?: string } {
  if (!Array.isArray(value)) return { message: '特别时刻格式无效' }
  const items: ParsedHighlight[] = []
  for (let index = 0; index < value.length; index += 1) {
    const row = value[index] as Record<string, unknown>
    const title = sanitizeText(row?.title, 160)
    const content = sanitizeText(row?.content, 20_000)
    const type = MUSIC_HIGHLIGHT_TYPES.includes(row?.type as never) ? row.type as ParsedHighlight['type'] : undefined
    if (!title || !content) return { message: `特别时刻第 ${index + 1} 条的标题和内容均为必填` }
    if (!type) return { message: `特别时刻第 ${index + 1} 条的类型无效` }
    items.push({ title, content, type, sortOrder: index })
  }
  return { items }
}

export function parseBulkSetlist(text: string) {
  return text.split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+\s*[.、．)\]]|[-*•])\s*/, '').trim())
    .filter(Boolean)
}

export function formatLiveDate(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function formatLiveDateRange(start?: Date | string | null, end?: Date | string | null) {
  if (!start && !end) return '时间待整理'
  if (start && end) return `${formatLiveDate(start)} — ${formatLiveDate(end)}`
  return formatLiveDate((start || end)!)
}

export function concertDisplayTitle(concert: { title?: string | null; city: string; concertDate: Date | string }) {
  return concert.title?.trim() || `${concert.city} · ${formatLiveDate(concert.concertDate)}`
}
