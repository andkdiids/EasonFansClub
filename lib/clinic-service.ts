import { randomInt } from 'node:crypto'
import { Prisma, type ClinicCategory, type ClinicContentStatus, type ClinicIdentityMode, type ClinicNeedType, type ReportStatus } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { getShanghaiDayRange } from '@/lib/checkin'
import { getClinicCategoryOption, getClinicNeedLabel, clinicAnonymousName, CLINIC_CONSULTATION_MAX_LENGTH, CLINIC_CONSULTATION_RATE_LIMIT_SECONDS, CLINIC_PAGE_SIZE, CLINIC_RECORD_DAILY_LIMIT, CLINIC_RECORD_MAX_LENGTH, CLINIC_RECORD_RATE_LIMIT_SECONDS, type ClinicSort } from '@/lib/clinic-config'
import { checkClinicModeration, clinicModerationStorageValue, maskClinicTextWithWords } from '@/lib/clinic-moderation'
import { getEnabledBannedWords, type ModerationWord } from '@/lib/content-moderation'
import { publicImageUrl, profileImageUrl } from '@/lib/images'
import { toPublicMediaUrl } from '@/lib/media-url'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { emitRealtime } from '@/lib/realtime'
import { consumeRateLimit, sanitizeText } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { safeNotificationWrite } from '@/lib/notification-transaction'

const clinicAuthorSelect = {
  id: true,
  uid: true,
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: {
    select: {
      displayName: true,
      displayNameModerationStatus: true,
      avatarUrl: true,
    },
  },
  EquippedBadge: { select: { id: true, code: true, name: true, iconUrl: true, isEnabled: true, isActive: true, effectType: true, nicknameEffect: true, nicknameColor: true, nicknameGradientStart: true, nicknameGradientEnd: true, rarity: true } },
} as const

type ClinicAuthorRow = {
  id: string
  uid: number
  nickname: string
  nicknameModerationStatus: string
  avatarUrl: string | null
  Profile: {
    displayName: string | null
    displayNameModerationStatus: string
    avatarUrl: string | null
  } | null
  EquippedBadge: {
    id: string
    code: string
    name: string
    iconUrl: string | null
    isEnabled: boolean
    isActive: boolean
    effectType: EquippedBadgeView['effectType']
    nicknameEffect: EquippedBadgeView['nicknameEffect']
    nicknameColor: string | null
    nicknameGradientStart: string | null
    nicknameGradientEnd: string | null
    rarity: EquippedBadgeView['rarity']
  } | null
}

export class ClinicServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'ClinicServiceError'
  }
}

export type ClinicPublicIdentity =
  | {
      type: 'anonymous'
      displayName: string
      avatarKind: 'clinic-anonymous'
      canOpenProfile: false
    }
  | {
      type: 'public'
      displayName: string
      uid: number
      avatarUrl: string | null
      equippedBadge: EquippedBadgeView | null
      profileUrl: string
      canOpenProfile: true
    }

export type ClinicPublicConsultation = {
  id: string
  recordId: string
  content: string
  author: ClinicPublicIdentity | null
  createdAt: string
  parentId: string | null
  aspirinCount: number
  mouthpieceCount: number
  viewerHasAspirin: boolean
  viewerHasMouthpiece: boolean
  canDelete: boolean
  isDeleted: boolean
  replies: ClinicPublicConsultation[]
}

export type ClinicPublicRecord = {
  id: string
  content: string
  category: ClinicCategory
  categoryLabel: string
  categoryDescription: string
  needType: ClinicNeedType
  needLabel: string
  author: ClinicPublicIdentity
  aspirinCount: number
  consultationCount: number
  mouthpieceCount: number
  viewerHasAspirin: boolean
  canDelete: boolean
  createdAt: string
  updatedAt: string
  bestMouthpiece: { content: string; mouthpieceCount: number } | null
}

export type ClinicPublicRecordDetail = ClinicPublicRecord & {
  consultations: ClinicPublicConsultation[]
}

function publicIdentity(author: ClinicAuthorRow, mode: ClinicIdentityMode, anonymousNumber: number, role: 'patient' | 'doctor') : ClinicPublicIdentity {
  if (mode === 'ANONYMOUS') {
    return {
      type: 'anonymous',
      displayName: clinicAnonymousName(anonymousNumber, role),
      avatarKind: 'clinic-anonymous',
      canOpenProfile: false,
    }
  }

  const displayName = getPublicUserDisplayName(author)
  const avatarUrl = profileImageUrl(author.Profile?.avatarUrl || author.avatarUrl) || publicImageUrl(author.Profile?.avatarUrl || author.avatarUrl)
  const equippedBadge = author.EquippedBadge && author.EquippedBadge.isEnabled && author.EquippedBadge.isActive
    ? {
        id: author.EquippedBadge.id,
        code: author.EquippedBadge.code,
        name: author.EquippedBadge.name,
        imageUrl: toPublicMediaUrl(author.EquippedBadge.iconUrl),
        effectType: author.EquippedBadge.effectType,
        nicknameEffect: author.EquippedBadge.nicknameEffect,
        nicknameColor: author.EquippedBadge.nicknameColor,
        nicknameGradientStart: author.EquippedBadge.nicknameGradientStart,
        nicknameGradientEnd: author.EquippedBadge.nicknameGradientEnd,
        rarity: author.EquippedBadge.rarity,
      } satisfies EquippedBadgeView
    : null
  return {
    type: 'public',
    displayName,
    uid: author.uid,
    avatarUrl,
    equippedBadge,
    profileUrl: `/user/${author.uid}`,
    canOpenProfile: true,
  }
}

