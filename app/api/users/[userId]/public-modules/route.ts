import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { publicContentImageMarkers } from '@/lib/content-images'
import { publicModerationText } from '@/lib/content-moderation'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { toPublicMediaUrl } from '@/lib/media-url'
import { getProfileRecordPagination, loadProfileRecentMessagesPage } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'
import { hasAdminPermission } from '@/lib/admin-permissions'

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
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const viewer = await getCurrentUser()
  const target = await safeDb('userModules.findUser', findPublicUserId(userId), null)

  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  if (moduleKey === 'posts') {
    const canViewPendingPosts = Boolean(viewer && (viewer.id === target.id || await hasAdminPermission(viewer, 'post_manage')))
    const postWhere = canViewPendingPosts
      ? { authorId: target.id, isDeleted: false, status: 'PUBLISHED' as const }
      : { authorId: target.id, isDeleted: false, status: 'PUBLISHED' as const, moderationStatus: { in: ['APPROVED', 'VIOLATION'] as Array<'APPROVED' | 'VIOLATION'> } }
    const total = await safeDb('userModules.posts.count', prisma.post.count({ where: postWhere }), 0)
    const pagination = getProfileRecordPagination(total, page)
    const posts = await safeDb(
      'userModules.posts',
      prisma.post.findMany({
        where: postWhere,
        orderBy: [{ profilePinnedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        select: {
          id: true,
          title: true,
          content: true,
          moderationStatus: true,
          rejectionReason: true,
          profilePinnedAt: true,
          ipRegion: true,
          replyCount: true,
          likeCount: true,
          viewCount: true,
          createdAt: true,
          Board: { select: { name: true, slug: true } },
        },
      }),
      [],
    )
    return NextResponse.json({
      items: posts.map(({ Board, profilePinnedAt, ...post }) => ({
        ...post,
        title: publicModerationText(post.title, post.moderationStatus),
        content: publicModerationText(publicContentImageMarkers(post.content), post.moderationStatus),
        board: Board,
        isProfilePinned: Boolean(profilePinnedAt),
      })),
      pagination,
    })
  }

  if (moduleKey === 'recent-messages') {
    const result = await safeDb(
      'userModules.recentMessages',
      loadProfileRecentMessagesPage(target.id, viewer?.id, page),
      { messages: [], pagination: getProfileRecordPagination(0, page) },
    )
    return NextResponse.json({ items: result.messages, pagination: result.pagination })
  }

  if (moduleKey === 'replies') {
    const replies = await safeDb(
      'userModules.replies',
      prisma.reply.findMany({
        where: { authorId: target.id, isDeleted: false, Post: { isDeleted: false, status: 'PUBLISHED', moderationStatus: { in: ['APPROVED', 'VIOLATION'] } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, content: true, moderationStatus: true, createdAt: true, Post: { select: { id: true, title: true, moderationStatus: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: replies.map(({ Post, ...reply }) => ({ ...reply, content: publicModerationText(publicContentImageMarkers(reply.content), reply.moderationStatus), post: { ...Post, title: publicModerationText(Post.title, Post.moderationStatus) } })) })
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
          Post: { isDeleted: false, status: 'PUBLISHED', moderationStatus: { in: ['APPROVED', 'VIOLATION'] }, User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } },
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
              moderationStatus: true,
              User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
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
          title: publicModerationText(Post.title, Post.moderationStatus),
          content: publicModerationText(publicContentImageMarkers(Post.content), Post.moderationStatus),
          author: {
            ...Post.User,
            nickname: getPublicUserDisplayName(Post.User),
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
