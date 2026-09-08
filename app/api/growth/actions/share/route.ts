import { NextResponse } from 'next/server'
import { getShanghaiDateKey } from '@/lib/checkin'
import { grantGrowthReward } from '@/lib/growth-tasks/service'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

function shareSourceKey(dateKey: string) {
  // Link shares and share-card saves are two successful entry points for the
  // same once-per-day task. The date-scoped key keeps every content type and
  // every piece of content idempotent within that task window.
  return `content:${dateKey}`
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
    endpoint: '/api/growth/actions/share',
  }, '分享操作过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const contentId = typeof body?.contentId === 'string' ? body.contentId.trim() : ''
  if (!contentId || contentId.length > 191) {
    return NextResponse.json({ ok: false, message: '分享内容无效' }, { status: 400 })
  }

  const now = new Date()
  const dateKey = getShanghaiDateKey(now)
  try {
    const result = await prisma.$transaction(async (tx) => grantGrowthReward(tx, {
      userId: guard.user.id,
      taskCode: 'CONTENT_SHARE_ACTIVE',
      sourceEventId: shareSourceKey(dateKey),
      reason: '分享内容',
      now,
    }))
    return NextResponse.json({ ok: true, awardedAmount: result.awardedAmount, dateKey }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[growth.share]', error)
    return NextResponse.json({ ok: false, message: '分享奖励暂时无法记录' }, { status: 503 })
  }
}