function publicDate(value: Date) {
  return value.toISOString()
}

function publicContent(value: string, words: ModerationWord[]) {
  // The raw body never leaves the service layer. Masking is intentionally
  // applied immediately before the public DTO is built.
  return maskClinicTextWithWords(value, words)
}

function cleanClinicContent(value: unknown, maxLength: number, label = '内容') {
  // Ask sanitizeText for one extra character so oversized requests are
  // rejected instead of silently truncated before validation.
  const content = sanitizeText(value, maxLength + 1)
  if (content.length > maxLength) {
    throw new ClinicServiceError('CONTENT_TOO_LONG', `${label}不能超过 ${maxLength} 个字符。`)
  }
  if (content.replace(/\s/gu, '').length < 2) {
    throw new ClinicServiceError('CONTENT_TOO_SHORT', `${label}至少需要 2 个有效字符。`)
  }
  return content
}

function randomAnonymousNumber() {
  return randomInt(100, 10000)
}

function clinicSortOrder(sort: ClinicSort) {
  if (sort === 'consultations') return [{ consultationCount: 'desc' as const }, { createdAt: 'desc' as const }]
  if (sort === 'aspirin') return [{ aspirinCount: 'desc' as const }, { createdAt: 'desc' as const }]
  return [{ createdAt: 'desc' as const }]
}

function activeClinicWhere(category?: ClinicCategory): Prisma.ClinicRecordWhereInput {
  return {
    status: 'ACTIVE',
    ...(category ? { category } : {}),
  }
}

function isPrismaCode(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

async function clinicRateLimit(userId: string, action: string, limit: number, seconds: number) {
  const result = await consumeRateLimit(`user:${userId}`, action, limit, seconds)
  if (result.limited) {
    throw new ClinicServiceError('RATE_LIMITED', '操作太快了，请稍后再试。', 429)
  }
}

export async function createClinicRecord(input: {
  authorId: string
  content: unknown
  category: ClinicCategory
  needType: ClinicNeedType
  identityMode: ClinicIdentityMode
}) {
  const content = cleanClinicContent(input.content, CLINIC_RECORD_MAX_LENGTH)
  const moderation = await checkClinicModeration(content)
  if (moderation.blocked) {
    throw new ClinicServiceError('STRICT_BANNED_WORD', '内容包含严格违禁词，请修改后再提交。')
  }
  await clinicRateLimit(input.authorId, 'clinic:record', 1, CLINIC_RECORD_RATE_LIMIT_SECONDS)
  const { start, end } = getShanghaiDayRange()
  const todayCount = await prisma.clinicRecord.count({
    where: { authorId: input.authorId, createdAt: { gte: start, lt: end } },
  })
  if (todayCount >= CLINIC_RECORD_DAILY_LIMIT) {
    throw new ClinicServiceError('DAILY_LIMIT', `今日最多可以挂号 ${CLINIC_RECORD_DAILY_LIMIT} 次。`, 429)
  }

  const record = await prisma.clinicRecord.create({
    data: {
      authorId: input.authorId,
      content,
      category: input.category,
      needType: input.needType,
      identityMode: input.identityMode,
      anonymousNumber: randomAnonymousNumber(),
      matchedBannedWords: clinicModerationStorageValue(moderation),
    },
    select: { id: true },
  })
  return record
}

type ClinicConsultationCreateResult = { id: string; notifiedUserId: string | null }

export async function createClinicConsultation(input: {
  authorId: string
  recordId: string
  content: unknown
  identityMode: ClinicIdentityMode
  parentId?: string | null
}): Promise<ClinicConsultationCreateResult> {
  const content = cleanClinicContent(input.content, CLINIC_CONSULTATION_MAX_LENGTH, '会诊内容')
  const moderation = await checkClinicModeration(content)
  if (moderation.blocked) {
    throw new ClinicServiceError('STRICT_BANNED_WORD', '内容包含严格违禁词，请修改后再提交。')
  }
  const notificationContent = maskClinicTextWithWords(content, await getEnabledBannedWords()).slice(0, 120)

  await clinicRateLimit(input.authorId, 'clinic:consultation', 1, CLINIC_CONSULTATION_RATE_LIMIT_SECONDS)
  let notificationData: Prisma.NotificationCreateArgs | null = null
  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.clinicRecord.findFirst({
      where: { id: input.recordId, status: 'ACTIVE' },
      select: { id: true, authorId: true },
    })
    if (!record) throw new ClinicServiceError('RECORD_NOT_FOUND', '这份病历不存在或已经不再公开。', 404)

    let parent: { id: string; authorId: string; parentId: string | null } | null = null
    if (input.parentId) {
      parent = await tx.clinicConsultation.findFirst({
        where: { id: input.parentId, recordId: input.recordId, status: 'ACTIVE' },
        select: { id: true, authorId: true, parentId: true },
      })
      if (!parent) throw new ClinicServiceError('PARENT_NOT_FOUND', '这条会诊不存在或已经被删除。', 400)
      if (parent.parentId) throw new ClinicServiceError('NESTING_TOO_DEEP', '门诊部只支持顶层会诊下的一级回复。', 400)
    }

    let anonymousNumber = randomAnonymousNumber()
    if (input.identityMode === 'ANONYMOUS') {
      const previous = await tx.clinicConsultation.findFirst({
        where: { recordId: input.recordId, authorId: input.authorId, identityMode: 'ANONYMOUS' },
        orderBy: { createdAt: 'asc' },
        select: { anonymousNumber: true },
      })
      if (previous) anonymousNumber = previous.anonymousNumber
    }

    const created = await tx.clinicConsultation.create({
      data: {
        recordId: input.recordId,
        authorId: input.authorId,
        content,
        identityMode: input.identityMode,
        anonymousNumber,
        parentId: parent?.id || null,
        matchedBannedWords: clinicModerationStorageValue(moderation),
      },
      select: { id: true, authorId: true },
    })

    await tx.clinicRecord.update({
      where: { id: input.recordId },
      data: { consultationCount: { increment: 1 } },
    })

    const recipientId = (parent?.authorId || record.authorId)
    let notifiedUserId: string | null = null
    if (recipientId !== input.authorId) {
      notifiedUserId = recipientId
      notificationData = {
        data: {
          recipientId,
          // Do not store the anonymous actor in a public notification payload.
          actorId: null,
          type: 'REPLY',
          title: parent ? '有病友回复了你的会诊' : '有病友参与了你的会诊',
          content: notificationContent,
          link: `/clinic/${input.recordId}?focus=${created.id}`,
          key: `clinic-consultation:${created.id}:${recipientId}`,
        },
      }
    }

    return { id: created.id, notifiedUserId }
  }, { timeout: 15_000, maxWait: 5_000 })

  const committedNotificationData = notificationData as Prisma.NotificationCreateArgs | null
  if (committedNotificationData) {
    await safeNotificationWrite(
      () => prisma.notification.create(committedNotificationData),
      { operation: 'clinic-consultation-created', userId: committedNotificationData.data.recipientId, notificationType: 'REPLY' },
    )
  }
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return result
}

