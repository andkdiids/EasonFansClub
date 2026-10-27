import { NextResponse } from 'next/server'
import { checkBannedWords } from '@/lib/content-moderation'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicImageUrl } from '@/lib/images'
import {
  CONCERT_DISCUSSION_PAGE_SIZE,
  concertDiscussionScopeWhere,
  matchesConcertDiscussionIdempotency,
  parseConcertDiscussionPage,
  parseConcertDiscussionInput,
} from '@/lib/concert-discussion'
import { publicConcertEventStatuses, safeEventSlug } from '@/lib/concert-events'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, resolveRequestAuth, unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

const discussionAuthorSelect = {
  id: true,
  status: true,
  isDeleted: true,
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true } },
} as const

type DiscussionAuthor = {
  id: string
  status: string
  isDeleted: boolean
  nickname: string
  nicknameModerationStatus: string
  nicknameViolationDisplay: string | null
  avatarUrl: string | null
  Profile: { avatarUrl: string | null } | null
}

const publicAuthorWhere = { is: { status: 'ACTIVE' as const, isDeleted: false } }

async function resolveDiscussionScope(slugValue: string, showIdValue: string | null, writable: boolean) {
  const slug = safeEventSlug(slugValue)
  if (!slug || (showIdValue !== null && (!showIdValue.trim() || showIdValue.length > 191))) return null
  const statuses = writable ? ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING'] as const : publicConcertEventStatuses
  const event = await prisma.concertEvent.findFirst({
    where: { slug, status: { in: [...statuses] }, allowDiscussion: true },
    select: { id: true },
  })
  if (!event) return null
  const showId = showIdValue?.trim() || null
  if (showId) {
    const show = await prisma.concertShow.findFirst({ where: { id: showId, eventId: event.id, status: 'SCHEDULED' }, select: { id: true } })
    if (!show) return null
  }
  return { eventId: event.id, showId }
}

