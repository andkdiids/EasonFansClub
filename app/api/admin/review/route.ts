import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { PATCH as patchPostReview } from '@/app/api/admin/posts/review/route'
import { PATCH as patchSalonReview } from '@/app/api/admin/salon/route'
import { PATCH as patchStudioReview } from '@/app/api/admin/studio/projects/route'
import { PATCH as patchStickerReview } from '@/app/api/admin/stickers/[id]/route'
import { PATCH as patchTodayReview } from '@/app/api/admin/today/[eventId]/route'
import { DELETE as deleteSalonPost } from '@/app/api/salon/posts/[postId]/route'
import { DELETE as deleteTodayEvent } from '@/app/api/admin/today/[eventId]/route'
import { contributionTypeLabel, ContributionAlreadyProcessedError, approveConcertContribution, rejectConcertContribution } from '@/lib/music-contributions'
import { getStudioTool } from '@/lib/studio/tools'
import { getTodayEventDateKey } from '@/lib/today'
import { getForumBoardDisplayName, mergeForumBoardOptions } from '@/lib/boards'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { postContentPlainText } from '@/lib/share-metadata'
import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { getSalonEditReviewPostIds } from '@/lib/salon-review-notifications'
import { requireAdmin, sanitizeText } from '@/lib/security'
import {
  canApplyReviewDecision,
  parseReviewStatus,
  parseReviewSourceType,
  reviewSalonCategoryLabel,
  reviewSourceDefinitions,
  type ReviewDecision,
  type ReviewItem,
  type ReviewMedia,
  type ReviewSourceDefinition,
  type ReviewSourceType,
  type ReviewStatus,
} from '@/lib/review-center'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 40
const reviewStatuses: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

function asIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function summary(value: unknown, max = 240) {
  const normalized = text(value).replace(/\s+/g, ' ')
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

function author(input: { id?: string | null; uid?: number | null; nickname?: string | null; displayName?: string | null }) {
  return {
    id: input.id || null,
    uid: typeof input.uid === 'number' ? input.uid : null,
    name: text(input.displayName) || text(input.nickname) || 'E院用户',
  }
}

function itemActions(type: ReviewSourceType, status: ReviewStatus, id: string): ReviewItem['actions'] {
  return {
    approve: canApplyReviewDecision(status, 'APPROVE'),
    reject: canApplyReviewDecision(status, 'REJECT'),
    edit: type === 'SALON' || type === 'TODAY' || (type === 'CONCERT' && status === 'PENDING'),
    delete: type === 'SALON' || type === 'TODAY',
    editUrl: type === 'SALON'
      ? `/admin/salon?postId=${encodeURIComponent(id)}`
      : type === 'TODAY'
        ? '/admin/today'
        : type === 'CONCERT' && status === 'PENDING'
          ? `/admin/music/concerts/contributions?submission=${encodeURIComponent(id)}`
          : null,
  }
}

function buildItem(input: Omit<ReviewItem, 'actions'>): ReviewItem {
  return { ...input, actions: itemActions(input.sourceType, input.status, input.sourceId) }
}

function reviewMedia(id: string, value: string | null | undefined, alt: string): ReviewMedia[] {
  const src = publicImageUrl(value)
  return src ? [{ id, src, alt }] : []
}

function numericKeyword(keyword: string) {
  return /^\d+$/.test(keyword) ? Number(keyword) : null
}

function postWhere(status: ReviewStatus | 'ALL', keyword: string): Prisma.PostWhereInput {
  const uid = numericKeyword(keyword)
  return {
    isDeleted: false,
    moderationStatus: status === 'ALL' ? { in: reviewStatuses } : status,
    ...(keyword ? {
      OR: [
        { id: keyword },
        { title: { contains: keyword } },
        { content: { contains: keyword } },
        { User: { nickname: { contains: keyword } } },
        ...(uid === null ? [] : [{ User: { uid } }]),
      ],
    } : {}),
  }
}

function salonWhere(status: ReviewStatus | 'ALL', keyword: string): Prisma.SalonPostWhereInput {
  const uid = numericKeyword(keyword)
  return {
    status: status === 'ALL' ? { in: reviewStatuses } : status,
    ...(keyword ? {
      OR: [
        { id: keyword },
        { title: { contains: keyword } },
        { content: { contains: keyword } },
        { author: { nickname: { contains: keyword } } },
        ...(uid === null ? [] : [{ author: { uid } }]),
      ],
    } : {}),
  }
}

function studioWhere(status: ReviewStatus | 'ALL', keyword: string): Prisma.StudioProjectWhereInput {
  const uid = numericKeyword(keyword)
  return {
    reviewStatus: status === 'ALL' ? { in: reviewStatuses } : status,
    ...(keyword ? {
      OR: [
        { id: keyword },
        { title: { contains: keyword } },
        { description: { contains: keyword } },
        { User: { nickname: { contains: keyword } } },
        ...(uid === null ? [] : [{ User: { uid } }]),
      ],
    } : {}),
  }
}

function stickerWhere(status: ReviewStatus | 'ALL', keyword: string): Prisma.StickerPackWhereInput {
  const uid = numericKeyword(keyword)
  return {
    status: status === 'ALL' ? { in: reviewStatuses } : status,
    ...(keyword ? {
      OR: [
        { id: keyword },
        { name: { contains: keyword } },
        { description: { contains: keyword } },
        { creator: { nickname: { contains: keyword } } },
        ...(uid === null ? [] : [{ creator: { uid } }]),
      ],
    } : {}),
  }
}

function contributionWhere(status: ReviewStatus | 'ALL', keyword: string): Prisma.ConcertContributionWhereInput {
  const uid = numericKeyword(keyword)
  return {
    status: status === 'ALL' ? { in: reviewStatuses } : status,
    ...(keyword ? {
      OR: [
        { id: keyword },
        { submitter: { nickname: { contains: keyword } } },
        ...(uid === null ? [] : [{ submitter: { uid } }]),
      ],
    } : {}),
  }
}

function todayWhere(status: ReviewStatus | 'ALL', keyword: string): Prisma.TodayEventWhereInput {
  const uid = numericKeyword(keyword)
  return {
    status: status === 'ALL' ? { in: reviewStatuses } : status,
    ...(keyword ? {
      OR: [
        { id: keyword },
        { title: { contains: keyword } },
        { content: { contains: keyword } },
        { SubmittedBy: { nickname: { contains: keyword } } },
        ...(uid === null ? [] : [{ SubmittedBy: { uid } }]),
      ],
    } : {}),
  }
}

function withTargetId<T>(where: T, targetId: string | null): T {
  return targetId ? ({ AND: [where, { id: targetId }] } as T) : where
}

async function loadTypeItems(type: ReviewSourceType, status: ReviewStatus | 'ALL', keyword: string, take: number, targetId: string | null = null): Promise<ReviewItem[]> {
  if (type === 'POST') {
    const [rows, boardRows] = await Promise.all([
      prisma.post.findMany({
        where: withTargetId(postWhere(status, targetId ? '' : keyword), targetId),
        orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
        take,
        select: {
          id: true, boardId: true, title: true, content: true, richContent: true, summary: true, createdAt: true,
          moderationStatus: true, reviewedAt: true, rejectionReason: true,
          User: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
          ReviewedBy: { select: { id: true, uid: true, nickname: true } },
          Board: { select: { name: true, slug: true } },
          PostMedia: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, thumbnail: true } },
        },
      }),
      prisma.board.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, slug: true },
      }),
    ])
    const boardOptions = mergeForumBoardOptions(boardRows).map((board) => ({
      id: board.id,
      name: getForumBoardDisplayName(board),
      slug: board.slug,
    }))
    return rows.map((row) => buildItem({
      id: row.id, sourceType: 'POST', sourceId: row.id, title: row.title,
      author: author({ id: row.User.id, uid: row.User.uid, nickname: row.User.nickname, displayName: row.User.Profile?.displayName }), authorId: row.User.id,
      createdAt: row.createdAt.toISOString(), status: row.moderationStatus as ReviewStatus,
      cover: publicImageUrl(row.PostMedia[0]?.thumbnail || row.PostMedia[0]?.url),
      media: row.PostMedia.flatMap((media, index) => {
        const src = publicImageUrl(media.url)
        if (!src) return []
        return [{ id: media.id, src, previewSrc: publicImageUrl(media.thumbnail) || undefined, alt: `帖子图片 ${index + 1}` }]
      }),
      postDetails: {
        boardId: row.boardId,
        boardName: getForumBoardDisplayName(row.Board),
        boards: boardOptions.some((board) => board.id === row.boardId)
          ? boardOptions
          : [{ id: row.boardId, name: getForumBoardDisplayName(row.Board), slug: row.Board.slug }, ...boardOptions],
      },
      summary: summary(postContentPlainText(row.content, row.richContent) || row.summary), category: getForumBoardDisplayName(row.Board) || null, relatedEntity: '社区帖子',
      reviewer: row.ReviewedBy ? author({ id: row.ReviewedBy.id, uid: row.ReviewedBy.uid, nickname: row.ReviewedBy.nickname }) : null, reviewedAt: asIso(row.reviewedAt), rejectReason: row.rejectionReason,
    }))
  }

  if (type === 'SALON') {
    const rows = await prisma.salonPost.findMany({
      where: withTargetId(salonWhere(status, targetId ? '' : keyword), targetId), orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }], take,
      select: {
        id: true, title: true, content: true, category: true, status: true, rejectReason: true, createdAt: true, updatedAt: true, approvedAt: true,
        author: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
        approvedBy: { select: { id: true, uid: true, nickname: true } },
        concert: { select: { title: true, city: true, MusicTour: { select: { name: true } } } },
        media: { orderBy: { sortOrder: 'asc' }, select: { id: true, previewUrl: true, thumbnailUrl: true } },
      },
    })
    const editPostIds = await getSalonEditReviewPostIds(rows.map((row) => row.id))
    return rows.map((row) => buildItem({
      id: row.id, sourceType: 'SALON', sourceId: row.id, reviewKind: editPostIds.has(row.id) ? 'EDIT' : 'CREATE', title: row.title || '无标题作品',
      author: author({ id: row.author.id, uid: row.author.uid, nickname: row.author.nickname, displayName: row.author.Profile?.displayName }), authorId: row.author.id,
      createdAt: row.createdAt.toISOString(), status: row.status as ReviewStatus,
      cover: publicImageUrl(row.media[0]?.thumbnailUrl || row.media[0]?.previewUrl), summary: summary(row.content), category: reviewSalonCategoryLabel(row.category), relatedEntity: row.concert ? `${row.concert.MusicTour.name} · ${row.concert.city}${row.concert.title ? ` · ${row.concert.title}` : ''}` : null,
      media: row.media.flatMap((media, index) => {
        const src = publicImageUrl(media.previewUrl || media.thumbnailUrl)
        if (!src) return []
        return [{ id: `${row.id}:${index}`, src, previewSrc: publicImageUrl(media.thumbnailUrl) || undefined, alt: `沙龙图片 ${index + 1}` }]
      }),
      reviewer: row.approvedBy ? author({ id: row.approvedBy.id, uid: row.approvedBy.uid, nickname: row.approvedBy.nickname }) : null, reviewedAt: asIso(row.approvedAt), rejectReason: row.rejectReason,
    }))
  }

  if (type === 'CREATION') {
    const rows = await prisma.studioProject.findMany({
      where: withTargetId(studioWhere(status, targetId ? '' : keyword), targetId), orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }], take,
      select: { id: true, toolSlug: true, title: true, description: true, thumbnailUrl: true, reviewStatus: true, createdAt: true, updatedAt: true, User: { select: { id: true, uid: true, nickname: true } } },
    })
    return rows.map((row) => buildItem({
      id: row.id, sourceType: 'CREATION', sourceId: row.id, title: row.title || '未命名作品',
      author: author({ id: row.User.id, uid: row.User.uid, nickname: row.User.nickname }), authorId: row.User.id,
      createdAt: row.createdAt.toISOString(), status: row.reviewStatus as ReviewStatus, cover: publicImageUrl(row.thumbnailUrl), media: reviewMedia(`${row.id}:thumbnail`, row.thumbnailUrl, `${row.title || '创作作品'}缩略图`), summary: summary(row.description), category: getStudioTool(row.toolSlug)?.name || '创作项目', relatedEntity: row.toolSlug,
      reviewer: null, reviewedAt: row.reviewStatus === 'PENDING' ? null : row.updatedAt.toISOString(), rejectReason: null,
    }))
  }

  if (type === 'STICKER') {
    const rows = await prisma.stickerPack.findMany({
      where: withTargetId(stickerWhere(status, targetId ? '' : keyword), targetId), orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }], take,
      select: { id: true, name: true, description: true, coverUrl: true, status: true, rejectionReason: true, reviewedAt: true, createdAt: true, creator: { select: { id: true, uid: true, nickname: true } } },
    })
    return rows.map((row) => buildItem({
      id: row.id, sourceType: 'STICKER', sourceId: row.id, title: row.name,
      author: author({ id: row.creator.id, uid: row.creator.uid, nickname: row.creator.nickname }), authorId: row.creator.id,
      createdAt: row.createdAt.toISOString(), status: row.status as ReviewStatus, cover: publicImageUrl(row.coverUrl), media: reviewMedia(`${row.id}:cover`, row.coverUrl, `${row.name}封面`), summary: summary(row.description), category: '表情包合集', relatedEntity: null,
      reviewer: null, reviewedAt: asIso(row.reviewedAt), rejectReason: row.rejectionReason,
    }))
  }

  if (type === 'CONCERT') {
    const rows = await prisma.concertContribution.findMany({
      where: withTargetId(contributionWhere(status, targetId ? '' : keyword), targetId), orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }], take,
      select: { id: true, type: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true, submitter: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } } }, reviewer: { select: { id: true, uid: true, nickname: true } }, targetShow: { select: { city: true, title: true, MusicTour: { select: { name: true } } } } },
    })
    return rows.map((row) => buildItem({
      id: row.id, sourceType: 'CONCERT', sourceId: row.id, title: `${contributionTypeLabel(row.type)}投稿`,
      author: author({ id: row.submitter.id, uid: row.submitter.uid, nickname: row.submitter.nickname, displayName: row.submitter.Profile?.displayName }), authorId: row.submitter.id,
      createdAt: row.createdAt.toISOString(), status: row.status as ReviewStatus, cover: null, summary: row.targetShow ? `${row.targetShow.MusicTour.name} · ${row.targetShow.city}` : '待绑定演唱会场次', category: contributionTypeLabel(row.type), relatedEntity: row.targetShow?.title || null,
      reviewer: row.reviewer ? author({ id: row.reviewer.id, uid: row.reviewer.uid, nickname: row.reviewer.nickname }) : null, reviewedAt: asIso(row.reviewedAt), rejectReason: row.reviewNote,
    }))
  }

  const rows = await prisma.todayEvent.findMany({
    where: withTargetId(todayWhere(status, targetId ? '' : keyword), targetId), orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }], take,
    select: { id: true, title: true, content: true, imageUrl: true, type: true, status: true, rejectionReason: true, reviewedAt: true, createdAt: true, date: true, month: true, day: true, SubmittedBy: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } } }, ReviewedBy: { select: { id: true, uid: true, nickname: true } } },
  })
  return rows.map((row) => buildItem({
    id: row.id, sourceType: 'TODAY', sourceId: row.id, title: row.title,
    author: row.SubmittedBy ? author({ id: row.SubmittedBy.id, uid: row.SubmittedBy.uid, nickname: row.SubmittedBy.nickname, displayName: row.SubmittedBy.Profile?.displayName }) : author({}), authorId: row.SubmittedBy?.id || null,
    createdAt: row.createdAt.toISOString(), status: row.status as ReviewStatus, cover: publicImageUrl(row.imageUrl), media: reviewMedia(`${row.id}:image`, row.imageUrl, `${row.title}图片`), summary: summary(row.content), category: row.type, relatedEntity: getTodayEventDateKey(row.date, row.month, row.day),
    reviewer: row.ReviewedBy ? author({ id: row.ReviewedBy.id, uid: row.ReviewedBy.uid, nickname: row.ReviewedBy.nickname }) : null, reviewedAt: asIso(row.reviewedAt), rejectReason: row.rejectionReason,
  }))
}