export async function listPublicClinicRecords(input: {
  page?: number
  pageSize?: number
  category?: ClinicCategory
  sort?: ClinicSort
  viewerId?: string | null
  authorId?: string
}) {
  const page = Math.max(1, input.page || 1)
  const pageSize = Math.min(Math.max(1, input.pageSize || CLINIC_PAGE_SIZE), 50)
  const where: Prisma.ClinicRecordWhereInput = {
    ...activeClinicWhere(input.category),
    ...(input.authorId ? { authorId: input.authorId } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.clinicRecord.count({ where }),
    prisma.clinicRecord.findMany({
      where,
      orderBy: clinicSortOrder(input.sort || 'latest'),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        content: true,
        category: true,
        needType: true,
        identityMode: true,
        anonymousNumber: true,
        aspirinCount: true,
        consultationCount: true,
        mouthpieceCount: true,
        createdAt: true,
        updatedAt: true,
        author: { select: clinicAuthorSelect },
        consultations: {
          where: { status: 'ACTIVE', parentId: null },
          orderBy: [{ mouthpieceCount: 'desc' }, { createdAt: 'asc' }],
          take: 1,
          select: { content: true, mouthpieceCount: true },
        },
      },
    }),
  ])
  const recordIds = rows.map((row) => row.id)
  const aspirinRows = input.viewerId && recordIds.length
    ? await prisma.clinicAspirin.findMany({
        where: { userId: input.viewerId, recordId: { in: recordIds } },
        select: { recordId: true },
      })
    : []
  const aspirinIds = new Set(aspirinRows.map((row) => row.recordId).filter((value): value is string => Boolean(value)))
  const publicWords = await getEnabledBannedWords()

  return {
    items: rows.map((row) => toPublicRecord(row, input.viewerId || null, aspirinIds, publicWords)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

function toPublicRecord(
  row: {
    id: string
    content: string
    category: ClinicCategory
    needType: ClinicNeedType
    identityMode: ClinicIdentityMode
    anonymousNumber: number
    aspirinCount: number
    consultationCount: number
    mouthpieceCount: number
    createdAt: Date
    updatedAt: Date
    author: ClinicAuthorRow
    consultations: Array<{ content: string; mouthpieceCount: number }>
  },
  viewerId: string | null,
  aspirinIds: Set<string>,
  publicWords: ModerationWord[],
): ClinicPublicRecord {
  const category = getClinicCategoryOption(row.category)
  const best = row.consultations[0]
  return {
    id: row.id,
    content: publicContent(row.content, publicWords),
    category: row.category,
    categoryLabel: category.label,
    categoryDescription: category.description,
    needType: row.needType,
    needLabel: getClinicNeedLabel(row.needType),
    author: publicIdentity(row.author, row.identityMode, row.anonymousNumber, 'patient'),
    aspirinCount: row.aspirinCount,
    consultationCount: row.consultationCount,
    mouthpieceCount: row.mouthpieceCount,
    viewerHasAspirin: aspirinIds.has(row.id),
    canDelete: Boolean(viewerId && row.author.id === viewerId),
    createdAt: publicDate(row.createdAt),
    updatedAt: publicDate(row.updatedAt),
    bestMouthpiece: best ? { content: publicContent(best.content, publicWords), mouthpieceCount: best.mouthpieceCount } : null,
  }
}

type ClinicConsultationRow = {
  id: string
  recordId: string
  authorId: string
  content: string
  identityMode: ClinicIdentityMode
  anonymousNumber: number
  parentId: string | null
  aspirinCount: number
  mouthpieceCount: number
  status: ClinicContentStatus
  createdAt: Date
  author: ClinicAuthorRow
}

function toPublicConsultation(
  row: ClinicConsultationRow,
  viewerId: string | null,
  aspirinIds: Set<string>,
  mouthpieceIds: Set<string>,
  publicWords: ModerationWord[],
): ClinicPublicConsultation {
  const isDeleted = row.status !== 'ACTIVE'
  return {
    id: row.id,
    recordId: row.recordId,
    content: isDeleted ? '这条会诊已被删除。' : publicContent(row.content, publicWords),
    author: isDeleted ? null : publicIdentity(row.author, row.identityMode, row.anonymousNumber, 'doctor'),
    createdAt: publicDate(row.createdAt),
    parentId: row.parentId,
    aspirinCount: row.aspirinCount,
    mouthpieceCount: row.mouthpieceCount,
    viewerHasAspirin: aspirinIds.has(row.id),
    viewerHasMouthpiece: mouthpieceIds.has(row.id),
    canDelete: Boolean(viewerId && row.authorId === viewerId && !isDeleted),
    isDeleted,
    replies: [],
  }
}

function buildConsultationTree(rows: ClinicConsultationRow[], viewerId: string | null, aspirinIds: Set<string>, mouthpieceIds: Set<string>, publicWords: ModerationWord[]) {
  const mapped = new Map(rows.map((row) => [row.id, toPublicConsultation(row, viewerId, aspirinIds, mouthpieceIds, publicWords)]))
  const roots: ClinicPublicConsultation[] = []
  for (const row of rows) {
    const item = mapped.get(row.id)
    if (!item) continue
    const parent = row.parentId ? mapped.get(row.parentId) : null
    if (parent) parent.replies.push(item)
    else roots.push(item)
  }
  return roots
}

export async function getPublicClinicRecordDetail(recordId: string, viewerId?: string | null): Promise<ClinicPublicRecordDetail | { unavailable: true; status: ClinicContentStatus } | null> {
  const row = await prisma.clinicRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      status: true,
      content: true,
      category: true,
      needType: true,
      identityMode: true,
      anonymousNumber: true,
      aspirinCount: true,
      consultationCount: true,
      mouthpieceCount: true,
      createdAt: true,
      updatedAt: true,
      author: { select: clinicAuthorSelect },
      consultations: {
        where: { status: { in: ['ACTIVE', 'HIDDEN', 'DELETED', 'REMOVED'] } },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: {
          id: true,
          recordId: true,
          authorId: true,
          content: true,
          identityMode: true,
          anonymousNumber: true,
          parentId: true,
          aspirinCount: true,
          mouthpieceCount: true,
          status: true,
          createdAt: true,
          author: { select: clinicAuthorSelect },
        },
      },
    },
  })
  if (!row) return null
  if (row.status !== 'ACTIVE') return { unavailable: true, status: row.status }

  const consultationIds = row.consultations.map((item) => item.id)
  const [recordAspirin, aspirinRows, mouthpieceRows, publicWords] = viewerId
    ? await Promise.all([
        prisma.clinicAspirin.findFirst({ where: { userId: viewerId, recordId }, select: { id: true } }),
        consultationIds.length ? prisma.clinicAspirin.findMany({ where: { userId: viewerId, consultationId: { in: consultationIds } }, select: { consultationId: true } }) : Promise.resolve([]),
        consultationIds.length ? prisma.clinicMouthpiece.findMany({ where: { userId: viewerId, consultationId: { in: consultationIds } }, select: { consultationId: true } }) : Promise.resolve([]),
        getEnabledBannedWords(),
      ])
    : [null, [], [], await getEnabledBannedWords()]
  const aspirinIds = new Set(aspirinRows.map((item) => item.consultationId).filter((value): value is string => Boolean(value)))
  const mouthpieceIds = new Set(mouthpieceRows.map((item) => item.consultationId))
  const category = getClinicCategoryOption(row.category)
  const bestMouthpieceRow = row.consultations
    .filter((item) => item.status === 'ACTIVE' && item.parentId === null)
    .sort((left, right) => right.mouthpieceCount - left.mouthpieceCount || left.createdAt.getTime() - right.createdAt.getTime())[0]
  const record = {
    id: row.id,
    content: publicContent(row.content, publicWords),
    category: row.category,
    categoryLabel: category.label,
    categoryDescription: category.description,
    needType: row.needType,
    needLabel: getClinicNeedLabel(row.needType),
    author: publicIdentity(row.author, row.identityMode, row.anonymousNumber, 'patient'),
    aspirinCount: row.aspirinCount,
    consultationCount: row.consultationCount,
    mouthpieceCount: row.mouthpieceCount,
    viewerHasAspirin: Boolean(recordAspirin),
    canDelete: Boolean(viewerId && row.author.id === viewerId),
    createdAt: publicDate(row.createdAt),
    updatedAt: publicDate(row.updatedAt),
    bestMouthpiece: bestMouthpieceRow
      ? { content: publicContent(bestMouthpieceRow.content, publicWords), mouthpieceCount: bestMouthpieceRow.mouthpieceCount }
      : null,
  } satisfies ClinicPublicRecord
  return {
    ...record,
    consultations: buildConsultationTree(row.consultations as ClinicConsultationRow[], viewerId || null, aspirinIds, mouthpieceIds, publicWords),
  }
}

