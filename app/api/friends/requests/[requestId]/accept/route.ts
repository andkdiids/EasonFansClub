import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { decideFriendRequest } from '@/lib/friends'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'

type RouteContext = { params: Promise<{ requestId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user

  const { requestId } = await context.params
  const result = await decideFriendRequest(user.id, requestId, 'accept')
  for (const userId of result.badgeEvaluationUserIds) triggerBadgeEvaluation(userId, 'FRIENDSHIP_CREATED')
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
