import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const reviewSelect = {
  id: true,
  title: true,
  content: true,
  summary: true,
  createdAt: true,
  moderationStatus: true,
  reviewedAt: true,
  rejectionReason: true,
  isPinned: true,
  isFeatured: true,
  User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
  Board: { select: { name: true, slug: true } },
  PostMedia: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, type: true, url: true, thumbnail: true } },
} as const

type ReviewPostRow = Prisma.PostGetPayload<{ select: typeof reviewSelect }>

function serializePost(post: ReviewPostRow) {
  return {
    ...post,
    createdAt: post.createdAt.toISOString(),
    reviewedAt: post.reviewedAt?.toISOString() || null,
    User: { ...post.User, Profile: post.User.Profile ? { ...post.User.Profile, avatarUrl: publicImageUrl(post.User.Profile.avatarUrl) } : null },
    PostMedia: post.PostMedia.map((media) => ({ ...media, url: publicImageUrl(media.url), thumbnail: publicImageUrl(media.thumbnail) })),
  }
}

function isModerationStatus(value: unknown): value is 'PENDING' | 'APPROVED' | 'REJECTED' {
  return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED'
}

export async function GET(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const rawStatus = new URL(request.url).searchParams.get('status')
  const status = isModerationStatus(rawStatus) ? rawStatus : 'PENDING'
  const posts = await prisma.post.findMany({
    where: { moderationStatus: status, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: reviewSelect,
  })
  return NextResponse.json({ posts: posts.map(serializePost), status })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const status = body?.status
  if (status !== 'APPROVED' && status !== 'REJECTED') {
    return NextResponse.json({ message: '璇烽€夋嫨閫氳繃鎴栨嫆缁濓紒' }, { status: 400 })
  }
  const postId = sanitizeText(body?.postId, 80)
  if (!postId) return NextResponse.json({ message: '甯栧瓙 ID 鏃犳晥' }, { status: 400 })
  const rejectionReason = status === 'REJECTED' ? sanitizeText(body?.rejectionReason, 1000) || null : null

  try {
    const post = await prisma.$transaction(async (tx) => {
      const current = await tx.post.findFirst({
        where: { id: postId, isDeleted: false },
        select: { id: true, authorId: true, boardId: true, title: true, moderationStatus: true },
      })
      if (!current) throw new Error('POST_NOT_FOUND')
      const updated = await tx.post.update({
        where: { id: postId, isDeleted: false },
        data: { moderationStatus: status, reviewedAt: new Date(), reviewedById: guard.user.id, rejectionReason },
        select: { id: true, moderationStatus: true },
      })
      await tx.adminAction.create({
        data: {
          adminId: guard.user.id,
          postId,
          action: status === 'APPROVED' ? 'APPROVE_POST' : 'REJECT_POST',
          metadata: { moderationStatus: status, rejectionReason },
        },
      })
      if (current.moderationStatus !== status) {
        const postCount = await tx.post.count({
          where: { boardId: current.boardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
        })
        await tx.board.update({ where: { id: current.boardId }, data: { postCount } })
      }
      if (status === 'APPROVED' && current.moderationStatus !== 'APPROVED') {
        await tx.friendActivity.create({ data: { actorId: current.authorId, type: 'POST', content: current.title, targetUrl: `/posts/${current.id}` } })
      }
      return updated
    })
    revalidatePath('/community')
    revalidatePath('/forum')
    revalidatePath(`/posts/${postId}`)
    return NextResponse.json({ post })
  } catch (error) {
    console.error('[admin/posts/review]', { postId, status, error })
    return NextResponse.json({ message: '瀹℃牳澶辫触锛岃绋嶅悗閲嶈瘯' }, { status: 404 })
  }
}
