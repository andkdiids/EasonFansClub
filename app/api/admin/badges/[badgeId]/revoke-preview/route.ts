import { NextResponse } from 'next/server'
import {
  BADGE_REVOKE_PREVIEW_STATUSES,
  previewBadgeRuleRevocations,
  type BadgeRevokePreviewStatus,
} from '@/lib/badge-retention'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response

  const { badgeId } = await context.params
  const url = new URL(request.url)
  const query = (url.searchParams.get('q') || '').trim().slice(0, 80)
  const rawStatus = (url.searchParams.get('status') || 'ALL') as BadgeRevokePreviewStatus
  if (!BADGE_REVOKE_PREVIEW_STATUSES.includes(rawStatus)) {
    return NextResponse.json({ message: '收回预览筛选条件无效' }, { status: 400 })
  }

  try {
    const preview = await previewBadgeRuleRevocations(badgeId, { query, status: rawStatus })
    return NextResponse.json({ preview }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.badges.revoke-preview]', { badgeId, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ message: error instanceof Error ? error.message : '收回预览失败' }, { status: 400 })
  }
}
