import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { AdminPostActions, DeletePostButton, FavoriteButton, LikeButton, PostManagementMenu } from '@/components/PostActions'
import { BackButton } from '@/components/BackButton'
import { CommentSectionBoundary } from '@/components/CommentSectionBoundary'
import { PostMediaCarousel } from '@/components/PostMediaCarousel'
import { LikeAvatars } from '@/components/LikeAvatars'
import { PostRepliesSection } from '@/components/PostRepliesSection'
import { PostViewCounter } from '@/components/PostViewCounter'
import { IpRegionLabel } from '@/components/IpRegionLabel'
import { ForumDiscoveryActionBar } from '@/components/ForumDiscoveryActionBar'
import { ForumDiscoveryDetailController } from '@/components/ForumDiscoveryDetailController'
import { ForumDiscoveryDetailTopbar } from '@/components/ForumDiscoveryDetailTopbar'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { formatDate } from '@/lib/format'
import { publicContentImageMarkers } from '@/lib/content-images'
import { publicModerationText } from '@/lib/content-moderation'
import { isSupabaseStorageUrl, profileImageUrl, publicImageUrl } from '@/lib/images'
import { getPostModerationAccess } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { MarkModerationReadOnMount } from '@/components/MarkModerationReadOnMount'
import { markPersonalNotificationsForTargetRead } from '@/lib/notifications'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { emitRealtime } from '@/lib/realtime'
import {
  clampPostReplyPage,
  getPostReplyOffset,
  getPostReplyOrderBy,
  getPostReplyTotalPages,
  parsePostReplySort,
  POST_REPLY_PAGE_SIZE,
  type PostReplySort,
} from '@/lib/post-replies'

export const dynamic = 'force-dynamic'

function PostLoadFallback() {
  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-5 py-8">
        <section className="rounded-2xl border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Post</p>
          <h1 className="mt-3 text-3xl font-black text-brand-950">帖子暂时无法加载，请稍后重试</h1>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-500">
            数据库连接可能正在恢复中。请稍后刷新页面，或返回 E院广场继续浏览。
          </p>
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">
            返回首页
          </Link>
        </section>
      </main>
    </>
  )
}

function PostUnavailableFallback({ reason }: Readonly<{ reason: 'POST' | 'AUTHOR' }>) {
  const title = reason === 'POST' ? '该帖子已被删除或无法查看' : '该帖子作者资料暂时无法查看'
  const description = reason === 'POST'
    ? '帖子可能已被删除、撤回或尚未公开。'
    : '作者账号或公开资料当前不可用。'

  return (
    <main className="site-page-main flat-page mx-auto max-w-7xl px-5 py-8">
      <section className="rounded-2xl border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Post</p>
        <h1 className="mt-3 text-3xl font-black text-brand-950">{title}</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-500">{description}</p>
        <Link href="/forum" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">
          返回 E院广场
        </Link>
      </section>
    </main>
  )
}

// 帖子审核中：用户通过通知/收藏/历史链接进入 PENDING 帖子时显示，而非 404。
function ModerationFallbackActions({ postId, canEdit }: Readonly<{ postId: string; canEdit: boolean }>) {
  if (!canEdit) return null
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Link href={`/posts/${postId}/edit`} className="inline-flex min-h-11 items-center rounded-full border border-sky-200 bg-white px-5 text-sm font-black text-brand-700">
        编辑
      </Link>
      <DeletePostButton postId={postId} redirectTo="/forum" />
    </div>
  )
}

function ModerationPendingFallback({ postId, canEdit }: Readonly<{ postId: string; canEdit: boolean }>) {
  return (
    <main className="site-page-main flat-page mx-auto max-w-7xl px-5 py-8">
      <section className="rounded-2xl border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-600">审核中</p>
        <h1 className="mt-3 text-3xl font-black text-brand-950">帖子审核中</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-500">
          该帖子正在等待审核，审核通过后即可正常查看。
        </p>
        <ModerationFallbackActions postId={postId} canEdit={canEdit} />
        <Link href="/forum" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">
          返回 E院广场
        </Link>
      </section>
    </main>
  )
}

