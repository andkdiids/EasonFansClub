import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { decideFriendRequest } from '@/lib/friends'

type RouteContext = { params: Promise<{ requestId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const { requestId } = await context.params
  const result = await decideFriendRequest(user.id, requestId, 'reject')
  return NextResponse.json(result.body, { status: result.status })
}
