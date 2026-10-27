import { sanitizeText } from '@/lib/security'
import { parseHttpsRegistrationUrl } from '@/lib/concert-events'
import { isPublicMediaProxyUrl, PUBLIC_COS_HOST, toStoredMediaUrl } from '@/lib/media-url'

const eventStatuses = ['DRAFT', 'UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING', 'ENDED', 'ARCHIVED'] as const
const showStatuses = ['SCHEDULED', 'CANCELLED', 'ARCHIVED'] as const
const timelineTypes = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSE', 'FIRST_DRAW_RESULT', 'FIRST_PAYMENT_DEADLINE', 'SECOND_DRAW_RESULT', 'SECOND_PAYMENT_DEADLINE', 'FIRST_SHOW', 'FINAL_SHOW', 'CUSTOM'] as const
const tutorialTypes = ['REGISTRATION', 'TICKETING'] as const
const tutorialStatuses = ['DRAFT', 'PUBLISHED'] as const

export class ConcertAdminInputError extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConcertAdminInputError('请求内容格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, required = false) {
  const result = sanitizeText(value, max).trim()
  if (required && !result) throw new ConcertAdminInputError(`${label}不能为空`)
  return result || null
}
function bool(value: unknown, fallback = false) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ConcertAdminInputError('布尔配置格式无效')
  return value
}
function integer(value: unknown, fallback = 0, min = 0, max = 100000) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new ConcertAdminInputError('排序或年份数值无效')
  return parsed
}
export function parseConcertDate(value: unknown, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ConcertAdminInputError('日期不能为空')
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ConcertAdminInputError('日期格式必须为 YYYY-MM-DD')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ConcertAdminInputError('日期无效')
  return date
}
function optionalDateTime(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new ConcertAdminInputError('时间格式无效')
  return new Date(value)
}
function enumValue<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : fallback
}

function parseProjectMediaImage(value: unknown, label: string) {
  const imageInput = text(value, label, 2048)
  if (!imageInput) return null
  const stored = toStoredMediaUrl(imageInput)
  if (!stored || (!isPublicMediaProxyUrl(imageInput) && !imageInput.startsWith(`https://${PUBLIC_COS_HOST}/`))) {
    throw new ConcertAdminInputError(`${label}必须使用项目公开媒体库中的图片地址`)
  }
  try {
    const parsed = new URL(stored)
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== PUBLIC_COS_HOST
      || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid project media URL')
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    throw new ConcertAdminInputError(`${label}必须使用项目媒体库中的公开图片地址`)
  }
}

export function parseConcertEventInput(value: unknown) {
  const input = object(value)
  const title = text(input.title, '专题名称', 191, true)!
  const slug = text(input.slug, '专题路径', 191, true)!
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new ConcertAdminInputError('专题路径只允许小写字母、数字和连字符')
  const registrationUrlInput = text(input.registrationUrl, '登记入口', 2000)
  const registrationUrl = registrationUrlInput ? parseHttpsRegistrationUrl(registrationUrlInput) : null
  if (registrationUrlInput && !registrationUrl) throw new ConcertAdminInputError('登记入口必须是没有账号信息的 HTTPS 地址')
  const registrationEnabled = bool(input.registrationEnabled)
  if (registrationEnabled && !registrationUrl) throw new ConcertAdminInputError('启用登记入口前请填写有效 HTTPS 地址')
  const backgroundImageUrl = input.backgroundImageUrl === undefined
    ? undefined
    : parseProjectMediaImage(input.backgroundImageUrl, '专题背景图')
  const timezone = text(input.timezone, '时区', 64) || 'Asia/Hong_Kong'
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { throw new ConcertAdminInputError('时区无效') }
  return {
    title,
    subtitle: text(input.subtitle, '副标题', 300),
    slug,
    venue: text(input.venue, '场地', 300),
    startDate: parseConcertDate(input.startDate),
    endDate: parseConcertDate(input.endDate),
    description: text(input.description, '说明', 10000, true)!,
    sourceNote: text(input.sourceNote, '资料说明', 5000),
    timezone,
    registrationUrl,
    registrationEnabled,
    registrationLabel: text(input.registrationLabel, '登记按钮文案', 80) || '登记入口',
    backgroundImageUrl,
    homepageFeatured: bool(input.homepageFeatured),
    activityCenterVisible: bool(input.activityCenterVisible, true),
    allowMarking: bool(input.allowMarking, true),
    allowDiscussion: bool(input.allowDiscussion, true),
    status: enumValue(input.status, eventStatuses, 'DRAFT'),
  }
}