// 帖子未通过审核：REJECTED 帖子显示提示，而非 404。
function ModerationRejectedFallback({ postId, canEdit, rejectionReason }: Readonly<{ postId: string; canEdit: boolean; rejectionReason: string | null }>) {
  return (
    <main className="site-page-main flat-page mx-auto max-w-7xl px-5 py-8">
      <section className="rounded-2xl border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-red-600">未通过审核</p>
        <h1 className="mt-3 text-3xl font-black text-brand-950">帖子未通过审核</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-500">
          该帖子未通过审核，暂时无法查看。
        </p>
        {rejectionReason ? <p className="mt-3 whitespace-pre-wrap text-left text-sm font-bold leading-7 text-red-700">拒绝原因：{rejectionReason}</p> : null}
        <ModerationFallbackActions postId={postId} canEdit={canEdit} />
        <Link href="/forum" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">
          返回 E院广场
        </Link>
      </section>
    </main>
  )
}

function loadPost(postId: string, userId?: string) {
  return prisma.post.findFirst({
    where: { id: postId },
    include: {
      User: {
        select: {
          uid: true,
          id: true,
          nickname: true,
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
          level: true,
          avatarUrl: true,
          status: true,
          isDeleted: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
      Board: { select: { name: true, slug: true } },
      sticker: { select: { url: true, name: true, moderationStatus: true, type: true } },
      // 最新 10 个点赞用户（朋友圈式头像展示）；当前用户是否点赞由页面里的批量查询单独判断。
      Like: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          userId: true,
          User: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              usernameModerationStatus: true,
              nicknameModerationStatus: true,
              avatarUrl: true,
              Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
            },
          },
        },
      },
      PostFavorite: userId ? { where: { userId }, select: { id: true } } : false,
      PostMedia: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' } },
    },
  })
}


const replyDetailSelect = {
  id: true,
  content: true,
  moderationStatus: true,
  parentId: true,
  likeCount: true,
  isPinned: true,
  ipRegion: true,
  stickerId: true,
  sticker: { select: { url: true } },
  ReplyLike: {
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      userId: true,
      User: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
    },
  },
  ReplyMention: {
    orderBy: { startIndex: 'asc' },
    select: {
      id: true,
      startIndex: true,
      endIndex: true,
      User_ReplyMention_mentionedUserIdToUser: {
        select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } },
      },
    },
  },
  createdAt: true,
  User: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      level: true,
      avatarUrl: true,
      status: true,
      isDeleted: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.ReplySelect

