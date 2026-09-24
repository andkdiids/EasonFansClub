import { NextResponse } from 'next/server'
import { findActiveFollowTarget, privateFollowHeaders } from '@/lib/follow-service'
import { resolveRelationship } from '@/lib/relationship-resolver'
import { requireRequestUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const target = await findActiveFollowTarget(userId)
  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404, headers: privateFollowHeaders })

  return NextResponse.json({ relationship: await resolveRelationship(guard.user.id, target.id) }, { headers: privateFollowHeaders })
}
