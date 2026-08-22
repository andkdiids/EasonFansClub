import type { Prisma } from '@prisma/client'
import { buildConcertSequenceUpdates, cloneSetlistItems, combineDateAndTime, DEFAULT_CONCERT_COUNTRY } from '@/lib/music-concert-admin'
import { parseLiveDate } from '@/lib/music-live'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { sanitizeText } from '@/lib/security'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'

export const CONCERT_CONTRIBUTION_TYPES = ['SHOW', 'SETLIST', 'ENCORE'] as const
export type ConcertContributionTypeValue = typeof CONCERT_CONTRIBUTION_TYPES[number]

export const CONCERT_CONTRIBUTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const
export type ConcertContributionStatusValue = typeof CONCERT_CONTRIBUTION_STATUSES[number]

export const CONTRIBUTION_TYPE_LABELS: Record<ConcertContributionTypeValue, string> = {
  SHOW: '场次',
  SETLIST: '歌单',
  ENCORE: 'Encore',
}

export const CONTRIBUTION_STATUS_LABELS: Record<ConcertContributionStatusValue, string> = {
  PENDING: '审核中',
  APPROVED: '已通过',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
}

export type ContributionSetlistItem = {
  songId: string | null
  displayName: string | null
  section: 'OPENING' | 'MAIN' | 'TALK' | 'REQUEST' | 'ENCORE' | 'SPECIAL' | 'OTHER'
  versionName: string | null
  note: string | null
  isEncore: boolean
  isRequest: boolean
  isDebut: boolean
  isGuest: boolean
  isMedley: boolean
  isSpecial: boolean
}

export type ShowContributionPayload = {
  tourId: string
  city: string
  countryOrRegion: string
  venue: string | null
  concertDate: string
  startTime: string | null
  endTime: string | null
  title: string | null
  posterUrl: string | null
  description: string | null
  stageType: 'NORMAL' | 'ENCORE' | 'FINAL'
}

export type SetlistContributionPayload = {
  targetShowId: string
  items: ContributionSetlistItem[]
}

export type ContributionPayload = ShowContributionPayload | SetlistContributionPayload

type ParserOptions = {
  requireSongId?: boolean
}

const SETLIST_SECTIONS = ['OPENING', 'MAIN', 'TALK', 'REQUEST', 'ENCORE', 'SPECIAL', 'OTHER'] as const
const STAGE_TYPES = ['NORMAL', 'ENCORE', 'FINAL'] as const

function optionalText(value: unknown, maxLength: number) {
  const text = sanitizeText(value, maxLength)
  return text || null
}

function requiredText(value: unknown, maxLength: number) {
  return sanitizeText(value, maxLength)
}

