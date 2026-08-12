import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { toPublicMediaUrl } from '@/lib/media-url'
import { getStickerPackReviewNotificationLink } from '@/lib/sticker-pack-editing'

export const dynamic = 'force-dynamic'

/**
 * 审核单个表情包合集：通过（APPROVED）或拒绝（REJECTED）。
 * 拒绝时记录原因（rejectionReason）；通过时清除历史原因。
 * 审核结束向创作者发送一条 ADMIN 通知。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin('sticker_manage')
  if (!guard.user) return guard.response

  const { id } = await params
  if (!id) return NextResponse.json({ message: '缺少表情包标识' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ message: '请求无效' }, { status: 400 })

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ message: '审核动作无效' }, { status: 400 })
  }

  const existing = await prisma.stickerPack.findUnique({
    where: { id },
    select: { id: true, status: true, name: true, creatorId: true },
  })
  if (!existing) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
  if (existing.status !== 'PENDING') {
    return NextResponse.json({ message: '该表情包当前不在待审核状态' }, { status: 409 })
  }

  const reviewedAt = new Date()
  const rejectionReason = action === 'reject'
    ? sanitizeText(body.rejectionReason, 500)
    : null
  if (action === 'reject' && !rejectionReason) {
    return NextResponse.json({ message: '请填写拒绝原因' }, { status: 400 })
  }
  const data = action === 'approve'
    ? { status: 'APPROVED' as const, reviewedAt, rejectionReason: null }
    : { status: 'REJECTED' as const, reviewedAt, rejectionReason }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.stickerPack.updateMany({
        where: { id, status: 'PENDING' },
        data,
      })
      if (changed.count === 0) throw new Error('STICKER_PACK_NOT_PENDING')

      const review = await tx.stickerPack.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          status: true,
          rejectionReason: true,
          reviewedAt: true,
          creatorId: true,
        },
      })
      if (!review) throw new Error('STICKER_PACK_NOT_FOUND')

      const isApprove = action === 'approve'
      const title = isApprove
        ? `你的表情包《${review.name}》已通过审核`
        : `你的表情包《${review.name}》未通过审核`
      const content = isApprove
        ? '已经上架表情商店，可在「我的表情包 → 我创建的表情包」查看详情。'
        : `原因：${review.rejectionReason || '内容不符合规范'}`
      await tx.notification.create({
        data: {
          recipientId: review.creatorId,
          actorId: guard.user.id,
          type: 'ADMIN',
          title,
          content,
          link: getStickerPackReviewNotificationLink(review.id, review.status),
          key: `sticker-pack-review:${review.id}:${review.status.toLowerCase()}:${reviewedAt.getTime()}`,
        },
      })
      return review
    })
    emitRealtime(updated.creatorId, 'notification')
    // 返回完整的 pack 给前端以刷新本地状态
    const pack = await prisma.stickerPack.findUnique({
      where: { id: updated.id },
      select: {
        id: true,
        name: true,
        description: true,
        coverUrl: true,
        type: true,
        status: true,
        rejectionReason: true,
        reviewedAt: true,
        createdAt: true,
        creator: { select: { id: true, nickname: true, uid: true } },
        stickers: {
          orderBy: { sort: 'asc' },
          select: { id: true, name: true, url: true, type: true, sort: true },
        },
      },
    })
    revalidatePath('/admin/stickers')
    revalidatePath('/profile/stickers')
    revalidatePath(`/profile/stickers/${updated.id}/edit`)
    return NextResponse.json({ pack: pack ? serializePack(pack) : null })
  } catch (error) {
    if (error instanceof Error && error.message === 'STICKER_PACK_NOT_PENDING') {
      return NextResponse.json({ message: '该表情包已被其他管理员处理，请刷新列表' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'STICKER_PACK_NOT_FOUND') {
      return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
    }
    console.error('[admin.sticker.review]', error)
    return NextResponse.json({ message: '审核失败，请稍后重试' }, { status: 500 })
  }
}

function serializePack(p: {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  type: 'STATIC' | 'GIF'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  reviewedAt: Date | null
  createdAt: Date
  creator: { id: string; nickname: string; uid: number }
  stickers: { id: string; name: string | null; url: string; type: 'STATIC' | 'GIF'; sort: number }[]
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    coverUrl: toPublicMediaUrl(p.coverUrl),
    type: p.type,
    status: p.status,
    rejectionReason: p.rejectionReason,
    reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    creator: p.creator,
    stickers: p.stickers.map((sticker) => ({ ...sticker, url: toPublicMediaUrl(sticker.url) || sticker.url })),
  }
}
