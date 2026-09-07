import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { executeBadgeRuleRevocations } from '@/lib/badge-retention'
import { writeBadgeAdminAction } from '@/lib/badge-service'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response

  const { badgeId } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body as { confirmed?: unknown }).confirmed !== true) {
    return NextResponse.json({ message: '必须二次确认后才能执行收回' }, { status: 400 })
  }
  const query = typeof (body as { query?: unknown }).query === 'string'
    ? (body as { query: string }).query.trim().slice(0, 80)
    : ''

  try {
    const summary = await executeBadgeRuleRevocations(badgeId, { query })
    await prisma.$transaction(async (tx) => {
      await writeBadgeAdminAction(tx, {
        actorId: guard.user!.id,
        action: 'ADMIN_REVOKE_PREVIEW_EXECUTION',
        badgeId,
        detail: {
          preview: summary.previewCount,
          actual: summary.actualRevoked,
          skipped: summary.skipped,
          failed: summary.failed,
          query: query || null,
          executedAt: summary.executedAt.toISOString(),
          skippedReasons: summary.skippedReasons,
          failures: summary.failures,
        },
      })
    })

    for (const user of summary.revokedUsers) {
      invalidateCurrentUserCache(user.id)
      revalidatePath(`/user/${formatUid(user.uid)}`)
      revalidatePath(`/user/${formatUid(user.uid)}/badges`)
    }

    return NextResponse.json({
      summary: {
        ...summary,
        executedAt: summary.executedAt.toISOString(),
      },
      auditRecorded: true,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.badges.revoke-preview.execute]', { badgeId, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ message: error instanceof Error ? error.message : '批量收回失败' }, { status: 400 })
  }
}
