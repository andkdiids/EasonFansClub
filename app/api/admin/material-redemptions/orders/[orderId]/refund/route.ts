import { NextResponse } from 'next/server'
import { MaterialRedemptionError, refundMaterialOrder } from '@/lib/material-redemptions'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ orderId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const { orderId } = await context.params
  const body = await request.json().catch(() => null) as { reason?: unknown; restoreStock?: unknown } | null
  try {
    return NextResponse.json({ ok: true, ...(await refundMaterialOrder(guard.user.id, orderId, { reason: sanitizeText(body?.reason, 500), restoreStock: body?.restoreStock === true })) })
  } catch (error) {
    if (error instanceof MaterialRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    console.error('[admin.material-redemption.refund]', error)
    return NextResponse.json({ ok: false, code: 'REFUND_SERVICE_UNAVAILABLE', message: '退款服务暂时不可用，请稍后重试' }, { status: 500 })
  }
}
