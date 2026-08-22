import { NextResponse } from 'next/server'
import { backfillBadgeRule, normalizeBackfillBatchSize, normalizeBackfillCursor } from '@/lib/badge-rule-engine'
import { writeBadgeAdminAction } from '@/lib/badge-service'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ badgeId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const { badgeId } = await context.params
  const body = await request.json().catch(() => null) as { cursor?: unknown; batchSize?: unknown } | null
  let cursor: string | undefined
  let batchSize: number
  try {
    if (body?.cursor !== undefined && body.cursor !== null && body.cursor !== '' && typeof body.cursor !== 'string') throw new Error('批量补发游标格式无效')
    cursor = normalizeBackfillCursor(body?.cursor as string | null | undefined)
    const rawBatchSize = body?.batchSize
    const parsedBatchSize = rawBatchSize === undefined || rawBatchSize === null || rawBatchSize === ''
      ? 200
      : typeof rawBatchSize === 'number'
        ? rawBatchSize
        : typeof rawBatchSize === 'string' && /^\d+$/.test(rawBatchSize.trim())
          ? Number(rawBatchSize.trim())
          : Number.NaN
    batchSize = normalizeBackfillBatchSize(parsedBatchSize)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '批量补发参数无效' }, { status: 400 })
  }

  try {
    const summary = await backfillBadgeRule({ badgeId, cursor, batchSize })
    await prisma.$transaction(async (tx) => {
      await writeBadgeAdminAction(tx, {
        actorId: guard.user!.id,
        action: 'BADGE_AUTO_BACKFILL',
        badgeId,
        detail: {
          ruleId: summary.ruleId,
          ruleType: summary.ruleType,
          batchSize,
          cursor: cursor || null,
          nextCursor: summary.nextCursor,
          done: summary.done,
          scanned: summary.scanned,
          granted: summary.granted,
          alreadyOwned: summary.alreadyOwned,
          notEligible: summary.notEligible,
          failed: summary.failed,
        },
      })
    })
    return NextResponse.json({ summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.badges.backfill]', { badgeId, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ message: error instanceof Error ? error.message : '批量补发失败' }, { status: 400 })
  }
}