async function loadPostReplies(postId: string, sort: PostReplySort, requestedPage: number) {
  return prisma.$transaction(async (tx) => {
    const [pinnedReply, normalTotal] = await Promise.all([
      tx.reply.findFirst({
        where: { postId, isDeleted: false, parentId: null, isPinned: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: replyDetailSelect,
      }),
      tx.reply.count({ where: { postId, isDeleted: false, parentId: null, isPinned: false } }),
    ])
    const totalPages = getPostReplyTotalPages(normalTotal)
    const page = clampPostReplyPage(requestedPage, totalPages)
    const normalRoots = await tx.reply.findMany({
      where: { postId, isDeleted: false, parentId: null, isPinned: false },
      orderBy: getPostReplyOrderBy(sort),
      skip: getPostReplyOffset(page),
      take: POST_REPLY_PAGE_SIZE,
      select: replyDetailSelect,
    })

    const rootIds = [pinnedReply?.id, ...normalRoots.map((reply) => reply.id)].filter((id): id is string => Boolean(id))
    const childRows = rootIds.length
      ? await tx.reply.findMany({
          where: { postId, isDeleted: false, parentId: { not: null } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: replyDetailSelect,
        })
      : []
    const includedRootIds = new Set(rootIds)
    let added = true
    while (added) {
      added = false
      for (const child of childRows) {
        if (child.parentId && includedRootIds.has(child.parentId) && !includedRootIds.has(child.id)) {
          includedRootIds.add(child.id)
          added = true
        }
      }
    }

    return {
      rows: [
        ...(pinnedReply ? [pinnedReply] : []),
        ...normalRoots,
        ...childRows.filter((reply) => includedRootIds.has(reply.id)),
      ],
      total: normalTotal,
      totalPages,
      page,
    }
  })
}

type FocusedReply = {
  id: string
  content: string
  moderationStatus: 'NORMAL' | 'VIOLATION'
  parentId: string | null
  likeCount: number
  isPinned: boolean
  ipRegion: string | null
  createdAt: Date
  stickerId: string | null
  sticker: { url: string } | null
  mentions: Array<{
    id: string
    startIndex: number
    endIndex: number
    user: { id: string; uid: number; name: string }
  }>
  author: {
    id: string
    uid: number
    nickname: string
    usernameModerationStatus: 'NORMAL' | 'VIOLATION'
    nicknameModerationStatus: 'NORMAL' | 'VIOLATION'
    level: number
    avatarUrl: string | null
    profile: { displayName: string; displayNameModerationStatus: 'NORMAL' | 'VIOLATION'; avatarUrl: string | null } | null
  }
}

type FocusedReplyQueryRow = {
  id: string
  content: string
  moderationStatus: 'NORMAL' | 'VIOLATION'
  parentId: string | null
  likeCount: number
  isPinned: boolean
  ipRegion: string | null
  createdAt: Date
  stickerId: string | null
  sticker: { url: string } | null
  User: Omit<FocusedReply['author'], 'profile'> & {
    Profile: FocusedReply['author']['profile']
  }
  ReplyMention: Array<{
    id: string
    startIndex: number
    endIndex: number
    User_ReplyMention_mentionedUserIdToUser: {
      id: string
      uid: number
      nickname: string
      Profile: { displayName: string } | null
    }
  }>
}

async function loadFocusedReplyChain(postId: string, focusId: string) {
  const chain: Array<FocusedReply & { likes: [] }> = []
  let currentId: string | null = focusId
  for (let depth = 0; currentId && depth < 12; depth += 1) {
    const row: FocusedReplyQueryRow | null = await prisma.reply.findFirst({
      where: { id: currentId, postId, isDeleted: false, User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } },
      select: {
        id: true,
        content: true,
        moderationStatus: true,
        parentId: true,
        likeCount: true,
         isPinned: true,
         ipRegion: true,
         createdAt: true,
        stickerId: true,
        sticker: { select: { url: true } },
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            usernameModerationStatus: true,
            nicknameModerationStatus: true,
            level: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
          },
        },
        ReplyMention: {
          orderBy: { startIndex: 'asc' },
          select: {
            id: true,
            startIndex: true,
            endIndex: true,
            User_ReplyMention_mentionedUserIdToUser: {
        select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } },
            },
          },
        },
      },
    })
    if (!row) break
    const { User: replyUser, ReplyMention: replyMentions, ...replyRow } = row
    chain.unshift({
      ...replyRow,
      mentions: replyMentions.map(({ User_ReplyMention_mentionedUserIdToUser: mentionedUser, ...mention }) => ({
        ...mention,
        user: {
          id: mentionedUser.id,
          uid: mentionedUser.uid,
          name: getPublicUserDisplayName(mentionedUser),
        },
      })),
      author: { ...replyUser, profile: replyUser.Profile },
      likes: [],
    })
    currentId = row.parentId
  }
  return chain
}