function parseTime(value: unknown) {
  const text = optionalText(value, 5)
  if (!text) return null
  if (!/^\d{1,2}:\d{2}$/.test(text)) return undefined
  const [hours, minutes] = text.split(':').map(Number)
  if (hours > 23 || minutes > 59) return undefined
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseDateKey(value: unknown) {
  const text = requiredText(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !parseLiveDate(text, true)) return undefined
  return text
}

function parseSetlistItem(value: unknown, index: number, options: ParserOptions, forceEncore: boolean): ContributionSetlistItem | { message: string } {
  if (!value || typeof value !== 'object') return { message: `第${index + 1} 行歌单格式无效` }
  const row = value as Record<string, unknown>
  const songId = optionalText(row.songId, 100)
  const displayName = optionalText(row.displayName, 160)
  if (options.requireSongId && !songId) return { message: `第${index + 1} 行必须从曲库选择歌曲` }
  if (!songId && !displayName) return { message: `第${index + 1} 行必须选择歌曲或填写显示名称` }
  const section: ContributionSetlistItem['section'] = SETLIST_SECTIONS.includes(row.section as (typeof SETLIST_SECTIONS)[number])
    ? row.section as ContributionSetlistItem['section']
    : forceEncore ? 'ENCORE' : 'MAIN'
  return {
    songId,
    displayName,
    section,
    versionName: optionalText(row.versionName, 160),
    note: optionalText(row.note, 1000),
    isEncore: forceEncore || row.isEncore === true || section === 'ENCORE',
    isRequest: row.isRequest === true,
    isDebut: row.isDebut === true,
    isGuest: row.isGuest === true,
    isMedley: row.isMedley === true,
    isSpecial: row.isSpecial === true,
  }
}

function parseSetlistPayload(value: unknown, type: 'SETLIST' | 'ENCORE', options: ParserOptions): { payload?: SetlistContributionPayload; message?: string } {
  if (!value || typeof value !== 'object') return { message: '歌单投稿格式无效' }
  const body = value as Record<string, unknown>
  const targetShowId = requiredText(body.targetShowId, 100)
  if (!targetShowId) return { message: '请选择对应演唱会场次' }
  if (!Array.isArray(body.items) || body.items.length === 0) return { message: type === 'ENCORE' ? '请至少添加一首 Encore 歌曲' : '请至少添加一首歌曲' }
  if (body.items.length > 200) return { message: '一次最多提交 200 首歌曲' }
  const items: ContributionSetlistItem[] = []
  for (let index = 0; index < body.items.length; index += 1) {
    const parsed = parseSetlistItem(body.items[index], index, options, type === 'ENCORE')
    if ('message' in parsed) return parsed
    items.push(parsed)
  }
  return { payload: { targetShowId, items } }
}

export function parseContributionPayload(type: ConcertContributionTypeValue, value: unknown, options: ParserOptions = {}): { payload?: ContributionPayload; message?: string } {
  if (type === 'SETLIST' || type === 'ENCORE') return parseSetlistPayload(value, type, options)
  if (!value || typeof value !== 'object') return { message: '场次投稿格式无效' }
  const body = value as Record<string, unknown>
  const tourId = requiredText(body.tourId, 100)
  const city = requiredText(body.city, 100)
  const concertDate = parseDateKey(body.concertDate)
  const startTime = parseTime(body.startTime)
  const endTime = parseTime(body.endTime)
  const stageType = STAGE_TYPES.includes(body.stageType as (typeof STAGE_TYPES)[number]) ? body.stageType as ShowContributionPayload['stageType'] : 'NORMAL'
  if (!tourId) return { message: '请选择所属巡演' }
  if (!city) return { message: '请填写城市' }
  if (!concertDate) return { message: '请填写有效的演出日期' }
  if (startTime === undefined || endTime === undefined) return { message: '演出时间格式无效' }
  return {
    payload: {
      tourId,
      city,
      countryOrRegion: optionalText(body.countryOrRegion, 100) || DEFAULT_CONCERT_COUNTRY,
      venue: optionalText(body.venue, 200),
      concertDate,
      startTime,
      endTime,
      title: optionalText(body.title, 160),
      posterUrl: optionalText(body.posterUrl, 1000),
      description: optionalText(body.description, 20_000),
      stageType,
    },
  }
}

function asInputJson(payload: ContributionPayload): Prisma.InputJsonValue {
  return payload as unknown as Prisma.InputJsonValue
}

function dateBounds(dateKey: string) {
  const start = new Date(`${dateKey}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

type ConcertDb = {
  musicConcert: {
    findMany: (args: Prisma.MusicConcertFindManyArgs) => Promise<unknown[]>
  }
}

export type PotentialDuplicateConcert = {
  id: string
  city: string
  concertDate: Date
  startTime: Date | null
  venue: string | null
  title: string | null
  MusicTour: { name: string }
}

export async function findPotentialDuplicateConcerts(db: ConcertDb, payload: ShowContributionPayload, excludeId?: string): Promise<PotentialDuplicateConcert[]> {
  const { start, end } = dateBounds(payload.concertDate)
  const rows = await db.musicConcert.findMany({
    where: {
      tourId: payload.tourId,
      city: payload.city,
      concertDate: { gte: start, lt: end },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: [{ concertDate: 'asc' }, { startTime: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      city: true,
      concertDate: true,
      startTime: true,
      venue: true,
      title: true,
      MusicTour: { select: { name: true } },
    },
  })
  return rows as PotentialDuplicateConcert[]
}

export async function validateContributionSongs(tx: Prisma.TransactionClient, payload: SetlistContributionPayload) {
  const songIds = [...new Set(payload.items.map((item) => item.songId).filter((id): id is string => Boolean(id)))]
  if (!songIds.length) return null
  const count = await tx.musicSong.count({ where: { id: { in: songIds }, MusicAlbum: { status: 'PUBLISHED' } } })
  return count === songIds.length ? null : '歌单中包含不存在或尚未公开的曲库歌曲，请重新选择'
}

export class ContributionAlreadyProcessedError extends Error {
  constructor() {
    super('该投稿已经处理')
    this.name = 'ContributionAlreadyProcessedError'
  }
}

export class ContributionDuplicateError extends Error {
  constructor(public readonly duplicates: PotentialDuplicateConcert[]) {
    super('似乎已经存在相同场次，请确认后再审核通过')
    this.name = 'ContributionDuplicateError'
  }
}

export class ContributionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContributionValidationError'
  }
}

type ApproveOptions = {
  contributionId: string
  reviewerId: string
  allowDuplicate?: boolean
  payloadOverride?: unknown
}

function contributionNotificationText(type: ConcertContributionTypeValue, approved: boolean) {
  const label = type === 'SHOW' ? '演唱会场次' : type === 'SETLIST' ? '歌单' : 'Encore'
  return approved ? `你提供的${label}已通过审核` : '你提供的演唱会资料未通过审核'
}

function contributionNotificationKey(id: string, approved: boolean) {
  return `concert-contribution:${id}:${approved ? 'approved' : 'rejected'}`
}

async function normalizeTourConcerts(tx: Prisma.TransactionClient, tourId: string) {
  const concerts = await tx.musicConcert.findMany({
    where: { tourId },
    select: { id: true, city: true, stageType: true, concertDate: true, startTime: true, endTime: true, createdAt: true, sortOrder: true },
  })
  for (const sequence of buildConcertSequenceUpdates(concerts)) {
    await tx.musicConcert.update({ where: { id: sequence.id }, data: { sessionNumber: sequence.sessionNumber, sortOrder: sequence.sortOrder } })
  }
}

function formalSetlistRows(payload: SetlistContributionPayload, concertId: string) {
  return cloneSetlistItems(payload.items.map((item, index) => ({ ...item, position: index + 1 })), concertId)
}

export async function approveConcertContribution({ contributionId, reviewerId, allowDuplicate = false, payloadOverride }: ApproveOptions) {
  return prismaTransaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`ConcertContribution\` WHERE \`id\` = ${contributionId} FOR UPDATE`
    const current = await tx.concertContribution.findUnique({
      where: { id: contributionId },
      include: { submitter: { select: { id: true, uid: true, nickname: true } } },
    })
    if (!current || current.status !== 'PENDING') throw new ContributionAlreadyProcessedError()

    const type = current.type as ConcertContributionTypeValue
    const parsed = parseContributionPayload(type, payloadOverride ?? current.payload, { requireSongId: false })
    if (!parsed.payload) throw new ContributionValidationError(parsed.message || '投稿内容无效')
    const payload = parsed.payload

    const claimed = await tx.concertContribution.updateMany({
      where: { id: contributionId, status: 'PENDING' },
      data: { status: 'APPROVED', reviewerId, reviewedAt: new Date(), payload: asInputJson(payload) },
    })
    if (claimed.count !== 1) throw new ContributionAlreadyProcessedError()

    let showId: string
    let showPath: string
    if (type === 'SHOW') {
      const showPayload = payload as ShowContributionPayload
      const duplicates = await findPotentialDuplicateConcerts(tx, showPayload)
      if (duplicates.length && !allowDuplicate) throw new ContributionDuplicateError(duplicates)
      const tour = await tx.musicTour.findUnique({ where: { id: showPayload.tourId }, select: { id: true, name: true } })
      if (!tour) throw new ContributionValidationError('所属巡演不存在')
      const concertDate = parseLiveDate(showPayload.concertDate, true)
      if (!concertDate) throw new ContributionValidationError('演出日期无效')
      const created = await tx.musicConcert.create({
        data: {
          tourId: showPayload.tourId,
          title: showPayload.title || `${showPayload.city}站`,
          concertDate,
          startTime: combineDateAndTime(concertDate, showPayload.startTime),
          endTime: combineDateAndTime(concertDate, showPayload.endTime),
          city: showPayload.city,
          countryOrRegion: showPayload.countryOrRegion || DEFAULT_CONCERT_COUNTRY,
          stageType: showPayload.stageType,
          venue: showPayload.venue,
          posterUrl: toPublicMediaUrl(showPayload.posterUrl) || null,
          description: showPayload.description,
          status: 'PUBLISHED',
          sortOrder: 0,
          contributorUserId: current.submitterId,
          contributionId,
        },
      })
      await normalizeTourConcerts(tx, showPayload.tourId)
      showId = created.id
      showPath = buildConcertSlugPath(tour.name, created.city, created.concertDate, created.stageType)
      await tx.concertContribution.update({ where: { id: contributionId }, data: { targetShowId: created.id } })
    } else {
      const setlistPayload = payload as SetlistContributionPayload
      const target = await tx.musicConcert.findUnique({
        where: { id: setlistPayload.targetShowId },
        select: {
          id: true,
          city: true,
          concertDate: true,
          stageType: true,
          tourId: true,
          setlistContributorUserId: true,
          setlistContributionId: true,
          encoreContributorUserId: true,
          encoreContributionId: true,
          MusicTour: { select: { name: true } },
        },
      })
      if (!target) throw new ContributionValidationError('对应演唱会场次不存在')
      const songError = await validateContributionSongs(tx, setlistPayload)
      if (songError) throw new ContributionValidationError(songError)
      const rows = formalSetlistRows(type === 'ENCORE' ? { ...setlistPayload, items: setlistPayload.items.map((item) => ({ ...item, isEncore: true, section: 'ENCORE' })) } : setlistPayload, target.id)
      if (type === 'SETLIST') {
        await tx.musicConcertSetlistItem.deleteMany({ where: { concertId: target.id } })
        if (rows.length) await tx.musicConcertSetlistItem.createMany({ data: rows })
        const hasEncore = rows.some((row) => row.isEncore)
        await tx.musicConcert.update({
          where: { id: target.id },
          data: {
            setlistContributorUserId: target.setlistContributorUserId || current.submitterId,
            setlistContributionId: target.setlistContributionId || contributionId,
            encoreContributorUserId: hasEncore ? (target.encoreContributorUserId || current.submitterId) : null,
            encoreContributionId: hasEncore ? (target.encoreContributionId || contributionId) : null,
          },
        })
      } else {
        await tx.musicConcertSetlistItem.deleteMany({ where: { concertId: target.id, isEncore: true } })
        if (rows.length) await tx.musicConcertSetlistItem.createMany({ data: rows })
        await tx.musicConcert.update({
          where: { id: target.id },
          data: {
            encoreContributorUserId: target.encoreContributorUserId || current.submitterId,
            encoreContributionId: target.encoreContributionId || contributionId,
          },
        })
      }
      showId = target.id
      showPath = buildConcertSlugPath(target.MusicTour.name, target.city, target.concertDate, target.stageType)
      await tx.concertContribution.update({ where: { id: contributionId }, data: { targetShowId: target.id } })
    }

    await tx.notification.upsert({
      where: { recipientId_key: { recipientId: current.submitterId, key: contributionNotificationKey(contributionId, true) } },
      create: {
        recipientId: current.submitterId,
        type: 'SYSTEM',
        title: contributionNotificationText(type, true),
        content: '资料已经进入 Eason in Concert 正式数据体系。',
        link: showPath,
        key: contributionNotificationKey(contributionId, true),
      },
      update: { title: contributionNotificationText(type, true), content: '资料已经进入 Eason in Concert 正式数据体系。', link: showPath, isRead: false, readAt: null },
    })

    return { id: contributionId, type, showId, showPath }
  })
}

