import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { createNotification } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { publicImageUrl } from '@/lib/images'
import { parseSalonCategory, SALON_POST_STATUSES, salonCategoryLabel } from '@/lib/salon'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

function parseStatus(value: string | null) {
  return SALON_POST_STATUSES.includes(value as typeof SALON_POST_STATUSES[number]) ? value as typeof SALON_POST_STATUSES[number] : 'PENDING'
}

function serializeAdminPost(post: {
  id: string
  category: string
  title: string | null
  content: string | null
  status: string
  rejectReason: string | null
  likeCount: number
  commentCount: number
  createdAt: Date
  approvedAt: Date | null
  author: { id: string; uid: number; nickname: string; avatarUrl: string | null; Profile: { avatarUrl: string | null } | null }
  concert: { id: string; title: string | null; concertDate: Date; city: string; stageType: string; venue: string | null; MusicTour: { id: string; name: string } }
  media: Array<{ id: string; originalUrl: string; previewUrl: string; thumbnailUrl: string; width: number; height: number; sortOrder: number }>
}) {
  return {
    id: post.id,
    category: post.category,
    categoryLabel: salonCategoryLabel(post.category),
    title: post.title,
    content: post.content,
    status: post.status,
    rejectReason: post.rejectReason,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    createdAt: post.createdAt.toISOString(),
    approvedAt: post.approvedAt?.toISOString() || null,
    author: {
      id: post.author.id,
      uid: post.author.uid,
      nickname: post.author.nickname,
      avatarUrl: publicImageUrl(post.author.Profile?.avatarUrl || post.author.avatarUrl),
    },
    concert: {
      id: post.concert.id,
      title: post.concert.title,
      date: post.concert.concertDate.toISOString(),
      city: post.concert.city,
      stageType: post.concert.stageType,
      venue: post.concert.venue,
      tour: post.concert.MusicTour,
    },
    media: post.media.map((media) => ({
      ...media,
      originalUrl: publicImageUrl(media.originalUrl) || media.originalUrl,
      previewUrl: publicImageUrl(media.previewUrl) || media.previewUrl,
      thumbnailUrl: publicImageUrl(media.thumbnailUrl) || media.thumbnailUrl,
    })),
  }
}

const adminSelect = {
  id: true,
  category: true,
  title: true,
  content: true,
  status: true,
  rejectReason: true,
  likeCount: true,
  commentCount: true,
  createdAt: true,
  approvedAt: true,
  author: { select: { id: true, uid: true, nickname: true, avatarUrl: true, Profile: { select: { avatarUrl: true } } } },
  concert: { select: { id: true, title: true, concertDate: true, city: true, stageType: true, venue: true, MusicTour: { select: { id: true, name: true } } } },
  media: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, originalUrl: true, previewUrl: true, thumbnailUrl: true, width: true, height: true, sortOrder: true } },
} as const

export async function GET(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const status = parseStatus(params.get('status'))
  const rawPage = Number(params.get('page') || '1')
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const rows = await prisma.salonPost.findMany({
    where: { status },
    orderBy: status === 'PENDING' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    select: adminSelect,
  })
  const hasMore = rows.length > PAGE_SIZE
  return NextResponse.json({
    ok: true,
    status,
    page,
    hasMore,
    posts: rows.slice(0, PAGE_SIZE).map(serializeAdminPost),
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, message: '请求内容无效' }, { status: 400 })
  const postId = sanitizeText(body.postId, 191)
  const action = body.action === 'approve' || body.action === 'reject' || body.action === 'update' ? body.action : ''
  if (!postId || !action) return NextResponse.json({ ok: false, message: '审核操作无效' }, { status: 400 })

  const current = await prisma.salonPost.findUnique({ where: { id: postId }, select: { id: true, status: true, userId: true, title: true } })
  if (!current) return NextResponse.json({ ok: false, message: '作品不存在' }, { status: 404 })

  const data: Prisma.SalonPostUpdateInput = {}
  if (Object.prototype.hasOwnProperty.call(body, 'category')) {
    const category = parseSalonCategory(body.category)
    if (!category) return NextResponse.json({ ok: false, message: '投稿分类无效' }, { status: 400 })
    data.category = category
  }
  if (Object.prototype.hasOwnProperty.call(body, 'concertId')) {
    const concertId = sanitizeText(body.concertId, 191)
    const concert = await prisma.musicConcert.findFirst({ where: { id: concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } }, select: { id: true } })
    if (!concert) return NextResponse.json({ ok: false, message: '演唱会场次不存在或暂未公开' }, { status: 400 })
    data.concert = { connect: { id: concert.id } }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'title')) data.title = sanitizeText(body.title, 200) || null
  if (Object.prototype.hasOwnProperty.call(body, 'content')) data.content = sanitizeText(body.content, 5000) || null

  let reviewStatus: 'APPROVED' | 'REJECTED' | null = null
  let reviewedAt: Date | null = null
  if (action === 'approve' || action === 'reject') {
    if (current.status !== 'PENDING') return NextResponse.json({ ok: false, message: '只有待审核作品可以执行审核操作' }, { status: 409 })
    reviewStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'
    const rejectReason = sanitizeText(body.rejectReason, 2000)
    if (reviewStatus === 'REJECTED' && !rejectReason) return NextResponse.json({ ok: false, message: '拒绝时必须填写原因' }, { status: 400 })
    reviewedAt = new Date()
    data.status = reviewStatus
    data.approvedAt = reviewStatus === 'APPROVED' ? reviewedAt : null
    data.approvedBy = reviewStatus === 'APPROVED' ? { connect: { id: guard.user.id } } : { disconnect: true }
    data.rejectReason = reviewStatus === 'REJECTED' ? rejectReason : null
  }
  if (!Object.keys(data).length) return NextResponse.json({ ok: false, message: '没有需要更新的内容' }, { status: 400 })

  const updated = await prisma.salonPost.update({ where: { id: postId }, data, select: { id: true, status: true } })
  if (reviewStatus && reviewedAt) {
    const content = reviewStatus === 'APPROVED'
      ? `你提交的沙龙作品《${current.title || '无标题作品'}》已通过审核。`
      : `你提交的沙龙作品《${current.title || '无标题作品'}》未通过审核。原因：${String(data.rejectReason || '')}`
    await safeNotificationWrite(() => createNotification({
      data: {
        recipientId: current.userId,
        actorId: guard.user.id,
        type: 'REVIEW',
        key: `salon-review:${postId}:${reviewStatus}:${reviewedAt!.getTime()}`,
        title: reviewStatus === 'APPROVED' ? '你的沙龙投稿已通过审核' : '你的沙龙投稿未通过审核',
        content,
        link: '/salon/mine',
      },
    }), { operation: 'salon.review.notification', userId: guard.user.id, notificationType: 'REVIEW' })
    emitRealtime(current.userId, 'notification')
  }
  revalidatePath('/salon')
  revalidatePath('/salon/mine')
  revalidatePath(`/salon/${postId}`)
  return NextResponse.json({ ok: true, post: updated, message: reviewStatus === 'APPROVED' ? '作品已通过审核' : reviewStatus === 'REJECTED' ? '作品已拒绝' : '作品已更新' })
}
