import { NextResponse } from 'next/server'
import { listAdminMaterialOrders, MaterialRedemptionError } from '@/lib/material-redemptions'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  try {
    return NextResponse.json(await listAdminMaterialOrders({ status: params.get('status') || undefined, query: sanitizeText(params.get('q'), 80), page: Number(params.get('page') || 1), pageSize: Number(params.get('pageSize') || 50) }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof MaterialRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    console.error('[admin.material-redemption.orders]', error)
    return NextResponse.json({ ok: false, code: 'ORDER_SERVICE_UNAVAILABLE', message: '订单服务暂时不可用' }, { status: 500 })
  }
}