type TransactionCallback<T> = (tx: Prisma.TransactionClient) => Promise<T>

// Kept as a tiny indirection so every publishing path visibly uses the shared Prisma transaction API.
async function prismaTransaction<T>(callback: TransactionCallback<T>) {
  return prisma.$transaction(callback)
}

export async function rejectConcertContribution(contributionId: string, reviewerId: string, reviewNote: string) {
  return prismaTransaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`ConcertContribution\` WHERE \`id\` = ${contributionId} FOR UPDATE`
    const current = await tx.concertContribution.findUnique({ where: { id: contributionId }, select: { id: true, type: true, submitterId: true, status: true } })
    if (!current || current.status !== 'PENDING') throw new ContributionAlreadyProcessedError()
    const rejected = await tx.concertContribution.updateMany({
      where: { id: contributionId, status: 'PENDING' },
      data: { status: 'REJECTED', reviewerId, reviewedAt: new Date(), reviewNote: sanitizeText(reviewNote, 2000) || null },
    })
    if (rejected.count !== 1) throw new ContributionAlreadyProcessedError()
    const content = sanitizeText(reviewNote, 2000)
    await tx.notification.upsert({
      where: { recipientId_key: { recipientId: current.submitterId, key: contributionNotificationKey(contributionId, false) } },
      create: {
        recipientId: current.submitterId,
        type: 'SYSTEM',
        title: contributionNotificationText(current.type as ConcertContributionTypeValue, false),
        content: content ? `审核原因：${content}` : '请在“我的投稿”中查看审核结果。',
        link: `/music/concerts/contribute?submission=${encodeURIComponent(contributionId)}`,
        key: contributionNotificationKey(contributionId, false),
      },
      update: { content: content ? `审核原因：${content}` : '请在“我的投稿”中查看审核结果。', isRead: false, readAt: null },
    })
    return { id: contributionId, type: current.type as ConcertContributionTypeValue }
  })
}

export function contributionTypeLabel(type: string) {
  return CONTRIBUTION_TYPE_LABELS[type as ConcertContributionTypeValue] || type
}

export function contributionStatusLabel(status: string) {
  return CONTRIBUTION_STATUS_LABELS[status as ConcertContributionStatusValue] || status
}
