import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'
import { MAX_PROFILE_POST_GROUPS, normalizeProfilePostGroupName } from '@/lib/profile-post-groups'

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null) as { name?: unknown } | null
  const name = normalizeProfilePostGroupName(body?.name)
  if (!name) return NextResponse.json({ message: '分组名称需为 1～20 个字符' }, { status: 400 })

  try {
    const group = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${guard.user.id} FOR UPDATE`
      const count = await tx.userPostGroup.count({ where: { userId: guard.user.id } })
      if (count >= MAX_PROFILE_POST_GROUPS) return null
      return tx.userPostGroup.create({
        data: { userId: guard.user.id, name, sortOrder: count },
        select: { id: true, name: true, sortOrder: true },
      })
    })
    if (!group) return NextResponse.json({ code: 'PROFILE_POST_GROUP_LIMIT', message: `最多创建${MAX_PROFILE_POST_GROUPS}个分组` }, { status: 409 })
    return NextResponse.json({ group }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '同名分组已经存在' }, { status: 409 })
    }
    console.error('[profile.post-groups.create]', error)
    return NextResponse.json({ message: '分组暂时无法创建，请稍后重试' }, { status: 503 })
  }
}
