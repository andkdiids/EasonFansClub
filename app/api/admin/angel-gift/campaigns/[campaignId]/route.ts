import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { getAdminPharmacyCampaign, PharmacyError, updatePharmacyCampaign } from '@/lib/pharmacy'
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

export async function GET(_request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const { campaignId } = await context.params
  try {
    const campaign = await getAdminPharmacyCampaign(campaignId)
    if (!campaign) return NextResponse.json({ ok: false, code: 'CAMPAIGN_NOT_FOUND', message: '主题不存在' }, { status: 404, headers: noStoreHeaders })
    return NextResponse.json({ ok: true, campaign }, { headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error, 'campaign.get')
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const { campaignId } = await context.params
  const body = objectBody(await request.json().catch(() => null))
  if (!body) return NextResponse.json({ ok: false, code: 'INVALID_CAMPAIGN_CONFIG', message: '主题参数格式不正确' }, { status: 400, headers: noStoreHeaders })
  try {
    const campaign = await updatePharmacyCampaign({ operatorId: guard.user.id, campaignId, data: body })
    revalidatePath('/angel-gift')
    revalidatePath('/admin/angel-gift')
    return NextResponse.json({ ok: true, campaign }, { headers: noStoreHeaders })
  } catch (error) {
    return errorResponse(error, 'campaign.patch')
  }
}

