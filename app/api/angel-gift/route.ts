import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPharmacyPageData, PharmacyError, executePharmacyDraws } from '@/lib/pharmacy'
import { parsePharmacyDrawCount } from '@/lib/pharmacy-pity'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function errorResponse(error: unknown, operation: string) {
  if (error instanceof PharmacyError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message, details: error.details }, { status: error.status, headers: noStoreHeaders })
  }
  console.error(`[angel-gift.${operation}]`, error)
  return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: '药房暂时无法完成操作，请稍后重试' }, { status: 500, headers: noStoreHeaders })
}

function inputObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    const campaignId = new URL(request.url).searchParams.get('campaignId')
    const data = await getPharmacyPageData(user?.id, campaignId)
    return NextResponse.json({ ok: true, data }, { headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error, 'get')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = inputObject(await request.json().catch(() => null))
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : ''
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : ''
  const drawCount = parsePharmacyDrawCount(body?.drawCount ?? 1)
  try {
    if (!drawCount) throw new PharmacyError('INVALID_DRAW_COUNT', '一次只能执药 1、5 或 10 次')
    const result = await executePharmacyDraws({ userId: guard.user.id, campaignId, idempotencyKey, drawCount })
    let page = null
    try {
      page = await getPharmacyPageData(guard.user.id, result.draws[0]?.campaignId)
    } catch (error) {
      console.error('[angel-gift.post.refresh]', error)
    }
    return NextResponse.json({ ok: true, data: { ...result, draw: result.draws[0], page } }, { headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error, 'post')
  }
}
