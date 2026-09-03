import { NextResponse } from 'next/server'
import { createPharmacyPrize, PharmacyError } from '@/lib/pharmacy'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

function objectBody(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const { campaignId } = await context.params
  const body = objectBody(await request.json().catch(() => null))
  if (!body) return NextResponse.json({ ok: false, code: 'INVALID_PRIZE', message: '奖品参数格式不正确' }, { status: 400 })
  try {
    const prize = await createPharmacyPrize({ operatorId: guard.user.id, campaignId, data: body })
    return NextResponse.json({ ok: true, prize }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof PharmacyError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    console.error('[admin.angel-gift.prize.post]', error)
    return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: '奖品暂时无法保存，请稍后重试' }, { status: 500 })
  }
}

