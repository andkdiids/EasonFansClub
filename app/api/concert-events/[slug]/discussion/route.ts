import { NextResponse } from 'next/server'
import { checkBannedWords } from '@/lib/content-moderation'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicImageUrl } from '@/lib/images'
import {
  CONCERT_DISCUSSION_PAGE_SIZE,
  concertDiscussionScopeWhere,
  matchesConcertDiscussionIdempotency,
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
}, viewerId: string | null = null) {
  return {
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
    images: comment.images.map((image) => ({ id: image.id, url: publicImageUrl(image.url) })).filter((image) => image.url),
    author: {
      displayName: getPublicUserDisplayName(comment.author),
      avatarUrl: publicImageUrl(comment.author.Profile?.avatarUrl || comment.author.avatarUrl),
    },
    canDelete: Boolean(viewerId && comment.author.id === viewerId),
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const { slug } = await params
  const search = new URL(request.url).searchParams
  const showId = search.get('showId')
  const cursor = search.get('cursor')
  if (cursor && cursor.length > 191) return NextResponse.json({ message: '分页位置无效' }, { status: 400 })
  const limitValue = Number(search.get('limit') || CONCERT_DISCUSSION_PAGE_SIZE)
  const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(CONCERT_DISCUSSION_PAGE_SIZE, limitValue)) : CONCERT_DISCUSSION_PAGE_SIZE

  try {
    const scope = await resolveDiscussionScope(slug, showId, false)
    if (!scope) return NextResponse.json({ message: '讨论区不存在或暂不开放' }, { status: 404 })
    const where = {
      ...concertDiscussionScopeWhere(scope.eventId, scope.showId),
      isDeleted: false,
      moderationStatus: 'NORMAL' as const,
      author: publicAuthorWhere,
    }
    if (cursor) {
      const cursorRow = await prisma.concertDiscussionComment.findFirst({ where: { ...where, id: cursor }, select: { id: true } })
      if (!cursorRow) return NextResponse.json({ message: '分页位置已失效，请刷新讨论区' }, { status: 400 })
    }
    const rows = await prisma.concertDiscussionComment.findMany({
      where,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        content: true,
        createdAt: true,
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
        author: { select: discussionAuthorSelect },
      },
    })
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    return NextResponse.json({ comments: page.map((comment) => serializeComment(comment, auth.user?.id ?? null)), nextCursor: hasMore ? page.at(-1)?.id ?? null : null }, {
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
      authorId: auth.user.id,
      requestId: parsed.value.requestId,
      content: parsed.value.content,
      images: { create: parsed.value.imageUrls.map((url, sortOrder) => ({ url, sortOrder })) },
    }
    let comment
    let duplicate = false
    try {
      comment = await prisma.concertDiscussionComment.create({
        data,
        select: {
          id: true,
          content: true,
          createdAt: true,
          images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
          author: { select: discussionAuthorSelect },
        },
      })
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error
      const existing = await prisma.concertDiscussionComment.findUnique({
        where: { authorId_requestId: { authorId: auth.user.id, requestId: parsed.value.requestId } },
        select: {
          id: true,
          eventId: true,
          showId: true,
          content: true,
          createdAt: true,
          isDeleted: true,
          images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, sortOrder: true } },
          author: { select: discussionAuthorSelect },
        },
      })
      if (!existing || existing.isDeleted || !matchesConcertDiscussionIdempotency(existing, parsed.value, scope.eventId, scope.showId)) {
        return NextResponse.json({ message: '该提交编号已使用，请重新提交' }, { status: 409 })
      }
      comment = existing
      duplicate = true
    }

    return NextResponse.json({ comment: serializeComment(comment, auth.user.id), duplicate }, {
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
