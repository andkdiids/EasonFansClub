import { NextResponse } from 'next/server'
import { requireUser, enforceApiRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { exchangeMaterialRedemption, MaterialRedemptionError } from '@/lib/material-redemptions'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ materialId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof MaterialRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, { status: error.status })
  console.error('[material-redemption.exchange]', error)
  return NextResponse.json({ ok: false, code: 'EXCHANGE_SERVICE_UNAVAILABLE', message: '兑换服务暂时不可用，请稍后重试' }, { status: 500 })
}

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/material-redemptions/exchange',
    ip: { limit: 12, windowSeconds: 60 },
    user: { limit: 8, windowSeconds: 60 },
  }, '兑换请求过于频繁，请稍后再试')
  if (limited) return limited
  const { materialId } = await context.params
  const body = await request.json().catch(() => null) as { idempotencyKey?: unknown; quantity?: unknown } | null
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : request.headers.get('idempotency-key')?.trim() || ''
  const quantity = body?.quantity === undefined ? 1 : Number(body.quantity)
  try {
    const result = await exchangeMaterialRedemption(guard.user.id, materialId, { idempotencyKey, quantity })
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicate ? 200 : 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