export async function removeClinicRecord(recordId: string, userId: string, canManage = false) {
  const record = await prisma.clinicRecord.findUnique({ where: { id: recordId }, select: { id: true, authorId: true, status: true } })
  if (!record) throw new ClinicServiceError('RECORD_NOT_FOUND', '这份病历不存在。', 404)
  if (!canManage && record.authorId !== userId) throw new ClinicServiceError('FORBIDDEN', '你只能烧掉自己的病历。', 403)
  if (record.status === 'DELETED' || record.status === 'REMOVED') return
  await prisma.$transaction([
    prisma.clinicRecord.update({ where: { id: recordId }, data: { status: canManage ? 'REMOVED' : 'DELETED', deletedAt: new Date() } }),
    prisma.clinicConsultation.updateMany({ where: { recordId, status: 'ACTIVE' }, data: { status: canManage ? 'REMOVED' : 'DELETED', deletedAt: new Date() } }),
  ])
}

export async function removeClinicConsultation(consultationId: string, userId: string, canManage = false) {
  return prisma.$transaction(async (tx) => {
    const consultation = await tx.clinicConsultation.findUnique({
      where: { id: consultationId },
      select: { id: true, recordId: true, authorId: true, status: true, mouthpieceCount: true },
    })
    if (!consultation) throw new ClinicServiceError('CONSULTATION_NOT_FOUND', '这条会诊不存在。', 404)
    if (!canManage && consultation.authorId !== userId) throw new ClinicServiceError('FORBIDDEN', '你只能删除自己的会诊。', 403)
    if (consultation.status !== 'ACTIVE') return
    await tx.clinicConsultation.update({ where: { id: consultationId }, data: { status: canManage ? 'REMOVED' : 'DELETED', deletedAt: new Date() } })
    await tx.clinicRecord.updateMany({
      where: { id: consultation.recordId, consultationCount: { gt: 0 } },
      data: {
        consultationCount: { decrement: 1 },
        ...(consultation.mouthpieceCount > 0 ? { mouthpieceCount: { decrement: consultation.mouthpieceCount } } : {}),
      },
    })
  })
}

