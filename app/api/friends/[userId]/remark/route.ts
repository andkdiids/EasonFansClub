import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const viewer = await getCurrentUser()
  if (!viewer) return NextResponse.json({ ok: false, message: '请先登录' }, { status: 401 })

  const { userId } = await context.params
  if (!userId || userId === viewer.id) {
    return NextResponse.json({ ok: false, message: '目标好友无效' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  if (body === null || typeof body !== 'object' || Array.isArray(body) || (body.remark !== undefined && typeof body.remark !== 'string')) {
    return NextResponse.json({ ok: false, message: '备注格式无效' }, { status: 400 })
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true },
  })
  if (!target) return NextResponse.json({ ok: false, message: '用户不存在' }, { status: 404 })

  const [userAId, userBId] = normalizeFriendPair(viewer.id, target.id)
  const [friendship, block] = await Promise.all([
    prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } }),
    prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewer.id, blockedId: target.id },
          { blockerId: target.id, blockedId: viewer.id },
        ],
      },
      select: { id: true },
    }),
  ])
  if (!friendship || block) {
    return NextResponse.json({ ok: false, message: '只有当前有效好友可以设置备注' }, { status: 403 })
  }

  const remark = sanitizeText(body.remark, 20)
  if (!remark) {
    await prisma.friendRemark.deleteMany({ where: { ownerId: viewer.id, friendId: target.id } })
    return NextResponse.json({ ok: true, data: { remark: null } })
  }

  const saved = await prisma.friendRemark.upsert({
    where: { ownerId_friendId: { ownerId: viewer.id, friendId: target.id } },
    update: { remark },
    create: { ownerId: viewer.id, friendId: target.id, remark },
    select: { remark: true },
  })
  return NextResponse.json({ ok: true, data: { remark: saved.remark } })
}
