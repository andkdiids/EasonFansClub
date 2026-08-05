import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { STICKER_MAX_DESCRIPTION_LENGTH } from '@/lib/sticker-upload'

export const dynamic = 'force-dynamic'

/**
 * 审核单个表情包合集：通过（APPROVED）或拒绝（REJECTED）。
 * 拒绝时记录原因（rejectionReason）；通过时清除历史原因。
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
    select: { id: true, status: true },
  })
  if (!existing) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })

  const reviewedAt = new Date()
  const data =
    action === 'approve'
      ? { status: 'APPROVED' as const, reviewedAt, rejectionReason: null }
      : {
          status: 'REJECTED' as const,
          reviewedAt,
          rejectionReason: sanitizeText(body.rejectionReason, STICKER_MAX_DESCRIPTION_LENGTH),
        }

  try {
    const pack = await prisma.stickerPack.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        status: true,
        rejectionReason: true,
        reviewedAt: true,
      },
    })
    revalidatePath('/admin/stickers')
    return NextResponse.json({ pack })
  } catch (error) {
    console.error('[admin.sticker.review]', error)
    return NextResponse.json({ message: '审核失败，请稍后重试' }, { status: 500 })
  }
}
