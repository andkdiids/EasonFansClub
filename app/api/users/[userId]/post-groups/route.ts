import { NextResponse } from 'next/server'
import { safeDb } from '@/lib/db-timeout'
import { getProfileVisibility, isProfileModuleVisible } from '@/lib/user-privacy'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'
import { resolveRequestAuth } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { userId } = await context.params
  const uid = parseUidParam(userId)
  if (uid === null) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const [viewer, target] = await Promise.all([
    Promise.resolve(auth.user),
    prisma.user.findFirst({
      where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: { id: true },
    }),
  ])
  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const visibility = await getProfileVisibility(target.id, viewer?.id)
  if (!isProfileModuleVisible(visibility.settings, 'posts', visibility.isSelf)) {
    return NextResponse.json({ groups: [] })
  }

  const groups = await safeDb(
    'userPostGroups.list',
    prisma.userPostGroup.findMany({
      where: { userId: target.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, sortOrder: true },
    }),
    [],
  )
  return NextResponse.json({ groups })
}
