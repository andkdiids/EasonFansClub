import { NextResponse } from 'next/server'
import { withForumBoardDisplayName } from '@/lib/boards'
import { safeDb } from '@/lib/db-timeout'
import { publicContentImageMarkers } from '@/lib/content-images'
import { publicModerationText } from '@/lib/content-moderation'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { toPublicMediaUrl } from '@/lib/media-url'
import { getProfileRecordPagination, loadProfileRecentMessagesPage, PROFILE_POST_PAGE_SIZE, PROFILE_RECORD_PAGE_SIZE } from '@/lib/profile-page'
import { getProfileRecordPreferences } from '@/lib/profile-record-preferences'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { resolveBadgeVisibility } from '@/lib/badge-visibility'
import { getProfileSalonPosts } from '@/lib/salon'
import { buildProfilePostWhere, buildPublicPostWhere as publicPostWhere } from '@/lib/post-moderation'
import { postContentPlainText } from '@/lib/share-metadata'
import { PROFILE_POST_GROUP_UNGROUPED } from '@/lib/profile-post-groups'
import { getProfileVisibility, isProfileModuleVisible, PUBLIC_PROFILE_MODULE_KEYS, type PublicProfileModuleKey } from '@/lib/user-privacy'
import { resolveRequestAuth } from '@/lib/security'
import { activeUserBadgeWhere } from '@/lib/badge-validity'

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
  const pageParam = moduleKey === 'posts'
    ? searchParams.get('postsPage') || searchParams.get('page') || '1'
    : searchParams.get('page') || '1'
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const viewer = auth.user
  const now = new Date()
  const target = await safeDb('userModules.findUser', findPublicUserId(userId), null)

  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  if (!(PUBLIC_PROFILE_MODULE_KEYS as readonly string[]).includes(moduleKey)) return NextResponse.json({ message: '模块不存在' }, { status: 404 })
  const visibility = await getProfileVisibility(target.id, viewer?.id)
  const typedModuleKey = moduleKey as PublicProfileModuleKey
  const paginationFor = (total: number, requestedPage: number) => getProfileRecordPagination(
    total,
    requestedPage,
    typedModuleKey === 'posts' ? PROFILE_POST_PAGE_SIZE : PROFILE_RECORD_PAGE_SIZE,
  )
  if (!isProfileModuleVisible(visibility.settings, typedModuleKey, visibility.isSelf)) {
    const pagination = typedModuleKey === 'posts' || typedModuleKey === 'recent-messages' ? paginationFor(0, page) : undefined
    return NextResponse.json({ items: [], ...(pagination ? { pagination } : {}), visibility: { visible: false } })
  }
  let recordPreferences
  try {
    recordPreferences = await getProfileRecordPreferences(target.id)
  } catch (error) {
    console.error('[userModules.recordPreferences]', { userId: target.id, error })
    return NextResponse.json({ message: '个人记录暂时无法加载，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  }
  if (!visibility.isSelf && recordPreferences.find((preference) => preference.key === typedModuleKey)?.visible === false) {
    const pagination = typedModuleKey === 'posts' || typedModuleKey === 'recent-messages' || typedModuleKey === 'salon' ? paginationFor(0, page) : undefined
    return NextResponse.json({ items: [], ...(pagination ? { pagination } : {}), visibility: { visible: false } })
  }

  if (typedModuleKey === 'posts') {
    const canViewPendingPosts = Boolean(viewer && (viewer.id === target.id || await hasAdminPermission(viewer, 'post_manage')))
    const requestedGroupId = searchParams.get('groupId')
    const groups = await safeDb(
      'userModules.postGroups',
      prisma.userPostGroup.findMany({
        where: { userId: target.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, sortOrder: true },
      }),
      [],
    )
    if (requestedGroupId && requestedGroupId !== PROFILE_POST_GROUP_UNGROUPED && !groups.some((group) => group.id === requestedGroupId)) {
      return NextResponse.json({ items: [], pagination: paginationFor(0, page), groups })
    }
    const postWhere = buildProfilePostWhere(target.id, canViewPendingPosts)
    if (!canViewPendingPosts) Object.assign(postWhere, { status: 'PUBLISHED' as const })
    if (requestedGroupId === PROFILE_POST_GROUP_UNGROUPED) Object.assign(postWhere, { userPostGroupId: null })
    else if (requestedGroupId) Object.assign(postWhere, { userPostGroupId: requestedGroupId })
    const total = await safeDb('userModules.posts.count', prisma.post.count({ where: postWhere }), 0)
    const pagination = paginationFor(total, page)
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
          richContent: true,
          moderationStatus: true,
          rejectionReason: true,
          profilePinnedAt: true,
          ipRegion: true,
          replyCount: true,
          likeCount: true,
          viewCount: true,
          createdAt: true,
          expiresAt: true,
          userPostGroupId: true,
          Board: { select: { name: true, slug: true } },
        },
      }),
      [],
    )
    return NextResponse.json({
      items: posts.map(({ Board, profilePinnedAt, richContent, ...post }) => ({
        ...post,
        title: publicModerationText(post.title, post.moderationStatus),
        content: publicModerationText(postContentPlainText(post.content, richContent), post.moderationStatus),
        board: withForumBoardDisplayName(Board),
        isProfilePinned: Boolean(profilePinnedAt),
      })),
      pagination,
      groups,
    })
  }

  if (typedModuleKey === 'recent-messages') {
    const result = await safeDb(
      'userModules.recentMessages',
      loadProfileRecentMessagesPage(target.id, viewer?.id, page),
      { messages: [], pagination: getProfileRecordPagination(0, page) },
    )
    return NextResponse.json({ items: result.messages, pagination: result.pagination })
  }

  if (typedModuleKey === 'salon') {
    const result = await safeDb(
      'userModules.salon',
      getProfileSalonPosts(target.id, page, viewer?.id),
      { posts: [], pagination: getProfileRecordPagination(0, page) },
    )
    return NextResponse.json({ items: result.posts, pagination: result.pagination })
  }

  if (typedModuleKey === 'replies') {
    const replies = await safeDb(
      'userModules.replies',
      prisma.reply.findMany({
        where: { authorId: target.id, isDeleted: false, Post: { AND: [publicPostWhere()] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, content: true, moderationStatus: true, createdAt: true, Post: { select: { id: true, title: true, moderationStatus: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: replies.map(({ Post, ...reply }) => ({ ...reply, content: publicModerationText(publicContentImageMarkers(reply.content), reply.moderationStatus), post: { ...Post, title: publicModerationText(Post.title, Post.moderationStatus) } })) })
  }

  if (typedModuleKey === 'achievements') {
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

  if (typedModuleKey === 'badges') {
    const badges = await safeDb(
      'userModules.badges',
      prisma.userBadge.findMany({
        where: {
          userId: target.id,
          ...(visibility.isSelf ? {} : { isHidden: false }),
          ...activeUserBadgeWhere(now),
          ...(visibility.isSelf ? {} : { Badge: { visibility: { not: 'SECRET' as const } } }),
        },
        orderBy: { awardedAt: 'desc' },
        take: 12,
        select: { id: true, isHidden: true, grantedAt: true, Badge: { select: { id: true, name: true, description: true, iconUrl: true, visibility: true } } },
      }),
      [],
    )
    return NextResponse.json({ items: badges.flatMap(({ Badge, isHidden, ...item }) => {
      const decision = resolveBadgeVisibility({
        viewerId: viewer?.id,
        ownerId: target.id,
        badge: Badge,
        userBadge: { isHidden },
        context: 'PROFILE',
      })
      if (!decision.canSeeOwnership || !decision.canSeeMetadata) return []
      const imageUrl = toPublicMediaUrl(Badge.iconUrl)
      return [{ ...item, badge: { ...Badge, iconUrl: imageUrl, imageUrl } }]
    }) })
  }

  if (typedModuleKey === 'albums') {
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

  if (typedModuleKey === 'favorites') {
    if (!viewer || viewer.id !== target.id) return NextResponse.json({ items: [] })
    const favorites = await safeDb(
      'userModules.favorites',
      prisma.postFavorite.findMany({
        where: {
          userId: target.id,
          Post: { AND: [publicPostWhere(), { User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } }] },
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
              richContent: true,
              moderationStatus: true,
              User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
            },
          },
        },
      }),
      [],
    )
    const authorIds = favorites.map((item) => item.Post.User.id)
    const equippedBadges = await getEquippedBadgesForUsers(authorIds, new Date(), viewer?.id)
    return NextResponse.json({
      items: favorites.map(({ Post, ...favorite }) => ({
        ...favorite,
        post: (() => {
          const { richContent, ...post } = Post
          return {
            ...post,
            title: publicModerationText(Post.title, Post.moderationStatus),
            content: publicModerationText(postContentPlainText(Post.content, richContent), Post.moderationStatus),
            author: {
              ...Post.User,
              nickname: getPublicUserDisplayName(Post.User),
              equippedBadges: equippedBadges.get(Post.User.id) || [],
              equippedBadge: equippedBadges.get(Post.User.id)?.[0] || null,
              profile: Post.User.Profile ? {
                ...Post.User.Profile,
                displayName: getPublicUserDisplayName(Post.User),
              } : Post.User.Profile,
            },
          }
        })(),
      })),
    })
  }

  return NextResponse.json({ message: '模块不存在' }, { status: 404 })
}
