import { NextResponse } from 'next/server'
import { getAngelGiftCollectionBackfillPreview } from '@/lib/angel-gift-collection'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const { campaignId } = await context.params
  try {
    return NextResponse.json({ ok: true, mode: 'PREVIEW', data: await getAngelGiftCollectionBackfillPreview(campaignId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.angel-gift.collection.preview]', error)
    return NextResponse.json({ ok: false, message: '全收集奖励预览暂时无法完成' }, { status: 500 })
  }
}
