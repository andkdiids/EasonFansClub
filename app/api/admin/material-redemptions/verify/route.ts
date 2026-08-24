import { NextResponse } from 'next/server'
import { getAdminMaterialOrderPreview, MaterialRedemptionError, redeemMaterialOrder } from '@/lib/material-redemptions'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

async function verifyRateLimit(request: Request, userId: string) {
  return enforceApiRateLimit(request, userId, {
    endpoint: '/api/admin/material-redemptions/verify',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  }, '核销查询过于频繁，请稍后再试')
}

function respondError(error: unknown) {
  if (error instanceof MaterialRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
  console.error('[admin.material-redemption.verify]', error)
  return NextResponse.json({ ok: false, code: 'VERIFY_SERVICE_UNAVAILABLE', message: '核销服务暂时不可用，请稍后重试' }, { status: 500 })
}

export async function GET(request: Request) {
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const limited = await verifyRateLimit(request, guard.user.id)
  if (limited) return limited
  const token = new URL(request.url).searchParams.get('token') || ''
  try {
    return NextResponse.json({ order: await getAdminMaterialOrderPreview(token) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return respondError(error)
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const limited = await verifyRateLimit(request, guard.user.id)
  if (limited) return limited
  const body = await request.json().catch(() => null) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  try {
    return NextResponse.json({ ok: true, order: await redeemMaterialOrder(guard.user.id, token) })
  } catch (error) {
    return respondError(error)
  }
}