export async function giveClinicAspirin(input: { userId: string; recordId?: string; consultationId?: string }) {
  if (Boolean(input.recordId) === Boolean(input.consultationId)) throw new ClinicServiceError('INVALID_TARGET', '互动目标不正确。')
  return prisma.$transaction(async (tx) => {
    if (input.recordId) {
      const target = await tx.clinicRecord.findFirst({ where: { id: input.recordId, status: 'ACTIVE' }, select: { id: true } })
      if (!target) throw new ClinicServiceError('RECORD_NOT_FOUND', '这份病历不存在或已经不再公开。', 404)
      try {
        await tx.clinicAspirin.create({ data: { userId: input.userId, recordId: input.recordId } })
      } catch (error) {
        if (isPrismaCode(error, 'P2002')) {
          const current = await tx.clinicRecord.findUnique({ where: { id: input.recordId }, select: { aspirinCount: true } })
          return { active: true, created: false, count: current?.aspirinCount || 0 }
        }
        throw error
      }
      const updated = await tx.clinicRecord.update({ where: { id: input.recordId }, data: { aspirinCount: { increment: 1 } }, select: { aspirinCount: true } })
      return { active: true, created: true, count: updated.aspirinCount }
    }

    const target = await tx.clinicConsultation.findFirst({ where: { id: input.consultationId, status: 'ACTIVE' }, select: { id: true } })
    if (!target) throw new ClinicServiceError('CONSULTATION_NOT_FOUND', '这条会诊不存在或已经被删除。', 404)
    try {
      await tx.clinicAspirin.create({ data: { userId: input.userId, consultationId: input.consultationId } })
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        const current = await tx.clinicConsultation.findUnique({ where: { id: input.consultationId }, select: { aspirinCount: true } })
        return { active: true, created: false, count: current?.aspirinCount || 0 }
      }
      throw error
    }
    const updated = await tx.clinicConsultation.update({ where: { id: input.consultationId }, data: { aspirinCount: { increment: 1 } }, select: { aspirinCount: true } })
    return { active: true, created: true, count: updated.aspirinCount }
  })
}

