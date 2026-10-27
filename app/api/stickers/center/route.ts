import { NextResponse } from 'next/server'
import { getMyStickers, getPickerData } from '@/lib/sticker-center'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }

/** 个人表情包中心：我的上传列表 + 选择器数据。 */
export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const url = new URL(request.url)
  const mode = url.searchParams.get('mode')
  try {
    if (mode === 'picker') {
      const data = await getPickerData(guard.user.id)
      return NextResponse.json({ success: true, ...data }, { headers: privateHeaders })
    }
    const stickers = await getMyStickers(guard.user.id)
    return NextResponse.json({ success: true, stickers }, { headers: privateHeaders })
  } catch (error) {
    console.error('[sticker.center]', error)
    return NextResponse.json({ message: '加载失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
