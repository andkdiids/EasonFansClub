import { NextResponse } from 'next/server'
import { getOwnMaterialRedemptionOrder } from '@/lib/material-redemptions'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ orderId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { orderId } = await context.params
  const order = await getOwnMaterialRedemptionOrder(guard.user.id, orderId)
  if (!order) return NextResponse.json({ ok: false, code: 'ORDER_NOT_FOUND', message: '兑换订单不存在' }, { status: 404 })
  return NextResponse.json({ order }, { headers: { 'Cache-Control': 'no-store' } })
}
