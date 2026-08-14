import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

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
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })

  const groups = await prisma.friendGroup.findMany({
    where: { ownerId: user.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      sortOrder: true,
      createdAt: true,
      _count: { select: { FriendGroupMember: true } },
    },
  })
  return NextResponse.json({
    groups: groups.map(({ _count, ...group }) => ({ ...group, count: _count.FriendGroupMember })),
  }, { headers: privateHeaders })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })

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
