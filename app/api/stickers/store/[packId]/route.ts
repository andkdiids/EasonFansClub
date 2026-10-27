import { NextResponse } from 'next/server'
import { getStorePackDetail } from '@/lib/sticker-center'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }

/**
 * 表情包详情：含封面/简介/统计/全部表情预览。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400, headers: privateHeaders })
  const detail = await getStorePackDetail(packId, guard.user.id)
  if (!detail) return NextResponse.json({ message: '表情包不存在或未上架' }, { status: 404, headers: privateHeaders })
  return NextResponse.json({ success: true, pack: detail }, { headers: privateHeaders })
}
