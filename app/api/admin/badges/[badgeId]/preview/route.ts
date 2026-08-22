import { NextResponse } from 'next/server'
import { previewBadgeRule } from '@/lib/badge-rule-engine'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ badgeId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params
  try {
    const preview = await previewBadgeRule(badgeId)
    // Preview is read-only and deliberately does not write an action log for every refresh.
    return NextResponse.json({ preview }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.badges.preview]', { badgeId, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ message: error instanceof Error ? error.message : '规则预览失败' }, { status: 400 })
  }
}