export function parseConcertShowInputs(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new ConcertAdminInputError('场次数据必须是最多 100 条的列表')
  return value.map((raw, index) => {
    const input = object(raw)
    if (!Array.isArray(input.songs) || input.songs.length > 80 || input.songs.some((song) => typeof song !== 'string')) throw new ConcertAdminInputError(`第 ${index + 1} 场歌单格式无效`)
    const startTime = text(input.startTime, '场次时间', 10)
    if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw new ConcertAdminInputError(`第 ${index + 1} 场时间格式无效`)
    return {
      id: text(input.id, '场次 ID', 191),
      date: parseConcertDate(input.date, true)!,
      startTime,
      title: text(input.title, '场次标题', 191),
      albumTitle: text(input.albumTitle, '专辑标题', 300, true)!,
      albumSubtitle: text(input.albumSubtitle, '专辑副标题', 300),
      albumYear: input.albumYear === null || input.albumYear === undefined || input.albumYear === '' ? null : integer(input.albumYear, 0, 1900, 2100),
      songs: input.songs.map((song) => sanitizeText(song, 191).trim()).filter(Boolean),
      note: text(input.note, '场次说明', 3000),
      sortOrder: integer(input.sortOrder),
      status: enumValue(input.status, showStatuses, 'SCHEDULED'),
    }
  })
}

export function parseConcertTimelineInputs(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new ConcertAdminInputError('时间线数据必须是最多 100 条的列表')
  return value.map((raw, index) => {
    const input = object(raw)
    const type = enumValue(input.type, timelineTypes, 'CUSTOM')
    const date = parseConcertDate(input.date, true)!
    const startsAt = optionalDateTime(input.startsAt)
    const endsAt = optionalDateTime(input.endsAt)
    if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) throw new ConcertAdminInputError(`第 ${index + 1} 个时间节点的开始时间必须早于结束时间`)
    return { id: text(input.id, '节点 ID', 191), type, title: text(input.title, '节点标题', 191, true)!, description: text(input.description, '节点说明', 3000), date, startsAt, endsAt, sortOrder: integer(input.sortOrder), enabled: bool(input.enabled, true), countdownEnabled: bool(input.countdownEnabled), notificationEnabled: bool(input.notificationEnabled) }
  })
}

export function parseConcertTutorialInputs(value: unknown) {
  if (!Array.isArray(value) || value.length > 30) throw new ConcertAdminInputError('教程数据必须是最多 30 条的列表')
  return value.map((raw) => {
    const input = object(raw)
    if (!Array.isArray(input.steps) || input.steps.length > 50) throw new ConcertAdminInputError('教程步骤格式无效')
    const steps = input.steps.map((rawStep) => {
      const step = object(rawStep)
      const imageInput = text(step.imageUrl, '步骤图片', 2048)
      let imageUrl: string | null = null
      if (imageInput) {
        const stored = toStoredMediaUrl(imageInput)
        if (!stored) throw new ConcertAdminInputError('教程图片必须使用项目公开媒体库中的图片地址')
        try {
          const parsed = new URL(stored)
          if ((!isPublicMediaProxyUrl(imageInput) && parsed.hostname.toLowerCase() !== PUBLIC_COS_HOST) || parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== PUBLIC_COS_HOST || parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new Error('invalid tutorial image URL')
          }
          imageUrl = `${parsed.origin}${parsed.pathname}`
        } catch {
          throw new ConcertAdminInputError('教程图片必须使用项目媒体库中的公开图片地址')
        }
      }
      const linkInput = text(step.linkUrl, '步骤链接', 2048)
      const linkUrl = linkInput ? parseHttpsRegistrationUrl(linkInput) : null
      if (linkInput && !linkUrl) throw new ConcertAdminInputError('教程链接必须是没有账号信息的 HTTPS 地址')
      return {
        title: text(step.title, '步骤标题', 191, true)!,
        body: text(step.body, '步骤说明', 2000, true)!,
        imageUrl,
        imageAlt: text(step.imageAlt, '图片说明', 300),
        caution: text(step.caution, '注意事项', 1000),
        linkUrl,
        linkLabel: text(step.linkLabel, '链接文案', 80),
      }
    })
    return { id: text(input.id, '教程 ID', 191), type: enumValue(input.type, tutorialTypes, 'REGISTRATION'), title: text(input.title, '教程标题', 191, true)!, summary: text(input.summary, '教程摘要', 3000), steps, status: enumValue(input.status, tutorialStatuses, 'DRAFT'), sortOrder: integer(input.sortOrder) }
  })
}