export async function removeClinicAspirin(input: { userId: string; recordId?: string; consultationId?: string }) {
  if (Boolean(input.recordId) === Boolean(input.consultationId)) throw new ClinicServiceError('INVALID_TARGET', '互动目标不正确。')
  return prisma.$transaction(async (tx) => {
    if (input.recordId) {
      const target = await tx.clinicRecord.findFirst({ where: { id: input.recordId, status: 'ACTIVE' }, select: { id: true, aspirinCount: true } })
      if (!target) throw new ClinicServiceError('RECORD_NOT_FOUND', '这份病历不存在或已经不再公开。', 404)
      const deleted = await tx.clinicAspirin.deleteMany({ where: { userId: input.userId, recordId: input.recordId } })
      if (!deleted.count) return { active: false, removed: false, count: target.aspirinCount }
      const updated = await tx.clinicRecord.updateMany({ where: { id: input.recordId, aspirinCount: { gt: 0 } }, data: { aspirinCount: { decrement: 1 } } })
      const record = await tx.clinicRecord.findUnique({ where: { id: input.recordId }, select: { aspirinCount: true } })
      return { active: false, removed: updated.count > 0, count: record?.aspirinCount || 0 }
    }
    const activeTarget = await tx.clinicConsultation.findFirst({ where: { id: input.consultationId, status: 'ACTIVE' }, select: { id: true, aspirinCount: true } })
    if (!activeTarget) throw new ClinicServiceError('CONSULTATION_NOT_FOUND', '这条会诊不存在或已经被删除。', 404)
    const deleted = await tx.clinicAspirin.deleteMany({ where: { userId: input.userId, consultationId: input.consultationId } })
    if (!deleted.count) return { active: false, removed: false, count: activeTarget.aspirinCount }
    const consultation = await tx.clinicConsultation.findUnique({ where: { id: input.consultationId }, select: { recordId: true } })
    const updated = await tx.clinicConsultation.updateMany({ where: { id: input.consultationId, aspirinCount: { gt: 0 } }, data: { aspirinCount: { decrement: 1 } } })
    const current = await tx.clinicConsultation.findUnique({ where: { id: input.consultationId }, select: { aspirinCount: true } })
    return { active: false, removed: updated.count > 0, count: current?.aspirinCount || 0, recordId: consultation?.recordId || null }
  })
}

export async function giveClinicMouthpiece(userId: string, consultationId: string) {
  return prisma.$transaction(async (tx) => {
    const consultation = await tx.clinicConsultation.findFirst({ where: { id: consultationId, status: 'ACTIVE' }, select: { id: true, recordId: true } })
    if (!consultation) throw new ClinicServiceError('CONSULTATION_NOT_FOUND', '这条会诊不存在或已经被删除。', 404)
    try {
      await tx.clinicMouthpiece.create({ data: { userId, consultationId } })
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) return { active: true, created: false }
      throw error
    }
    const [comment, record] = await Promise.all([
      tx.clinicConsultation.update({ where: { id: consultationId }, data: { mouthpieceCount: { increment: 1 } }, select: { mouthpieceCount: true } }),
      tx.clinicRecord.update({ where: { id: consultation.recordId }, data: { mouthpieceCount: { increment: 1 } }, select: { mouthpieceCount: true } }),
    ])
    return { active: true, created: true, count: comment.mouthpieceCount, recordCount: record.mouthpieceCount }
  })
}

export async function removeClinicMouthpiece(userId: string, consultationId: string) {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.clinicMouthpiece.deleteMany({ where: { userId, consultationId } })
    if (!deleted.count) return { active: false, removed: false }
    const consultation = await tx.clinicConsultation.findUnique({ where: { id: consultationId }, select: { recordId: true } })
    const comment = await tx.clinicConsultation.updateMany({ where: { id: consultationId, mouthpieceCount: { gt: 0 } }, data: { mouthpieceCount: { decrement: 1 } } })
    if (consultation) await tx.clinicRecord.updateMany({ where: { id: consultation.recordId, mouthpieceCount: { gt: 0 } }, data: { mouthpieceCount: { decrement: 1 } } })
    const target = await tx.clinicConsultation.findUnique({ where: { id: consultationId }, select: { mouthpieceCount: true } })
    return { active: false, removed: comment.count > 0, count: target?.mouthpieceCount || 0 }
  })
}

