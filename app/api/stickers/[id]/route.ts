import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ message: '缺少表情标识' }, { status: 400 })

  const sticker = await prisma.sticker.findFirst({
    where: { id, pack: { creatorId: user.id } },
    select: { id: true, pack: { select: { isOfficial: true, creatorId: true } } },
  })
  if (!sticker) return NextResponse.json({ message: '表情不存在或无权删除' }, { status: 404 })
  if (sticker.pack.isOfficial) {
    return NextResponse.json({ message: '官方表情不可删除' }, { status: 403 })
  }

  try {
    await prisma.sticker.delete({ where: { id } })
    revalidatePath('/profile/stickers')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[sticker.delete]', error)
    return NextResponse.json({ message: '删除失败，请稍后重试' }, { status: 500 })
  }
}
