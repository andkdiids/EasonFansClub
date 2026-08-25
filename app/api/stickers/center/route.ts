import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getMyStickers, getPickerData } from '@/lib/sticker-center'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

/** 个人表情包中心：我的上传列表 + 选择器数据。 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()

  const url = new URL(request.url)
  const mode = url.searchParams.get('mode')
  try {
    if (mode === 'picker') {
      const data = await getPickerData(user.id)
      return NextResponse.json({ success: true, ...data })
    }
    const stickers = await getMyStickers(user.id)
    return NextResponse.json({ success: true, stickers })
  } catch (error) {
    console.error('[sticker.center]', error)
    return NextResponse.json({ message: '加载失败，请稍后重试' }, { status: 500 })
  }
}
