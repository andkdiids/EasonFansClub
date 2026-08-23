import { NextResponse } from 'next/server'
import { trackBadge, untrackBadge } from '@/lib/badge-phase5'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

type Context = { params: Promise<{ badgeId: string }> }

export async function POST(request: Request, context: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, { endpoint: 'badge-task-track', ip: { limit: 30, windowSeconds: 60 }, user: { limit: 20, windowSeconds: 60 } })
  if (limited) return limited
  const { badgeId } = await context.params
  try {
    await trackBadge(guard.user.id, badgeId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '加入任务失败' }, { status: 400 })
  }
}

export async function DELETE(request: Request, context: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, { endpoint: 'badge-task-untrack', ip: { limit: 30, windowSeconds: 60 }, user: { limit: 20, windowSeconds: 60 } })
  if (limited) return limited
  const { badgeId } = await context.params
  await untrackBadge(guard.user.id, badgeId)
  return NextResponse.json({ ok: true })
}