export default async function PostDetailPage({ params, searchParams }: Readonly<{ params: Promise<{ postId: string }>; searchParams: Promise<{ focus?: string; commentSort?: string; commentPage?: string }> }>) {
  const { postId } = await params
  const query = await searchParams
  const focusId = query.focus?.slice(0, 80)
  const commentSort = parsePostReplySort(query.commentSort)
  const requestedCommentPage = Math.max(1, Number.parseInt(query.commentPage || '1', 10) || 1)
  const user = await getCurrentUser()

  let post: Awaited<ReturnType<typeof loadPost>>
  try {
    post = await loadPost(postId, user?.id)
  } catch (error) {
    console.error('[post:detail:load-error]', { postId, userId: user?.id, error })
    return <PostLoadFallback />
  }

  if (post === null) {
    notFound()
  }

  // 审核状态处理：用户可能通过通知/收藏/历史链接进入未审核帖子。
  // 非管理员访问 PENDING/REJECTED 帖子时显示审核提示页，而非 404。
  // 管理员可查看全部（保持现有权限）；普通用户只能查看 APPROVED。
  const viewerIsAdmin = Boolean(user && await hasAdminPermission(user, 'post_manage'))
  const viewerIsAuthor = Boolean(user && user.id === post.authorId)
  const moderationAccess = getPostModerationAccess(post.moderationStatus, viewerIsAdmin, viewerIsAuthor)
  if (moderationAccess === 'PENDING') {
    return <ModerationPendingFallback postId={postId} canEdit={viewerIsAuthor} />
  }
  if (moderationAccess === 'REJECTED') {
    return <ModerationRejectedFallback postId={postId} canEdit={viewerIsAuthor} rejectionReason={post.rejectionReason} />
  }

  if (post.isDeleted || post.status !== 'PUBLISHED') {
    return <PostUnavailableFallback reason="POST" />
  }

  if (post.User.isDeleted || post.User.status !== 'ACTIVE' || !post.User.Profile) {
    console.warn('[post:detail:unavailable]', {
      postId,
      reason: post.User.isDeleted
        ? 'AUTHOR_DELETED'
        : post.User.status !== 'ACTIVE'
          ? 'AUTHOR_INACTIVE'
          : 'AUTHOR_PROFILE_MISSING',
      authorStatus: post.User.status,
      authorIsDeleted: post.User.isDeleted,
      authorHasProfile: Boolean(post.User.Profile),
    })
    return <PostUnavailableFallback reason="AUTHOR" />
  }

  let commentsLoadError = false
  let postReplies: Awaited<ReturnType<typeof loadPostReplies>>['rows'] = []
  let commentPage = 1
  let commentTotalPages = 1
  try {
    const loadedReplies = await loadPostReplies(postId, commentSort, requestedCommentPage)
    postReplies = loadedReplies.rows
    commentPage = loadedReplies.page
    commentTotalPages = loadedReplies.totalPages
  } catch (error) {
    commentsLoadError = true
    console.error('[post:comments:load-failed]', { postId, userId: user?.id, error })
  }

  if (focusId && !postReplies.some((reply) => reply.id === focusId)) {
    try {
      const focusedReplies = await loadFocusedReplyChain(postId, focusId)
      const existingIds = new Set(postReplies.map((reply) => reply.id))
      postReplies.push(...focusedReplies.filter((reply) => !existingIds.has(reply.id)).map((reply) => ({
        id: reply.id,
        content: reply.content,
        moderationStatus: reply.moderationStatus,
        parentId: reply.parentId,
        likeCount: reply.likeCount,
        isPinned: reply.isPinned,
        ipRegion: reply.ipRegion,
        createdAt: reply.createdAt,
        stickerId: reply.stickerId,
        sticker: reply.sticker,
        User: { ...reply.author, status: 'ACTIVE' as const, isDeleted: false, Profile: reply.author.profile },
        ReplyLike: [],
        ReplyMention: reply.mentions.map((mention) => ({
          id: mention.id,
          startIndex: mention.startIndex,
          endIndex: mention.endIndex,
          User_ReplyMention_mentionedUserIdToUser: {
            id: mention.user.id,
            uid: mention.user.uid,
            nickname: mention.user.name,
            usernameModerationStatus: 'NORMAL' as const,
            nicknameModerationStatus: 'NORMAL' as const,
            Profile: { displayName: mention.user.name, displayNameModerationStatus: 'NORMAL' as const },
          },
        })),
      })))
    } catch (error) {
      commentsLoadError = true
      console.warn('[post:comments:focus-load-failed]', { postId, focusId, error })
    }
  }

  const focusedReplyExists = Boolean(focusId && postReplies.some((reply) => reply.id === focusId))
  if (user && (!focusId || focusedReplyExists)) {
    const markedNotifications = await markPersonalNotificationsForTargetRead({
      userId: user.id,
      linkPrefix: focusId ? `/posts/${postId}?focus=${focusId}` : `/posts/${postId}`,
      types: focusId ? ['REPLY', 'LIKE'] : ['LIKE'],
    }).catch((error) => {
      console.warn('[post:notifications:mark-read-failed]', { postId, focusId, error })
      return 0
    })
    if (markedNotifications > 0) emitRealtime(user.id, 'notification')
  }

  const displayNameUserIds = [
    post.User.id,
    ...post.Like.map((like) => like.userId),
    ...postReplies.flatMap((reply) => [
      reply.User.id,
      ...reply.ReplyLike.map((like) => like.userId),
      ...reply.ReplyMention.map((mention) => mention.User_ReplyMention_mentionedUserIdToUser.id),
    ]),
  ]
  const remarkMap = await loadFriendRemarkMap(user?.id, displayNameUserIds)

  // 当前用户的点赞状态：两次恒定数量的批量查询（避免 N+1）；点赞用户头像列表由 Like / ReplyLike include 提供。
  let viewerPostLiked = false
  const viewerLikedReplyIds = new Set<string>()
  if (user) {
    try {
      const [viewerPostLike, viewerReplyLikes] = await Promise.all([
        prisma.like.findUnique({ where: { postId_userId: { postId, userId: user.id } }, select: { id: true } }),
        prisma.replyLike.findMany({
          where: { userId: user.id, replyId: { in: postReplies.map((reply) => reply.id) } },
          select: { replyId: true },
        }),
      ])
      viewerPostLiked = Boolean(viewerPostLike)
      viewerReplyLikes.forEach((like) => viewerLikedReplyIds.add(like.replyId))
    } catch (error) {
      console.warn('[post:detail:viewer-likes-failed]', { postId, error })
    }
  }

  const liked = viewerPostLiked
  const favorited = Array.isArray(post.PostFavorite) && post.PostFavorite.length > 0
  const authorAvatar = publicImageVariantUrl(profileImageUrl(post.User.Profile.avatarUrl || post.User.avatarUrl), 'avatar-md')
  const authorName = resolveFriendDisplayName({
    viewerId: user?.id,
    targetUserId: post.User.id,
    fallbackName: getPublicUserDisplayName(post.User),
    remarkMap,
  })
  const isArchivedAuthor = post.User.uid === 0
  const canManagePost = Boolean(user && await hasAdminPermission(user, 'post_manage'))
  const canManageReplies = Boolean(user && await hasAdminPermission(user, 'reply_manage'))
  const canDeletePost = Boolean(user && (user.id === post.User.id || canManagePost))
  const canEditPost = Boolean(user && (user.id === post.User.id || canManagePost))
  const publicPostContent = publicContentImageMarkers(post.content)
  const publicPostTitle = publicModerationText(post.title, post.moderationStatus)
  const safePublicPostContent = publicModerationText(publicPostContent, post.moderationStatus)
  const replyRows = postReplies.map(({ ReplyLike, ReplyMention, User, ...reply }) => ({
    ...reply,
    content: publicModerationText(publicContentImageMarkers(reply.content), reply.moderationStatus),
    stickerId: reply.stickerId ?? null,
    stickerUrl: publicImageUrl(reply.sticker?.url),
    author: User.status === 'ACTIVE' && !User.isDeleted
      ? { ...User, nickname: getPublicUserDisplayName(User), profile: User.Profile ? {
          ...User.Profile,
          displayName: resolveFriendDisplayName({
            viewerId: user?.id,
            targetUserId: User.id,
            fallbackName: getPublicUserDisplayName(User),
            remarkMap,
          }),
        } : User.Profile }
      : { id: '', uid: 0, nickname: '已注销用户', level: 0, avatarUrl: null, profile: null },
    liked: viewerLikedReplyIds.has(reply.id),
    likers: Array.isArray(ReplyLike)
      ? ReplyLike.map((like) => ({
          uid: like.User.uid,
          nickname: getPublicUserDisplayName(like.User),
          displayName: resolveFriendDisplayName({
            viewerId: user?.id,
            targetUserId: like.userId,
            fallbackName: getPublicUserDisplayName(like.User),
            remarkMap,
          }),
          avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
        }))
      : [],
    mentions: ReplyMention.map(({ User_ReplyMention_mentionedUserIdToUser: mentionedUser, ...mention }) => ({
      ...mention,
      user: {
        id: mentionedUser.id,
        uid: mentionedUser.uid,
        name: resolveFriendDisplayName({
          viewerId: user?.id,
          targetUserId: mentionedUser.id,
          fallbackName: getPublicUserDisplayName(mentionedUser),
          remarkMap,
        }),
      },
    })),
  }))
  const directReplyCount = new Map<string, number>()
  replyRows.forEach((reply) => {
    if (reply.parentId) directReplyCount.set(reply.parentId, (directReplyCount.get(reply.parentId) || 0) + 1)
  })
  const hotReplyIds = replyRows
    .filter((reply) => !reply.parentId && (reply.likeCount >= 3 || (directReplyCount.get(reply.id) || 0) >= 2))
    .sort((a, b) => {
      const aReplies = directReplyCount.get(a.id) || 0
      const bReplies = directReplyCount.get(b.id) || 0
      return (b.likeCount * 2 + bReplies * 3) - (a.likeCount * 2 + aReplies * 3)
        || b.likeCount - a.likeCount
        || bReplies - aReplies
        || a.createdAt.getTime() - b.createdAt.getTime()
    })
    .slice(0, 3)
    .map((reply) => reply.id)

  return (
    <ForumDiscoveryDetailController>
      <>
      <main className="forum-discovery-detail-shell site-page-main flat-page mx-auto max-w-7xl space-y-6 px-5 py-8">
        {user ? <MarkModerationReadOnMount /> : null}
        {viewerIsAuthor && post.moderationStatus === 'PENDING' ? (
          <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black leading-6 text-amber-800">
            修改已保存，正在等待审核，审核通过后会重新展示。当前内容仅你可见。
          </div>
        ) : null}
        {viewerIsAuthor && post.moderationStatus === 'REJECTED' ? (
          <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-black leading-6 text-red-800">
            审核未通过{post.rejectionReason ? `：${post.rejectionReason}` : '，请修改后重新提交。'}
          </div>
        ) : null}
        <ForumDiscoveryDetailTopbar
          authorName={authorName}
          authorAvatar={authorAvatar}
          authorUid={post.User.uid}
          postActions={canManagePost || canDeletePost || canEditPost ? (
            <PostManagementMenu
              postId={post.id}
              initialIsPinned={post.isPinned}
              initialIsFeatured={post.isFeatured}
              canManage={canManagePost}
              canDelete={canDeletePost}
              canEdit={canEditPost}
              redirectTo="/forum"
            />
          ) : null}
        />
        <div className="forum-discovery-detail-legacy-back"><BackButton fallbackHref="/forum" /></div>
        <article className="post-detail-article border border-sky-100 bg-white/85 p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">置顶</span> : null}
            {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">精华</span> : null}
            <Link href={`/boards/${post.Board.slug}`} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">
              {post.Board.name}
            </Link>
          </div>
          <h1 className="text-4xl font-black leading-tight text-brand-950">{publicPostTitle}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm font-bold text-slate-500">
            {isArchivedAuthor ? (
              <span className="flex items-center gap-2 text-brand-950">
                <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-slate-900 text-white">E</span>
                <span>{authorName}</span>
              </span>
            ) : (
              <Link href={`/user/${formatUid(post.User.uid)}`} className="flex items-center gap-2 text-brand-950">
                <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                  {authorAvatar ? <img src={authorAvatar} alt={authorName} className="h-full w-full object-cover" /> : formatUid(post.User.uid).slice(0, 1)}
                </span>
                <span>{authorName} · Lv.{post.User.level}</span>
              </Link>
            )}
            <span>{formatDate(post.createdAt)}</span>
            <IpRegionLabel ipRegion={post.ipRegion} />
            <PostViewCounter postId={post.id} initialCount={post.viewCount} />
            <span>回复 {post.replyCount}</span>
          </div>
          <div className="mt-8 whitespace-pre-wrap text-lg leading-9 text-slate-700 post-detail-body">{safePublicPostContent}</div>
          {post.sticker?.url ? (
            <div className="mt-6 post-detail-sticker">
              {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={publicImageVariantUrl(post.sticker.url, 'thumb-md') || post.sticker.url} alt={publicModerationText(post.sticker.name, post.sticker.moderationStatus) || '表情'} className="h-auto max-h-72 w-auto max-w-full rounded-xl bg-white object-contain" loading="lazy" />
            </div>
          ) : null}
          {post.PostMedia.length ? (
            <PostMediaCarousel
              items={post.PostMedia.map((item) => ({
                id: item.id,
                url: publicImageUrl(item.url) || item.url,
                broken: isSupabaseStorageUrl(item.url),
              }))}
            />
          ) : null}
          <div className="post-detail-legacy-actions mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-sky-100 pt-5">
            <div className="flex flex-wrap gap-2">
              <LikeButton postId={post.id} initialLiked={liked} initialCount={post.likeCount} />
              <FavoriteButton postId={post.id} initialFavorited={favorited} initialCount={post.favoriteCount} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManagePost ? (
                <AdminPostActions postId={post.id} isPinned={post.isPinned} isFeatured={post.isFeatured} redirectTo="/forum" />
              ) : canDeletePost ? (
                <DeletePostButton postId={post.id} redirectTo="/forum" />
              ) : null}
            </div>
          </div>
          <LikeAvatars
            likers={(post.Like || []).map((like) => ({
              uid: like.User.uid,
              nickname: getPublicUserDisplayName(like.User),
              displayName: getPublicUserDisplayName(like.User),
              avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
            }))}
            totalCount={post.likeCount}
            listUrl={`/api/posts/${post.id}/like`}
            className="mt-3 post-detail-like-avatars"
          />
        </article>

        <CommentSectionBoundary>
          <PostRepliesSection
            key={`${commentSort}:${commentPage}`}
            postId={post.id}
            initialReplies={replyRows}
            initialReplyCount={post.replyCount}
            currentUserId={user?.id}
            canManageReplies={canManageReplies}
            postAuthorId={post.User.id}
            focusId={focusId}
            sort={commentSort}
            page={commentPage}
            totalPages={commentTotalPages}
            hotReplyIds={hotReplyIds}
            commentsLoadError={commentsLoadError}
          />
        </CommentSectionBoundary>
      </main>
      <ForumDiscoveryActionBar
        postId={post.id}
        currentUserId={user?.id}
        initialLiked={liked}
        initialLikeCount={post.likeCount}
        initialFavorited={favorited}
        initialFavoriteCount={post.favoriteCount}
        initialReplyCount={post.replyCount}
      />
      </>
    </ForumDiscoveryDetailController>
  )
}
