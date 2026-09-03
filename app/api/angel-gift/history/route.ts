import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPharmacyHistoryPage, PharmacyError } from '@/lib/pharmacy'
import { unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthenticatedResponse('请先登录后查看执药记录')
    const params = new URL(request.url).searchParams
    const campaignId = params.get('campaignId') || ''
    if (!campaignId) return NextResponse.json({ ok: false, code: 'CAMPAIGN_NOT_FOUND', message: '缺少主题信息' }, { status: 400 })
    const data = await getPharmacyHistoryPage(user.id, campaignId, {
      page: Number(params.get('page') || 1),
      pageSize: Number(params.get('pageSize') || 10),
    })
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
  } catch (error) {
    if (error instanceof PharmacyError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    console.error('[angel-gift.history]', error)
    return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: '执药记录暂时无法加载，请稍后重试' }, { status: 500 })
  }
}
