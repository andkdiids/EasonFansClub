import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { publicContentImageMarkers } from '@/lib/content-images'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'

type RouteContext = { params: Promise<{ userId: string }> }

async function findPublicUserId(uidParam: string) {
  const uid = parseUidParam(uidParam)
  if (uid === null) return null
  return prisma.user.findFirst({
    where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
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
        where: { authorId: target.id, isDeleted: false, status: 'PUBLISHED', moderationStatus: 'APPROVED' },
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
          Board: { select: { name: true, slug: true } },
        },
      }),
      [],
    )
    return NextResponse.json({ items: posts.map(({ Board, ...post }) => ({ ...post, content: publicContentImageMarkers(post.content), board: Board })) })
  }

  if (moduleKey === 'replies') {
    const replies = await safeDb(
      'userModules.replies',
      prisma.reply.findMany({
        where: { authorId: target.id, isDeleted: false, Post: { isDeleted: false, status: 'PUBLISHED', moderationStatus: 'APPROVED' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, content: true, createdAt: true, Post: { select: { id: true, title: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: replies.map(({ Post, ...reply }) => ({ ...reply, content: publicContentImageMarkers(reply.content), post: Post })) })
  }

  if (moduleKey === 'achievements') {
    const achievements = await safeDb(
      'userModules.achievements',
      prisma.userAchievement.findMany({
        where: { userId: target.id, unlocked: true, Achievement: { isVisible: true } },
        orderBy: [{ unlockedAt: 'desc' }, { createdAt: 'desc' }],
        take: 12,
        select: {
          id: true,
          unlockedAt: true,
          Achievement: { select: { title: true, icon: true, rarity: true, category: true, description: true } },
        },
      }),
      [],
    )
    return NextResponse.json({ items: achievements.map(({ Achievement, ...item }) => ({ ...item, achievement: Achievement })) })
  }

  if (moduleKey === 'badges') {
    const badges = await safeDb(
      'userModules.badges',
      prisma.userBadge.findMany({
        where: { userId: target.id, isHidden: false },
        orderBy: { grantedAt: 'desc' },
        take: 12,
        select: { id: true, grantedAt: true, Badge: { select: { name: true, description: true, iconUrl: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: badges.map(({ Badge, ...item }) => ({ ...item, badge: { ...Badge, iconUrl: toPublicMediaUrl(Badge.iconUrl) } })) })
  }

  if (moduleKey === 'albums') {
    const albums = await safeDb(
      'userModules.albums',
      prisma.userAlbumCollection.findMany({
        where: { userId: target.id, owned: true, CultureItem: { isVisible: true, type: 'ALBUM' } },
        take: 12,
        select: { id: true, note: true, CultureItem: { select: { title: true, slug: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: albums.map(({ CultureItem, ...item }) => ({ ...item, album: CultureItem })) })
  }

  if (moduleKey === 'favorites') {
    if (!viewer || viewer.id !== target.id) return NextResponse.json({ items: [] })
    const favorites = await safeDb(
      'userModules.favorites',
      prisma.postFavorite.findMany({
        where: {
          userId: target.id,
          Post: { isDeleted: false, status: 'PUBLISHED', moderationStatus: 'APPROVED', User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          Post: {
            select: {
              id: true,
              title: true,
              content: true,
              User: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
            },
          },
        },
      }),
      [],
    )
    const remarkMap = await loadFriendRemarkMap(viewer.id, favorites.map((item) => item.Post.User.id))
    return NextResponse.json({
      items: favorites.map(({ Post, ...favorite }) => ({
        ...favorite,
        post: {
          ...Post,
          content: publicContentImageMarkers(Post.content),
          author: {
            ...Post.User,
            profile: Post.User.Profile ? {
              ...Post.User.Profile,
              displayName: resolveFriendDisplayName({
                viewerId: viewer.id,
                targetUserId: Post.User.id,
                fallbackName: getPublicUserDisplayName(Post.User),
                remarkMap,
              }),
            } : Post.User.Profile,
          },
        },
      })),
    })
  }

  return NextResponse.json({ message: '模块不存在' }, { status: 404 })
}
