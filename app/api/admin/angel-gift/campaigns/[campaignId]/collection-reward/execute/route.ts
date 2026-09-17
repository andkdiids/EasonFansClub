import { NextResponse } from 'next/server'
import { executeAngelGiftCollectionBackfill } from '@/lib/angel-gift-collection'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as { confirm?: unknown } | null
  if (body?.confirm !== true) return NextResponse.json({ ok: false, message: '请先完成 PREVIEW 并明确确认发放' }, { status: 400 })
  const { campaignId } = await context.params
  try {
    return NextResponse.json({ ok: true, mode: 'GRANT', data: await executeAngelGiftCollectionBackfill(campaignId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.angel-gift.collection.execute]', error)
    return NextResponse.json({ ok: false, message: '全收集奖励补发暂时无法完成' }, { status: 500 })
  }
}