export async function createClinicReport(input: { reporterId: string; recordId?: string; consultationId?: string; reason: string; detail?: string }) {
  if (Boolean(input.recordId) === Boolean(input.consultationId)) throw new ClinicServiceError('INVALID_TARGET', '举报目标不正确。')
  const reason = sanitizeText(input.reason, 80)
  const detail = sanitizeText(input.detail, 500) || null
  if (!reason) throw new ClinicServiceError('INVALID_REASON', '请选择举报原因。')
  if (input.recordId) {
    const target = await prisma.clinicRecord.findFirst({ where: { id: input.recordId, status: 'ACTIVE' }, select: { id: true } })
    if (!target) throw new ClinicServiceError('RECORD_NOT_FOUND', '这份病历不存在或已经不再公开。', 404)
  } else {
    const target = await prisma.clinicConsultation.findFirst({ where: { id: input.consultationId, status: 'ACTIVE' }, select: { id: true } })
    if (!target) throw new ClinicServiceError('CONSULTATION_NOT_FOUND', '这条会诊不存在或已经被删除。', 404)
  }
  return prisma.clinicReport.create({
    data: { reporterId: input.reporterId, recordId: input.recordId || null, consultationId: input.consultationId || null, reason, detail },
    select: { id: true, status: true },
  })
}

export async function getClinicDailyReport(date = new Date()) {
  const { start, end, dateKey } = getShanghaiDayRange(date)
  const where: Prisma.ClinicRecordWhereInput = { status: 'ACTIVE', createdAt: { gte: start, lt: end } }
  const [records, patients, categories, totals] = await Promise.all([
    prisma.clinicRecord.count({ where }),
    prisma.clinicRecord.findMany({ where, distinct: ['authorId'], select: { authorId: true } }),
    prisma.clinicRecord.groupBy({ by: ['category'], where, _count: { _all: true } }),
    prisma.clinicRecord.aggregate({ where, _sum: { aspirinCount: true, consultationCount: true, mouthpieceCount: true } }),
  ])
  const categoryCounts = clinicCategoryOrder(categories.map((row) => ({ category: row.category, count: row._count._all })))
  const topCategory = categoryCounts[0] || null
  return {
    dateKey,
    dateLabel: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(date),
    patientCount: patients.length,
    recordCount: records,
    aspirinCount: totals._sum.aspirinCount || 0,
    consultationCount: totals._sum.consultationCount || 0,
    mouthpieceCount: totals._sum.mouthpieceCount || 0,
    categories: categoryCounts,
    topCategory,
    closing: '今日门诊结束。明天都要继续医。',
  }
}

function clinicCategoryOrder(rows: Array<{ category: ClinicCategory; count: number }>) {
  return rows
    .map((row) => ({ ...row, label: getClinicCategoryOption(row.category).label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
}

export async function getClinicMe(userId: string) {
  const [records, consultations] = await Promise.all([
    prisma.clinicRecord.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        content: true,
        category: true,
        needType: true,
        identityMode: true,
        anonymousNumber: true,
        status: true,
        aspirinCount: true,
        consultationCount: true,
        mouthpieceCount: true,
        createdAt: true,
        updatedAt: true,
        author: { select: clinicAuthorSelect },
        consultations: { where: { status: 'ACTIVE', parentId: null }, orderBy: [{ mouthpieceCount: 'desc' }, { createdAt: 'asc' }], take: 1, select: { content: true, mouthpieceCount: true } },
      },
    }),
    prisma.clinicConsultation.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        recordId: true,
        content: true,
        status: true,
        identityMode: true,
        anonymousNumber: true,
        createdAt: true,
        record: { select: { category: true, content: true, status: true } },
      },
    }),
  ])
  const aspirinIds = new Set<string>()
  const publicWords = await getEnabledBannedWords()
  return {
    records: records.map((row) => {
      const base = toPublicRecord(row, userId, aspirinIds, publicWords)
      if (row.status === 'ACTIVE') return base
      return { ...base, content: row.status === 'DELETED' ? '这份病历已经被患者烧掉了。' : '这份病历暂时无法公开。', canDelete: false }
    }),
    consultations: consultations.map((row) => ({
      id: row.id,
      recordId: row.recordId,
      content: row.status === 'ACTIVE' ? publicContent(row.content, publicWords) : '这条会诊已被删除。',
      category: row.record.category,
      categoryLabel: getClinicCategoryOption(row.record.category).label,
      recordPreview: row.record.status === 'ACTIVE' ? publicContent(row.record.content, publicWords).slice(0, 90) : '病历已不再公开。',
      createdAt: publicDate(row.createdAt),
      isDeleted: row.status !== 'ACTIVE',
      identityMode: row.identityMode,
    })),
  }
}

export type ClinicAdminTab = 'records' | 'reports' | 'consultations'

