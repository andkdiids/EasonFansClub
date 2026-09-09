import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recordContentShareTask } from '@/lib/share-task'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

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
  try {
    const result = await prisma.$transaction((tx) => recordContentShareTask(tx, guard.user.id, now))
    return NextResponse.json({ ok: true, awardedAmount: result.awardedAmount }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[growth.share]', error)
    return NextResponse.json({ ok: false, message: '分享奖励暂时无法记录' }, { status: 503 })
  }
}