function serializeComment(comment: {
  id: string
  content: string
  createdAt: Date
  images: Array<{ id: string; url: string; sortOrder: number }>
  author: { id: string; nickname: string; nicknameModerationStatus: string; nicknameViolationDisplay: string | null; avatarUrl: string | null; Profile: { avatarUrl: string | null } | null }
}, viewerId: string | null = null, replyCount = 0, replyToAuthor?: {
  id: string
  nickname: string
  nicknameModerationStatus: string
  nicknameViolationDisplay: string | null
  avatarUrl: string | null
  Profile: { avatarUrl: string | null } | null
} | null) {
  return {
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
    images: comment.images.map((image) => ({ id: image.id, url: publicImageUrl(image.url) })).filter((image) => image.url),
    author: {
      displayName: getPublicUserDisplayName(comment.author),
      avatarUrl: publicImageUrl(comment.author.Profile?.avatarUrl || comment.author.avatarUrl),
    },
    replyCount,
    replyTo: replyToAuthor && replyToAuthor.id !== comment.author.id
      ? { displayName: getPublicUserDisplayName(replyToAuthor) }
      : null,
    canDelete: Boolean(viewerId && comment.author.id === viewerId),
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const { slug } = await params
  const search = new URL(request.url).searchParams
  const showId = search.get('showId')
  const page = parseConcertDiscussionPage(search.get('page'))
  const parentCommentId = search.get('parentCommentId')
  if (page === null) return NextResponse.json({ message: '页码无效' }, { status: 400 })
  if (parentCommentId !== null && (!parentCommentId.trim() || parentCommentId.length > 191)) {
    return NextResponse.json({ message: '回复对象无效' }, { status: 400 })
  }

  try {
    const scope = await resolveDiscussionScope(slug, showId, false)
    if (!scope) return NextResponse.json({ message: '讨论区不存在或暂不开放' }, { status: 404 })
    const where = {
      ...concertDiscussionScopeWhere(scope.eventId, scope.showId),
      isDeleted: false,
      moderationStatus: 'NORMAL' as const,
      author: publicAuthorWhere,
    }
    let parentAuthor: DiscussionAuthor | null = null
    if (parentCommentId) {
      const parent = await prisma.concertDiscussionComment.findFirst({
        where: { ...where, id: parentCommentId, parentCommentId: null },
        select: { id: true, author: { select: discussionAuthorSelect } },
      })
      if (!parent) return NextResponse.json({ message: '回复所属的讨论不存在或已不可见' }, { status: 404 })
      parentAuthor = parent.author
    }
    const pageWhere = { ...where, parentCommentId: parentCommentId || null }
    const total = await prisma.concertDiscussionComment.count({ where: pageWhere })
    const totalPages = Math.max(1, Math.ceil(total / CONCERT_DISCUSSION_PAGE_SIZE))
    const resolvedPage = Math.min(page, totalPages)
    const rows = await prisma.concertDiscussionComment.findMany({
      where: pageWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (resolvedPage - 1) * CONCERT_DISCUSSION_PAGE_SIZE,
      take: CONCERT_DISCUSSION_PAGE_SIZE,
      select: {
        id: true,
        content: true,
        createdAt: true,
        authorId: true,
        parentCommentId: true,
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
        author: { select: discussionAuthorSelect },
        parentComment: { select: { id: true, author: { select: discussionAuthorSelect } } },
      },
    })
    let replyCounts = new Map<string, number>()
    if (!parentCommentId && rows.length) {
      const grouped = await prisma.concertDiscussionComment.groupBy({
        by: ['parentCommentId'],
        where: {
          ...where,
          parentCommentId: { in: rows.map((row) => row.id) },
        },
        _count: { _all: true },
      })
      replyCounts = new Map(grouped.filter((row) => row.parentCommentId).map((row) => [row.parentCommentId as string, row._count._all]))
    }
    return NextResponse.json({
      comments: rows.map((comment) => serializeComment(
        comment,
        auth.user?.id ?? null,
        replyCounts.get(comment.id) || 0,
        comment.parentComment?.author || parentAuthor,
      )),
      page: resolvedPage,
      pageSize: CONCERT_DISCUSSION_PAGE_SIZE,
      total,
      totalPages,
      parentCommentId,
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[concert-discussion.read]', {
      slug: safeEventSlug(slug) || 'invalid',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    })
    return NextResponse.json({ message: '讨论暂时无法加载，请稍后重试' }, { status: 503 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  if (!auth.user) return unauthenticatedResponse('登录后可以参与专题讨论')
  const limited = await enforceApiRateLimit(request, auth.user.id, {
    endpoint: '/api/concert-events/discussion',
    ip: { limit: 20, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
  }, '评论过于频繁，请稍后再试')
  if (limited) return limited

  const { slug } = await params
  const showId = new URL(request.url).searchParams.get('showId')
  const body = await request.json().catch(() => null)
  const parsed = parseConcertDiscussionInput(body, auth.user.id)
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 })

  try {
    const scope = await resolveDiscussionScope(slug, showId, true)
    if (!scope) return NextResponse.json({ message: '讨论区不存在或暂不开放发言' }, { status: 404 })
    if (parsed.value.content && (await checkBannedWords(parsed.value.content)).blocked) {
      return NextResponse.json({ error: 'CONTENT_CONTAINS_BANNED_WORD', message: '评论内容包含不适宜词语，请修改后再提交' }, { status: 400 })
    }

    const data = {
      eventId: scope.eventId,
      showId: scope.showId,
      parentCommentId: parsed.value.parentCommentId,
      authorId: auth.user.id,
      requestId: parsed.value.requestId,
      content: parsed.value.content,
      images: { create: parsed.value.imageUrls.map((url, sortOrder) => ({ url, sortOrder })) },
    }
    let comment
    let replyToAuthor: DiscussionAuthor | null = null
    let duplicate = false
    try {
      const result = await prisma.$transaction(async (tx) => {
        if (parsed.value.parentCommentId) {
          const lockedParents = await tx.$queryRaw<Array<{ id: string; eventId: string; showId: string | null; parentCommentId: string | null; isDeleted: boolean; moderationStatus: string }>>`
            SELECT id, eventId, showId, parentCommentId, isDeleted, moderationStatus
            FROM ConcertDiscussionComment
            WHERE id = ${parsed.value.parentCommentId}
            FOR UPDATE
          `
          const locked = lockedParents[0]
          if (!locked || locked.eventId !== scope.eventId || locked.showId !== scope.showId
            || locked.parentCommentId !== null || locked.isDeleted || locked.moderationStatus !== 'NORMAL') {
            return null
          }
          const parent = await tx.concertDiscussionComment.findFirst({
            where: { ...concertDiscussionScopeWhere(scope.eventId, scope.showId), id: locked.id, parentCommentId: null, isDeleted: false, moderationStatus: 'NORMAL', author: publicAuthorWhere },
            select: { author: { select: discussionAuthorSelect } },
          })
          if (!parent) return null
          replyToAuthor = parent.author
        }
        const created = await tx.concertDiscussionComment.create({
          data,
          select: {
            id: true,
            content: true,
            createdAt: true,
            authorId: true,
            parentCommentId: true,
            images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
            author: { select: discussionAuthorSelect },
          },
        })
        return created
      })
      if (!result) return NextResponse.json({ message: '回复所属的讨论已不可回复，请刷新后重试' }, { status: 409 })
      comment = result
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error
      const existing = await prisma.concertDiscussionComment.findUnique({
        where: { authorId_requestId: { authorId: auth.user.id, requestId: parsed.value.requestId } },
        select: {
          id: true,
          eventId: true,
          showId: true,
          parentCommentId: true,
          content: true,
          createdAt: true,
          isDeleted: true,
          images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
          author: { select: discussionAuthorSelect },
          parentComment: { select: { isDeleted: true, moderationStatus: true, author: { select: discussionAuthorSelect } } },
        },
      })
      if (!existing || existing.isDeleted || !matchesConcertDiscussionIdempotency(existing, parsed.value, scope.eventId, scope.showId)) {
        return NextResponse.json({ message: '该提交编号已使用，请重新提交' }, { status: 409 })
      }
      if (existing.parentCommentId && (!existing.parentComment || existing.parentComment.isDeleted || existing.parentComment.moderationStatus !== 'NORMAL')) {
        return NextResponse.json({ message: '回复所属的讨论已不可见，请刷新后重试' }, { status: 409 })
      }
      replyToAuthor = existing.parentComment?.author || null
      comment = existing
      duplicate = true
    }

    return NextResponse.json({ comment: serializeComment(comment, auth.user.id, 0, replyToAuthor), duplicate }, {
      status: duplicate ? 200 : 201,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[concert-discussion.create]', {
      userId: auth.user.id,
      slug: safeEventSlug(slug) || 'invalid',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    })
    return NextResponse.json({ message: '评论发布失败，请稍后重试' }, { status: 503 })
  }
}
