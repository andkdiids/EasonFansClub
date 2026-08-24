import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser, sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const FRIEND_GROUP_NAME_MAX_LENGTH = 30
type RouteContext = { params: Promise<{ groupId: string }> }

function parseGroupName(value: unknown) {
  if (typeof value !== 'string') return { name: '', error: '分组名不能为空' }
  const rawName = value.trim()
  if (!rawName) return { name: '', error: '分组名不能为空' }
  if (rawName.length > FRIEND_GROUP_NAME_MAX_LENGTH) return { name: '', error: `分组名不能超过${FRIEND_GROUP_NAME_MAX_LENGTH}个字符` }
  const name = sanitizeText(rawName, FRIEND_GROUP_NAME_MAX_LENGTH)
  return name ? { name, error: null } : { name: '', error: '分组名不能为空' }
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user
  const { groupId } = await context.params
  const parsed = parseGroupName((await request.json().catch(() => null))?.name)
  if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400, headers: privateHeaders })

  try {
    const group = await prisma.friendGroup.updateMany({
      where: { id: groupId, ownerId: user.id },
      data: { name: parsed.name },
    })
    if (!group.count) return NextResponse.json({ message: '分组不存在' }, { status: 404, headers: privateHeaders })
    const updated = await prisma.friendGroup.findFirst({ where: { id: groupId, ownerId: user.id }, select: { id: true, name: true, sortOrder: true } })
    return NextResponse.json({ group: updated }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '分组名已存在' }, { status: 409, headers: privateHeaders })
    }
    console.error('[friend-groups:rename]', error)
    return NextResponse.json({ message: '重命名分组失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user
  const { groupId } = await context.params
  const deleted = await prisma.friendGroup.deleteMany({ where: { id: groupId, ownerId: user.id } })
  if (!deleted.count) return NextResponse.json({ message: '分组不存在' }, { status: 404, headers: privateHeaders })
  return NextResponse.json({ ok: true, groupId }, { headers: privateHeaders })
}
