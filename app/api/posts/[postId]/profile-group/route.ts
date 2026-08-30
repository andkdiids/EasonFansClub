import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const body = await request.json().catch(() => null) as { groupId?: unknown } | null
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'groupId') || (body.groupId !== null && typeof body.groupId !== 'string')) {
    return NextResponse.json({ message: '分组参数无效' }, { status: 400 })
  }
  const groupId = typeof body.groupId === 'string' && body.groupId.trim() ? body.groupId.trim() : null

  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id: postId }, select: { id: true, authorId: true, isDeleted: true } })
    if (!post || post.isDeleted) return { kind: 'not-found' as const }
    if (post.authorId !== guard.user.id) return { kind: 'forbidden' as const }
    if (groupId) {
      const group = await tx.userPostGroup.findFirst({ where: { id: groupId, userId: guard.user.id }, select: { id: true } })
      if (!group) return { kind: 'invalid-group' as const }
    }
    const updated = await tx.post.update({ where: { id: postId }, data: { userPostGroupId: groupId }, select: { id: true, userPostGroupId: true } })
    return { kind: 'ok' as const, updated }
  })
  if (result.kind === 'not-found') return NextResponse.json({ message: '帖子不存在或已经被删除' }, { status: 404 })
  if (result.kind === 'forbidden') return NextResponse.json({ message: '只能整理自己发布的帖子' }, { status: 403 })
  if (result.kind === 'invalid-group') return NextResponse.json({ message: '只能使用自己的个人分组' }, { status: 403 })
  return NextResponse.json({ ok: true, userPostGroupId: result.updated.userPostGroupId }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
