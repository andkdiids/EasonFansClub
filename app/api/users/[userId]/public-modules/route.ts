import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'

type RouteContext = { params: Promise<{ userId: string }> }

async function findPublicUserId(uidParam: string) {
  const uid = parseUidParam(uidParam)
  if (uid === null) return null
  return prisma.user.findFirst({
    where: { uid, status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
    select: { id: true },
  })
}

export async function GET(request: Request, context: RouteContext) {
  const { userId } = await context.params
  const { searchParams } = new URL(request.url)
  const moduleKey = searchParams.get('module') || 'posts'
  const viewer = await getCurrentUser()
  const target = await safeDb('userModules.findUser', findPublicUserId(userId), null)

  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  if (moduleKey === 'posts') {
    const posts = await safeDb(
      'userModules.posts',
      prisma.post.findMany({
        where: { authorId: target.id, isDeleted: false, status: 'PUBLISHED' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          content: true,
          replyCount: true,
          likeCount: true,
          viewCount: true,
          createdAt: true,
          board: { select: { name: true, slug: true } },
        },
      }),
      [],
    )
    return NextResponse.json({ items: posts })
  }

  if (moduleKey === 'replies') {
    const replies = await safeDb(
      'userModules.replies',
      prisma.reply.findMany({
        where: { authorId: target.id, isDeleted: false, post: { isDeleted: false, status: 'PUBLISHED' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, content: true, createdAt: true, post: { select: { id: true, title: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: replies })
  }

  if (moduleKey === 'achievements') {
    const achievements = await safeDb(
      'userModules.achievements',
      prisma.userAchievement.findMany({
        where: { userId: target.id, unlocked: true, achievement: { isVisible: true } },
        orderBy: [{ unlockedAt: 'desc' }, { createdAt: 'desc' }],
        take: 12,
        select: {
          id: true,
          unlockedAt: true,
          achievement: { select: { title: true, icon: true, rarity: true, category: true, description: true } },
        },
      }),
      [],
    )
    return NextResponse.json({ items: achievements })
  }

  if (moduleKey === 'badges') {
    const badges = await safeDb(
      'userModules.badges',
      prisma.userBadge.findMany({
        where: { userId: target.id, isHidden: false },
        orderBy: { grantedAt: 'desc' },
        take: 12,
        select: { id: true, grantedAt: true, badge: { select: { name: true, description: true, iconUrl: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: badges })
  }

  if (moduleKey === 'albums') {
    const albums = await safeDb(
      'userModules.albums',
      prisma.userAlbumCollection.findMany({
        where: { userId: target.id, owned: true, album: { isVisible: true, type: 'ALBUM' } },
        take: 12,
        select: { id: true, note: true, album: { select: { title: true, slug: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: albums })
  }

  if (moduleKey === 'favorites') {
    if (!viewer || viewer.id !== target.id) return NextResponse.json({ items: [] })
    const favorites = await safeDb(
      'userModules.favorites',
      prisma.postFavorite.findMany({
        where: {
          userId: target.id,
          post: { isDeleted: false, status: 'PUBLISHED', author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          post: {
            select: {
              id: true,
              title: true,
              content: true,
              author: { select: { uid: true, nickname: true, profile: { select: { displayName: true } } } },
            },
          },
        },
      }),
      [],
    )
    return NextResponse.json({ items: favorites })
  }

  return NextResponse.json({ message: '模块不存在' }, { status: 404 })
}
