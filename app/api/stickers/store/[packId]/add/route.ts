import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { addPackToLibrary, removePackFromLibrary } from '@/lib/sticker-center'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

/**
 * 添加表情包到用户表情库（POST）。已添加则幂等。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400 })
  try {
    await addPackToLibrary(guard.user.id, packId)
    revalidatePath('/profile/stickers')
    revalidatePath('/stickers')
    return NextResponse.json({ success: true, added: true })
  } catch (error) {
    console.error('[sticker.store.add]', error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : '添加失败' },
      { status: 500 },
    )
  }
}

/**
 * 从用户表情库取消添加（DELETE）。不会删除官方资源本身。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400 })
  try {
    const { removed } = await removePackFromLibrary(guard.user.id, packId)
    revalidatePath('/profile/stickers')
    return NextResponse.json({ success: true, removed })
  } catch (error) {
    console.error('[sticker.store.remove]', error)
    return NextResponse.json({ message: '取消失败' }, { status: 500 })
  }
}
