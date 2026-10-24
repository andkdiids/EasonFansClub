import { NextResponse } from 'next/server'
import { getPharmacyHistoryPage, PharmacyError } from '@/lib/pharmacy'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const guard = await requireRequestUser(request)
    if (!guard.user) return guard.response
    const params = new URL(request.url).searchParams
    const campaignId = params.get('campaignId') || ''
    if (!campaignId) return NextResponse.json({ ok: false, code: 'CAMPAIGN_NOT_FOUND', message: '缺少主题信息' }, { status: 400 })
    const data = await getPharmacyHistoryPage(guard.user.id, campaignId, {
      page: Number(params.get('page') || 1),
      pageSize: Number(params.get('pageSize') || 10),
    })
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
  } catch (error) {
    if (error instanceof PharmacyError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    console.error('[angel-gift.history]', error)
    return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: '执药记录暂时无法加载，请稍后重试' }, { status: 500 })
  }
}
