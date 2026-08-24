import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { activeUserWhere } from '@/lib/friends'
import { buildFriendGroupIndex } from '@/lib/friend-grouping'
import { prisma } from '@/lib/prisma'
import { requireUser, sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const FRIEND_GROUP_NAME_MAX_LENGTH = 30

function parseGroupName(value: unknown) {
  if (typeof value !== 'string') return { name: '', error: '分组名不能为空' }
  const rawName = value.trim()
  if (!rawName) return { name: '', error: '分组名不能为空' }
  if (rawName.length > FRIEND_GROUP_NAME_MAX_LENGTH) return { name: '', error: `分组名不能超过${FRIEND_GROUP_NAME_MAX_LENGTH}个字符` }
  const name = sanitizeText(rawName, FRIEND_GROUP_NAME_MAX_LENGTH)
  return name ? { name, error: null } : { name: '', error: '分组名不能为空' }
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user

  const [groups, friendships] = await Promise.all([
    prisma.friendGroup.findMany({
      where: { ownerId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, sortOrder: true, createdAt: true },
    }),
    prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: user.id, User_Friendship_userBIdToUser: activeUserWhere },
          { userBId: user.id, User_Friendship_userAIdToUser: activeUserWhere },
        ],
      },
      select: { userAId: true, userBId: true },
    }),
  ])
  const friendIds = friendships.map((friendship) => friendship.userAId === user.id ? friendship.userBId : friendship.userAId)
  const members = friendIds.length
    ? await prisma.friendGroupMember.findMany({
        where: { ownerId: user.id, friendId: { in: friendIds } },
        select: { friendId: true, groupId: true },
      })
    : []
  const validGroupIds = new Set(groups.map((group) => group.id))
  const { groupCounts } = buildFriendGroupIndex(
    friendIds,
    members.filter((member) => validGroupIds.has(member.groupId)),
  )
  return NextResponse.json({
    groups: groups.map((group) => ({ ...group, count: groupCounts.get(group.id) || 0 })),
  }, { headers: privateHeaders })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user

  const body = await request.json().catch(() => null)
  const parsed = parseGroupName(body?.name)
  if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400, headers: privateHeaders })

  try {
    const maxOrder = await prisma.friendGroup.aggregate({ where: { ownerId: user.id }, _max: { sortOrder: true } })
    const group = await prisma.friendGroup.create({
      data: { ownerId: user.id, name: parsed.name, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1 },
      select: { id: true, name: true, sortOrder: true, createdAt: true },
    })
    return NextResponse.json({ group: { ...group, count: 0 } }, { status: 201, headers: privateHeaders })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '分组名已存在' }, { status: 409, headers: privateHeaders })
    }
    console.error('[friend-groups:create]', error)
    return NextResponse.json({ message: '新建分组失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
