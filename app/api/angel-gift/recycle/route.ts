import { NextResponse } from 'next/server'
import { getPharmacyPageData, PharmacyError, recyclePharmacyDuplicates } from '@/lib/pharmacy'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function errorResponse(error: unknown) {
  if (error instanceof PharmacyError) return NextResponse.json({ ok: false, code: error.code, message: error.message, details: error.details }, { status: error.status, headers: noStoreHeaders })
  console.error('[angel-gift.recycle]', error)
  return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: '余药回收暂时无法完成，请稍后重试' }, { status: 500, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : ''
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : ''
  try {
    const result = await recyclePharmacyDuplicates({ userId: guard.user.id, campaignId, idempotencyKey })
    let page = null
    try {
      page = await getPharmacyPageData(guard.user.id, result.recycle.campaignId)
    } catch (error) {
      console.error('[angel-gift.recycle.refresh]', error)
    }
    return NextResponse.json({ ok: true, data: { ...result, page } }, { headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error)
  }
}