export async function listClinicAdminData(tab: ClinicAdminTab, page = 1, pageSize = 30) {
  const safePage = Math.max(1, page)
  const safeSize = Math.min(Math.max(1, pageSize), 100)
  if (tab === 'reports') {
    const where: Prisma.ClinicReportWhereInput = {}
    const [total, rows] = await Promise.all([
      prisma.clinicReport.count({ where }),
      prisma.clinicReport.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          reason: true,
          detail: true,
          status: true,
          createdAt: true,
          handledAt: true,
          reporter: { select: { uid: true, nickname: true } },
          record: { select: { id: true, content: true, status: true, identityMode: true, anonymousNumber: true, author: { select: { uid: true, nickname: true } } } },
          consultation: { select: { id: true, recordId: true, content: true, status: true, identityMode: true, anonymousNumber: true, author: { select: { uid: true, nickname: true } } } },
          handledBy: { select: { uid: true, nickname: true } },
        },
      }),
    ])
    return { tab, page: safePage, pageSize: safeSize, total, totalPages: Math.max(1, Math.ceil(total / safeSize)), items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), handledAt: row.handledAt?.toISOString() || null })) }
  }

  if (tab === 'consultations') {
    const [total, rows] = await Promise.all([
      prisma.clinicConsultation.count(),
      prisma.clinicConsultation.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          recordId: true,
          parentId: true,
          content: true,
          identityMode: true,
          anonymousNumber: true,
          status: true,
          aspirinCount: true,
          mouthpieceCount: true,
          createdAt: true,
          author: { select: { id: true, uid: true, nickname: true } },
          record: { select: { category: true, status: true, author: { select: { uid: true, nickname: true } } } },
        },
      }),
    ])
    return { tab, page: safePage, pageSize: safeSize, total, totalPages: Math.max(1, Math.ceil(total / safeSize)), items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), publicDisplayName: clinicAnonymousName(row.anonymousNumber, 'doctor') })) }
  }

  const [total, rows] = await Promise.all([
    prisma.clinicRecord.count(),
    prisma.clinicRecord.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safeSize,
      take: safeSize,
      select: {
        id: true,
        content: true,
        category: true,
        needType: true,
        identityMode: true,
        anonymousNumber: true,
        status: true,
        aspirinCount: true,
        consultationCount: true,
        mouthpieceCount: true,
        createdAt: true,
        author: { select: { id: true, uid: true, nickname: true } },
        _count: { select: { reports: true } },
      },
    }),
  ])
  return {
    tab,
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
    items: rows.map((row) => ({
      ...row,
      categoryLabel: getClinicCategoryOption(row.category).label,
      needLabel: getClinicNeedLabel(row.needType),
      publicDisplayName: clinicAnonymousName(row.anonymousNumber, 'patient'),
      createdAt: row.createdAt.toISOString(),
      reportCount: row._count.reports,
      _count: undefined,
    })),
  }
}

export async function updateClinicAdminContent(input: { target: 'record' | 'consultation'; id: string; status: ClinicContentStatus; adminId: string }) {
  if (input.target === 'record') {
    const record = await prisma.clinicRecord.findUnique({ where: { id: input.id }, select: { id: true } })
    if (!record) throw new ClinicServiceError('RECORD_NOT_FOUND', '病历不存在。', 404)
    const deletedAt = input.status === 'ACTIVE' ? null : new Date()
    await prisma.$transaction([
      prisma.clinicRecord.update({ where: { id: input.id }, data: { status: input.status, deletedAt } }),
      ...(input.status === 'ACTIVE' ? [] : [prisma.clinicConsultation.updateMany({ where: { recordId: input.id, status: 'ACTIVE' }, data: { status: input.status, deletedAt } })]),
    ])
    return
  }
  await prisma.$transaction(async (tx) => {
    const consultation = await tx.clinicConsultation.findUnique({
      where: { id: input.id },
      select: { id: true, recordId: true, status: true, mouthpieceCount: true },
    })
    if (!consultation) throw new ClinicServiceError('CONSULTATION_NOT_FOUND', '会诊不存在。', 404)
    if (consultation.status === input.status) return
    const wasActive = consultation.status === 'ACTIVE'
    const willBeActive = input.status === 'ACTIVE'
    await tx.clinicConsultation.update({
      where: { id: input.id },
      data: { status: input.status, deletedAt: willBeActive ? null : new Date() },
    })
    if (wasActive && !willBeActive) {
      await tx.clinicRecord.updateMany({
        where: { id: consultation.recordId, consultationCount: { gt: 0 } },
        data: {
          consultationCount: { decrement: 1 },
          ...(consultation.mouthpieceCount > 0 ? { mouthpieceCount: { decrement: consultation.mouthpieceCount } } : {}),
        },
      })
    } else if (!wasActive && willBeActive) {
      await tx.clinicRecord.update({
        where: { id: consultation.recordId },
        data: {
          consultationCount: { increment: 1 },
          ...(consultation.mouthpieceCount > 0 ? { mouthpieceCount: { increment: consultation.mouthpieceCount } } : {}),
        },
      })
    }
  })
}

export async function handleClinicReport(input: { reportId: string; status: ReportStatus; adminId: string }) {
  const report = await prisma.clinicReport.findUnique({ where: { id: input.reportId }, select: { id: true } })
  if (!report) throw new ClinicServiceError('REPORT_NOT_FOUND', '举报不存在。', 404)
  return prisma.clinicReport.update({ where: { id: input.reportId }, data: { status: input.status, handledById: input.adminId, handledAt: new Date() }, select: { id: true, status: true } })
}
