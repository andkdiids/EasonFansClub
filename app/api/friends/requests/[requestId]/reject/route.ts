import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { decideFriendRequest } from '@/lib/friends'

type RouteContext = { params: Promise<{ requestId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user

  const { requestId } = await context.params
  const result = await decideFriendRequest(user.id, requestId, 'reject')
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
