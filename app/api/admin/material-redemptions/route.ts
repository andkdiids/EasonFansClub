import { NextResponse } from 'next/server'
import { createMaterialRedemption, listAdminMaterialRedemptions, MaterialRedemptionError } from '@/lib/material-redemptions'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

function respondError(error: unknown) {
  if (error instanceof MaterialRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
  console.error('[admin.material-redemptions]', error)
  return NextResponse.json({ ok: false, code: 'MATERIAL_REDEMPTION_SERVICE_UNAVAILABLE', message: '物料兑换服务暂时不可用，请稍后重试' }, { status: 500 })
}

export async function GET() {
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  try {
    return NextResponse.json({ materials: await listAdminMaterialRedemptions() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return respondError(error)
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: '请求格式无效' }, { status: 400 })
  try {
    return NextResponse.json({ material: await createMaterialRedemption(guard.user.id, body as Record<string, unknown>) }, { status: 201 })
  } catch (error) {
    return respondError(error)
  }
}
