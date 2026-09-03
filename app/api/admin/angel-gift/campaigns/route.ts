import { NextResponse } from 'next/server'
import { createPharmacyCampaign, getAdminPharmacyCampaigns, PharmacyError } from '@/lib/pharmacy'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

function errorResponse(error: unknown, operation: string) {
  if (error instanceof PharmacyError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: noStoreHeaders })
  console.error(`[admin.angel-gift.${operation}]`, error)
  return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: '天使的礼物配置暂时无法保存，请稍后重试' }, { status: 500, headers: noStoreHeaders })
}

function objectBody(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function GET() {
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  try {
    return NextResponse.json({ ok: true, campaigns: await getAdminPharmacyCampaigns() }, { headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error, 'campaigns.get')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const body = objectBody(await request.json().catch(() => null))
  if (!body) return NextResponse.json({ ok: false, code: 'INVALID_CAMPAIGN_CONFIG', message: '主题参数格式不正确' }, { status: 400, headers: noStoreHeaders })
  try {
    const campaign = await createPharmacyCampaign({ operatorId: guard.user.id, data: body })
    return NextResponse.json({ ok: true, campaign }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error, 'campaigns.post')
  }
}

