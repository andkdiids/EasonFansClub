import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getStorePackDetail } from '@/lib/sticker-center'

export const dynamic = 'force-dynamic'

/**
 * 表情包详情：含封面/简介/统计/全部表情预览。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400 })
  const detail = await getStorePackDetail(packId, user.id)
  if (!detail) return NextResponse.json({ message: '表情包不存在或未上架' }, { status: 404 })
  return NextResponse.json({ success: true, pack: detail })
}
