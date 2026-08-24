import { NextResponse } from 'next/server'
import { adjustMaterialInventory, MaterialRedemptionError } from '@/lib/material-redemptions'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ materialId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const { materialId } = await context.params
  const body = await request.json().catch(() => null) as { delta?: unknown; reason?: unknown } | null
  const delta = Number(body?.delta)
  const reason = sanitizeText(body?.reason, 500)
  try {
    return NextResponse.json({ ok: true, ...(await adjustMaterialInventory(guard.user.id, materialId, delta, reason)) })
  } catch (error) {
    if (error instanceof MaterialRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    console.error('[admin.material-redemption.inventory]', error)
    return NextResponse.json({ ok: false, code: 'INVENTORY_SERVICE_UNAVAILABLE', message: '库存调整服务暂时不可用' }, { status: 500 })
  }
}
