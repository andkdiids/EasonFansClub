import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toggleStickerFavorite } from '@/lib/sticker-center'

export const dynamic = 'force-dynamic'

/** 切换收藏：已收藏则取消，否则收藏。 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const stickerId = String(body?.stickerId || '').trim()
  if (!stickerId) return NextResponse.json({ message: '缺少表情标识' }, { status: 400 })

  const sticker = await prisma.sticker.findFirst({
    where: { id: stickerId, isHidden: false, pack: { status: 'APPROVED' } },
    select: { id: true },
  })
  if (!sticker) return NextResponse.json({ message: '表情不存在或不可收藏' }, { status: 404 })

  try {
    const result = await toggleStickerFavorite(user.id, stickerId)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[sticker.favorite]', error)
    return NextResponse.json({ message: '操作失败，请稍后重试' }, { status: 500 })
  }
}
