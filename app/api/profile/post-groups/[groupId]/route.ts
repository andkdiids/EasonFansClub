import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'
import { isProfilePostGroupDirection, normalizeProfilePostGroupName } from '@/lib/profile-post-groups'

type RouteContext = { params: Promise<{ groupId: string }> }

async function updateGroup(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { groupId } = await context.params
  const body = await request.json().catch(() => null) as { name?: unknown; direction?: unknown } | null
  const hasName = Boolean(body && Object.prototype.hasOwnProperty.call(body, 'name'))
  const name = hasName ? normalizeProfilePostGroupName(body?.name) : null
  if (hasName && !name) return NextResponse.json({ message: '分组名称需为 1～20 个字符' }, { status: 400 })
  const direction = body?.direction
  if (direction !== undefined && !isProfilePostGroupDirection(direction)) {
    return NextResponse.json({ message: '分组排序方向无效' }, { status: 400 })
  }
  if (!hasName && direction === undefined) return NextResponse.json({ message: '没有可更新的字段' }, { status: 400 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const groups = await tx.userPostGroup.findMany({
        where: { userId: guard.user.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, sortOrder: true },
      })
      const index = groups.findIndex((group) => group.id === groupId)
      if (index < 0) return { kind: 'not-found' as const }

      if (direction) {
        const nextIndex = direction === 'up' ? index - 1 : index + 1
        if (nextIndex >= 0 && nextIndex < groups.length) {
          const current = groups[index]
          const neighbor = groups[nextIndex]
          await tx.userPostGroup.update({ where: { id: current.id }, data: { sortOrder: neighbor.sortOrder } })
          await tx.userPostGroup.update({ where: { id: neighbor.id }, data: { sortOrder: current.sortOrder } })
        }
      }
      if (name) await tx.userPostGroup.update({ where: { id: groupId }, data: { name } })
      return { kind: 'ok' as const }
    })
    if (result.kind === 'not-found') return NextResponse.json({ message: '分组不存在' }, { status: 404 })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '同名分组已经存在' }, { status: 409 })
    }
    console.error('[profile.post-groups.update]', error)
    return NextResponse.json({ message: '分组暂时无法更新，请稍后重试' }, { status: 503 })
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  return updateGroup(request, context)
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { groupId } = await context.params
  try {
    const result = await prisma.userPostGroup.deleteMany({ where: { id: groupId, userId: guard.user.id } })
    if (!result.count) return NextResponse.json({ message: '分组不存在' }, { status: 404 })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[profile.post-groups.delete]', error)
    return NextResponse.json({ message: '分组暂时无法删除，请稍后重试' }, { status: 503 })
  }
}
