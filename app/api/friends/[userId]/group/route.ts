import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { activeUserWhere, normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
type RouteContext = { params: Promise<{ userId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const viewer = await getCurrentUser()
  if (!viewer) return NextResponse.json({ ok: false, message: '请先登录' }, { status: 401, headers: privateHeaders })

  const { userId } = await context.params
  if (!userId || userId === viewer.id) return NextResponse.json({ ok: false, message: '目标好友无效' }, { status: 400, headers: privateHeaders })
  const body = await request.json().catch(() => null)
  const groupId = body?.groupId === null || body?.groupId === ''
    ? null
    : typeof body?.groupId === 'string' ? body.groupId.trim() : undefined
  if (groupId === undefined) return NextResponse.json({ ok: false, message: '分组参数无效' }, { status: 400, headers: privateHeaders })

  const target = await prisma.user.findFirst({ where: { id: userId, ...activeUserWhere }, select: { id: true } })
  if (!target) return NextResponse.json({ ok: false, message: '好友不存在或不可用' }, { status: 404, headers: privateHeaders })
  const [userAId, userBId] = normalizeFriendPair(viewer.id, target.id)

  const result = await prisma.$transaction(async (tx) => {
    const friendship = await tx.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
    if (!friendship) return { error: 'NOT_FRIEND' as const }

    if (groupId) {
      const group = await tx.friendGroup.findFirst({ where: { id: groupId, ownerId: viewer.id }, select: { id: true } })
      if (!group) return { error: 'GROUP_NOT_FOUND' as const }
      await tx.friendGroupMember.upsert({
        where: { ownerId_friendId: { ownerId: viewer.id, friendId: target.id } },
        update: { groupId: group.id },
        create: { ownerId: viewer.id, friendId: target.id, groupId: group.id },
      })
    } else {
      await tx.friendGroupMember.deleteMany({ where: { ownerId: viewer.id, friendId: target.id } })
    }
    return { groupId }
  })

  if ('error' in result) {
    return NextResponse.json({ ok: false, message: result.error === 'NOT_FRIEND' ? '只有当前有效好友可以移动分组' : '分组不存在' }, {
      status: result.error === 'NOT_FRIEND' ? 403 : 404,
      headers: privateHeaders,
    })
  }
  return NextResponse.json({ ok: true, groupId: result.groupId }, { headers: privateHeaders })
}
