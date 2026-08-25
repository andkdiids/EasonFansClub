import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

/**
 * 删除自己的表情（硬删除）。官方表情不可由用户删除。
 * 删除后关联收藏/使用记录/举报随级联移除，选择器即时失效。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()

  const { id } = await params
  if (!id) return NextResponse.json({ message: '缺少表情标识' }, { status: 400 })

  const sticker = await prisma.sticker.findFirst({
    where: { id, pack: { creatorId: user.id } },
    select: { id: true, pack: { select: { isOfficial: true, creatorId: true, status: true, id: true } } },
  })
  if (!sticker) return NextResponse.json({ message: '表情不存在或无权删除' }, { status: 404 })
  if (sticker.pack.isOfficial) {
    return NextResponse.json({ message: '官方表情不可删除' }, { status: 403 })
  }
  if (sticker.pack.status === 'PENDING') {
    return NextResponse.json({ message: '表情包正在审核中，暂不能删除表情' }, { status: 409 })
  }
  if (sticker.pack.status !== 'REJECTED') {
    return NextResponse.json({ message: '只有被退回的表情包可以编辑' }, { status: 403 })
  }

  try {
    const deleted = await prisma.sticker.deleteMany({
      where: {
        id,
        pack: { creatorId: user.id, isOfficial: false, status: 'REJECTED' },
      },
    })
    if (deleted.count === 0) {
      return NextResponse.json({ message: '表情包状态已变化，请刷新后重试' }, { status: 409 })
    }
    revalidatePath('/profile/stickers')
    revalidatePath(`/profile/stickers/${sticker.pack.id}/edit`)
    revalidatePath('/admin/stickers')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[sticker.delete]', error)
    return NextResponse.json({ message: '删除失败，请稍后重试' }, { status: 500 })
  }
}