async function countType(type: ReviewSourceType, status: ReviewStatus | 'ALL', keyword: string) {
  if (type === 'POST') return prisma.post.count({ where: postWhere(status, keyword) })
  if (type === 'SALON') return prisma.salonPost.count({ where: salonWhere(status, keyword) })
  if (type === 'CREATION') return prisma.studioProject.count({ where: studioWhere(status, keyword) })
  if (type === 'STICKER') return prisma.stickerPack.count({ where: stickerWhere(status, keyword) })
  if (type === 'CONCERT') return prisma.concertContribution.count({ where: contributionWhere(status, keyword) })
  return prisma.todayEvent.count({ where: todayWhere(status, keyword) })
}

async function accessibleDefinitions(user: Parameters<typeof hasAdminPermission>[0]) {
  const access = await Promise.all(reviewSourceDefinitions.map(async (definition) => ({ definition, allowed: await hasAdminPermission(user, definition.permission) })))
  return access.filter((item) => item.allowed).map((item) => item.definition)
}

export async function GET(request: Request) {
  const guard = await requireAdmin()
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const sourceType = parseReviewSourceType(params.get('type'))
  const statusParam = params.get('status')
  const status = parseReviewStatus(statusParam)
  const keyword = sanitizeText(params.get('keyword'), 80).trim()
  const targetId = sanitizeText(params.get('targetId') || params.get('sourceId') || params.get('reviewId'), 200).trim() || null
  const rawPage = Number(params.get('page') || '1')
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const definitions = await accessibleDefinitions(guard.user)
  const selected = sourceType === 'ALL' ? definitions : definitions.filter((item) => item.type === sourceType)
  const prefetchSize = Math.max(PAGE_SIZE * 3, PAGE_SIZE * page)
  // The normal queue is always loaded from the requested type/status/page.
  // A notification target is supplemental metadata only: it can tell the
  // client which status tab to use, but it must never replace the queue with
  // a target-only query.
  const [batches, targetBatches, countRows] = await Promise.all([
    Promise.all(selected.map((definition) => loadTypeItems(definition.type, status, keyword, prefetchSize))),
    targetId
      ? Promise.all(selected.map((definition) => loadTypeItems(definition.type, 'ALL', keyword, 1, targetId)))
      : Promise.resolve([] as ReviewItem[][]),
    Promise.all(definitions.map(async (definition) => {
      const [total, pending, approved, rejected] = await Promise.all([
        countType(definition.type, 'ALL', keyword), countType(definition.type, 'PENDING', keyword), countType(definition.type, 'APPROVED', keyword), countType(definition.type, 'REJECTED', keyword),
      ])
      return { type: definition.type, label: definition.label, total, pending, approved, rejected }
    })),
  ])
  const allItems = batches.flat().sort((a, b) => (Date.parse(b.reviewedAt || b.createdAt) || 0) - (Date.parse(a.reviewedAt || a.createdAt) || 0))
  // Counts are database counts, not the bounded list batch. This keeps the
  // status totals and pagination truthful even when a queue exceeds the
  // adapter's bounded prefetch window.
  const scopedCounts = countRows.filter((row) => selected.some((definition) => definition.type === row.type))
  const targetItem = targetBatches.flat().find((item) => item.sourceId === targetId) || null
  const total = scopedCounts.reduce((sum, row) => sum + row[status.toLowerCase() as 'pending' | 'approved' | 'rejected'], 0)
  const start = (page - 1) * PAGE_SIZE
  const items = allItems.slice(start, start + PAGE_SIZE)
  return NextResponse.json({
    items,
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: start + PAGE_SIZE < total,
    targetId,
    targetFound: targetId ? Boolean(targetItem) : undefined,
    targetStatus: targetItem?.status,
    type: sourceType,
    status,
    keyword,
    types: countRows,
    counts: {
      total: scopedCounts.reduce((sum, row) => sum + row.total, 0),
      pending: scopedCounts.reduce((sum, row) => sum + row.pending, 0),
      approved: scopedCounts.reduce((sum, row) => sum + row.approved, 0),
      rejected: scopedCounts.reduce((sum, row) => sum + row.rejected, 0),
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

function delegatedRequest(request: Request, body: Record<string, unknown>, method = 'PATCH') {
  const headers = new Headers()
  for (const key of ['cookie', 'origin', 'referer', 'user-agent', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) {
    const value = request.headers.get(key)
    if (value) headers.set(key, value)
  }
  if (method !== 'DELETE') headers.set('content-type', 'application/json')
  return new Request(request.url, { method, headers, ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }) })
}

async function delegate(request: Request, body: Record<string, unknown>, handler: unknown, context?: unknown, method = 'PATCH') {
  const invoke = handler as (request: Request, context?: unknown) => Promise<Response>
  const response = await invoke(delegatedRequest(request, body, method), context)
  const data = await response.json().catch(() => ({ message: '审核操作失败，请刷新后重试' }))
  return NextResponse.json(data, { status: response.status })
}

async function performConcertDecision(sourceId: string, decision: ReviewDecision, reason: string, reviewerId: string) {
  if (decision === 'APPROVE') {
    try {
      return await approveConcertContribution({ contributionId: sourceId, reviewerId })
    } catch (error) {
      if (error instanceof ContributionAlreadyProcessedError) {
        throw Object.assign(new Error(error.currentStatus === 'REJECTED' ? 'REVIEW_CONFLICT_REJECT_WINS' : 'ALREADY_REVIEWED'), { code: error.currentStatus === 'REJECTED' ? 'REVIEW_CONFLICT_REJECT_WINS' : 'ALREADY_REVIEWED' })
      }
      throw error
    }
  }
  try {
    return await rejectConcertContribution(sourceId, reviewerId, reason)
  } catch (error) {
    if (error instanceof ContributionAlreadyProcessedError) throw Object.assign(new Error('ALREADY_REVIEWED'), { code: 'ALREADY_REVIEWED' })
    throw error
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const sourceType = parseReviewSourceType(body?.sourceType)
  const sourceId = sanitizeText(body?.sourceId, 191).trim()
  const postBoardId = typeof body?.boardId === 'string' ? sanitizeText(body.boardId, 80).trim() : ''
  const decision = body?.decision === 'APPROVE' || body?.decision === 'REJECT' ? body.decision as ReviewDecision : null
  const reason = sanitizeText(body?.rejectReason ?? body?.rejectionReason, 2000).trim()
  if (sourceType === 'ALL' || !sourceId || !decision) return NextResponse.json({ ok: false, code: 'INVALID_REVIEW_ACTION', message: '审核操作无效' }, { status: 400 })
  if (decision === 'REJECT' && !reason) return NextResponse.json({ ok: false, code: 'REJECTION_REASON_REQUIRED', message: '拒绝时必须填写原因' }, { status: 400 })
  const definition = reviewSourceDefinitions.find((item) => item.type === sourceType) as ReviewSourceDefinition | undefined
  if (!definition || !await hasAdminPermission(guard.user, definition.permission)) return NextResponse.json({ ok: false, code: 'FORBIDDEN', message: '当前管理员未获得此审核权限' }, { status: 403 })

  try {
    if (sourceType === 'POST') return delegate(request, { postId: sourceId, status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', rejectionReason: reason || null, ...(postBoardId ? { boardId: postBoardId } : {}) }, patchPostReview)
    if (sourceType === 'SALON') return delegate(request, { postId: sourceId, action: decision === 'APPROVE' ? 'approve' : 'reject', rejectReason: reason }, patchSalonReview)
    if (sourceType === 'CREATION') return delegate(request, { projectId: sourceId, reviewStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' }, patchStudioReview)
    if (sourceType === 'STICKER') return delegate(request, { action: decision === 'APPROVE' ? 'approve' : 'reject', rejectionReason: reason }, patchStickerReview, { params: Promise.resolve({ id: sourceId }) })
    if (sourceType === 'TODAY') return delegate(request, { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', rejectionReason: reason }, patchTodayReview, { params: Promise.resolve({ eventId: sourceId }) })
    const result = await performConcertDecision(sourceId, decision, reason, guard.user.id)
    return NextResponse.json({ ok: true, sourceType, sourceId, decision, result })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code === 'REVIEW_CONFLICT_REJECT_WINS') return NextResponse.json({ ok: false, code, message: '该内容已被拒绝，无法再次通过' }, { status: 409 })
    if (code === 'ALREADY_REVIEWED') return NextResponse.json({ ok: false, code, message: '该内容已被其他管理员处理，请刷新后查看最新状态' }, { status: 409 })
    console.error('[admin.review.center.action]', { sourceType, sourceId, decision, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ ok: false, code: 'REVIEW_ACTION_FAILED', message: '审核操作失败，请刷新后重试' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAdmin()
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const sourceType = parseReviewSourceType(params.get('sourceType') || params.get('type'))
  const sourceId = sanitizeText(params.get('sourceId') || params.get('id'), 191).trim()
  const definition = reviewSourceDefinitions.find((item) => item.type === sourceType) as ReviewSourceDefinition | undefined
  if (!definition || !sourceId || !await hasAdminPermission(guard.user, definition.permission)) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN', message: '当前管理员未获得此审核权限' }, { status: 403 })
  }
  try {
    if (sourceType === 'SALON') return delegate(request, {}, deleteSalonPost, { params: Promise.resolve({ postId: sourceId }) }, 'DELETE')
    if (sourceType === 'TODAY') return delegate(request, {}, deleteTodayEvent, { params: Promise.resolve({ eventId: sourceId }) }, 'DELETE')
    return NextResponse.json({ ok: false, code: 'ACTION_NOT_SUPPORTED', message: '该审核类型不支持删除操作' }, { status: 409 })
  } catch (error) {
    console.error('[admin.review.center.delete]', { sourceType, sourceId, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ ok: false, code: 'DELETE_FAILED', message: '删除失败，请刷新后重试' }, { status: 500 })
  }
}
