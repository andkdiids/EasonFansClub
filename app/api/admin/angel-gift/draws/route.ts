import { NextResponse } from 'next/server'
import { getAdminPharmacyDraws } from '@/lib/pharmacy'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const campaignId = params.get('campaignId') || ''
  if (!campaignId) return NextResponse.json({ ok: false, code: 'CAMPAIGN_NOT_FOUND', message: '缺少主题信息' }, { status: 400 })
  const data = await getAdminPharmacyDraws(campaignId, { page: Number(params.get('page') || 1), pageSize: Number(params.get('pageSize') || 20) })
  return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

