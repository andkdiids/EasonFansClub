import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import type { Metadata } from 'next'
import { AdminPostActions, DeletePostButton, FavoriteButton, LikeButton, PostManagementMenu } from '@/components/PostActions'
import { BackButton } from '@/components/BackButton'
import { CommentSectionBoundary } from '@/components/CommentSectionBoundary'
import { RichPostContent } from '@/components/posts/RichPostContent'
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
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { formatDate } from '@/lib/format'
import { publicContentImageMarkers } from '@/lib/content-images'
import { publicModerationText } from '@/lib/content-moderation'
import { isSupabaseStorageUrl, profileImageUrl, publicImageUrl } from '@/lib/images'
import { getPostModerationAccess, publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { isRetryableDatabaseConnectionError } from '@/lib/db-timeout'
import { MarkModerationReadOnMount } from '@/components/MarkModerationReadOnMount'
import { markPersonalNotificationsForTargetRead } from '@/lib/notifications'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { emitRealtime } from '@/lib/realtime'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { UserDisplayName } from '@/components/UserDisplayName'
import { buildPostMetadata, createPostShareDescription, createPostShareTitle, firstAbsoluteMetadataImageUrl, firstShareCardImageUrl, metadataImageVariantUrl, postContentPlainText } from '@/lib/share-metadata'
import { canonicalShareUrl, type ShareCardData } from '@/lib/share-card'
import { validateRichPostContent } from '@/lib/rich-text'
import {
  clampPostReplyPage,
  getPostReplyOffset,
  getPostReplyOrderBy,
  getPostReplyTotalPages,
  parsePostReplyDirection,
  parsePostReplySort,
  POST_REPLY_PAGE_SIZE,
  type PostReplyDirection,
  type PostReplyPagination,
  type PostReplySort,
} from '@/lib/post-replies'

export const dynamic = 'force-dynamic'

const postMetadataSelect = {
  title: true,
  content: true,
  richContent: true,
  moderationStatus: true,
  PostMedia: {
    where: { type: 'IMAGE' as const },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: 9,
    select: { url: true },
  },
  User: {
    select: {
      status: true,
      isDeleted: true,
      Profile: { select: { id: true } },
    },
  },
} satisfies Prisma.PostSelect

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ postId: string }> }>): Promise<Metadata> {
  const { postId } = await params
  try {
    const post = await prisma.post.findFirst({
      where: {
        id: postId,
        ...publicPostWhere,
        User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      },
      select: postMetadataSelect,
    })
    if (!post) return buildPostMetadata({ postId, isPublic: false })

    const publicContent = publicModerationText(publicContentImageMarkers(post.content), post.moderationStatus)
    const richResult = post.moderationStatus === 'VIOLATION' ? null : validateRichPostContent(post.richContent)
    const publicRichContent = richResult?.valid ? richResult.value : null
    const imageUrl = firstAbsoluteMetadataImageUrl(post.PostMedia.map(({ url }) => metadataImageVariantUrl(url)))
    return buildPostMetadata({
      postId,
      title: publicModerationText(post.title, post.moderationStatus),
      content: publicContent,
      richContent: publicRichContent,
      imageUrl,
    })
  } catch {
    // A failed metadata read must fail closed: generic, noindex metadata does
    // not reveal a post title, body, or private image URL.
    return buildPostMetadata({ postId, isPublic: false })
  }
}

function postDetailErrorCode(error: unknown) {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null
  return typeof record?.code === 'string' || typeof record?.code === 'number' ? String(record.code) : undefined
}

function isDatabasePostDetailError(error: unknown) {
  const code = postDetailErrorCode(error)
  return isRetryableDatabaseConnectionError(error) || Boolean(code?.startsWith('P'))
}

function PostLoadFallback({ postId, databaseUnavailable }: Readonly<{ postId: string; databaseUnavailable: boolean }>) {
  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-5 py-8">
        <section className="rounded-2xl border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Post</p>
          <h1 className="mt-3 text-3xl font-black text-brand-950">帖子暂时无法加载，请稍后重试</h1>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-500">
            {databaseUnavailable ? '数据库连接可能正在恢复中。' : '帖子服务暂时不可用。'} 请稍后刷新页面，或返回 E院广场继续浏览。
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={`/posts/${encodeURIComponent(postId)}`} className="inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">
              重新加载
            </Link>
            <Link href="/forum" className="inline-flex min-h-11 items-center rounded-full border border-sky-200 bg-white px-5 text-sm font-black text-brand-700">
              返回 E院广场
            </Link>
          </div>
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

const postCoreSelect = {
  id: true,
  title: true,
  content: true,
  richContent: true,
  ipRegion: true,
  viewCount: true,
  likeCount: true,
  replyCount: true,
  isPinned: true,
  isFeatured: true,
  isDeleted: true,
  createdAt: true,
  authorId: true,
  boardId: true,
  favoriteCount: true,
  status: true,
  moderationStatus: true,
  rejectionReason: true,
  stickerId: true,
} satisfies Prisma.PostSelect

type PostCore = Prisma.PostGetPayload<{ select: typeof postCoreSelect }>

const postAuthorSelect = {
  uid: true,
  id: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  level: true,
  avatarUrl: true,
  status: true,
  isDeleted: true,
  Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
} satisfies Prisma.UserSelect

type PostAuthor = Prisma.UserGetPayload<{ select: typeof postAuthorSelect }>

const postLikerSelect = {
  id: true,
  uid: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect

const postLikeSelect = {
  User: { select: postLikerSelect },
} satisfies Prisma.LikeSelect

type PostLike = Prisma.LikeGetPayload<{ select: typeof postLikeSelect }>

const postBoardSelect = { name: true, slug: true } satisfies Prisma.BoardSelect
type PostBoard = Prisma.BoardGetPayload<{ select: typeof postBoardSelect }>

const postStickerSelect = { url: true, name: true, moderationStatus: true, type: true } satisfies Prisma.StickerSelect
type PostSticker = Prisma.StickerGetPayload<{ select: typeof postStickerSelect }>

const postMediaSelect = { id: true, url: true } satisfies Prisma.PostMediaSelect
type PostMedia = Prisma.PostMediaGetPayload<{ select: typeof postMediaSelect }>

function postDetailErrorInfo(error: unknown) {
  const errorCode = postDetailErrorCode(error)
  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorCode,
    retryable: isRetryableDatabaseConnectionError(error),
  }
}

type PostDetailLogChannel = 'detail' | 'current-user' | 'support' | 'comments' | 'focused-reply' | 'permission' | 'engagement'

function logPostDetailReadError({
  postId,
  channel,
  operation,
  error,
  startedAt,
  attempt = 1,
  userId,
}: Readonly<{
  postId: string
  channel: PostDetailLogChannel
  operation: string
  error: unknown
  startedAt: number
  attempt?: number
  userId?: string
}>) {
  console.error(`[post.${channel}.load.error]`, {
    postId,
    userId,
    operation,
    attempt,
    durationMs: Date.now() - startedAt,
    ...postDetailErrorInfo(error),
  })
}

function readPostDetailQuery<T>(
  postId: string,
  operation: string,
  query: () => Promise<T>,
  channel: PostDetailLogChannel = 'support',
  userId?: string,
  attempt = 1,
) {
  const startedAt = Date.now()
  return Promise.resolve()
    .then(query)
    .catch((error) => {
      logPostDetailReadError({ postId, channel, operation, error, startedAt, attempt, userId })
      throw error
    })
}

const transientRetryDelayMs = 150

function waitForTransientPostRetry() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, transientRetryDelayMs)
  })
}

async function loadPost(postId: string) {
  const query = (attempt: number) => readPostDetailQuery(
    postId,
    'post.findUnique',
    () => prisma.post.findUnique({ where: { id: postId }, select: postCoreSelect }),
    'detail',
    undefined,
    attempt,
  )

  try {
    return await query(1)
  } catch (error) {
    if (!isRetryableDatabaseConnectionError(error)) throw error
    await waitForTransientPostRetry()
    return query(2)
  }
}

type PostDetailSupport = {
  author: PostAuthor | null
  board: PostBoard | null
  sticker: PostSticker | null
  likes: PostLike[]
  favorited: boolean
  media: PostMedia[]
  authorLoadFailed: boolean
  authorMissing: boolean
}

function fallbackPostAuthor(authorId: string): PostAuthor {
  return {
    id: authorId,
    uid: 0,
    nickname: 'E院用户',
    usernameModerationStatus: 'NORMAL',
    nicknameModerationStatus: 'NORMAL',
    nicknameViolationDisplay: null,
    level: 0,
    avatarUrl: null,
    status: 'DELETED',
    isDeleted: true,
    Profile: null,
  }
}

async function loadPostSupport(post: PostCore, userId?: string | null): Promise<PostDetailSupport> {
  const [authorResult, boardResult, stickerResult, mediaResult, likesResult, favoriteResult] = await Promise.allSettled([
    readPostDetailQuery(post.id, 'author.findUnique', () => prisma.user.findUnique({ where: { id: post.authorId }, select: postAuthorSelect })),
    readPostDetailQuery(post.id, 'board.findUnique', () => prisma.board.findUnique({ where: { id: post.boardId }, select: postBoardSelect })),
    post.stickerId
      ? readPostDetailQuery(post.id, 'sticker.findUnique', () => prisma.sticker.findUnique({ where: { id: post.stickerId! }, select: postStickerSelect }))
      : Promise.resolve(null),
    readPostDetailQuery(post.id, 'postMedia.findMany', () => prisma.postMedia.findMany({
      where: { postId: post.id, type: 'IMAGE' },
      orderBy: { sortOrder: 'asc' },
      select: postMediaSelect,
    })),
    readPostDetailQuery(post.id, 'like.findMany', () => prisma.like.findMany({
      where: { postId: post.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: postLikeSelect,
    })),
    userId
      ? readPostDetailQuery(post.id, 'postFavorite.findUnique', () => prisma.postFavorite.findUnique({
          where: { postId_userId: { postId: post.id, userId } },
          select: { id: true },
        }), 'support', userId)
      : Promise.resolve(null),
  ])

  const author = authorResult.status === 'fulfilled' ? authorResult.value : null
  return {
    author,
    board: boardResult.status === 'fulfilled' ? boardResult.value : null,
    sticker: stickerResult.status === 'fulfilled' ? stickerResult.value : null,
    likes: likesResult.status === 'fulfilled' ? likesResult.value : [],
    favorited: favoriteResult.status === 'fulfilled' && Boolean(favoriteResult.value),
    media: mediaResult.status === 'fulfilled' ? mediaResult.value : [],
    authorLoadFailed: authorResult.status === 'rejected',
    authorMissing: authorResult.status === 'fulfilled' && authorResult.value === null,
  }
}

async function loadPostAdminPermission(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  permissionKey: 'post_manage' | 'reply_manage',
  postId: string,
) {
  const permissionStartedAt = Date.now()
  try {
    return await hasAdminPermission(user, permissionKey)
  } catch (error) {
    logPostDetailReadError({
      postId,
      channel: 'permission',
      operation: `admin.hasAdminPermission:${permissionKey}`,
      error,
      startedAt: permissionStartedAt,
      userId: user.id,
    })
    return false
  }
}


const replyDetailSelect = {
  id: true,
  content: true,
  moderationStatus: true,
  parentId: true,
  floorNumber: true,
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

          nicknameViolationDisplay: true,
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

      nicknameViolationDisplay: true,
      level: true,
      avatarUrl: true,
      status: true,
      isDeleted: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.ReplySelect

async function loadVisibleReplyDescendants(tx: Prisma.TransactionClient, postId: string, rootIds: string[]) {
  const descendants: Array<Prisma.ReplyGetPayload<{ select: typeof replyDetailSelect }>> = []
  const seen = new Set(rootIds)
  let frontier = Array.from(new Set(rootIds))

  // Only walk threads attached to the roots already visible on this page (or
  // to the viewer's own root replies). The previous query loaded every child
  // reply for the whole post before filtering in memory, which made a popular
  // post's detail page scale with the complete comment tree.
  for (let depth = 0; frontier.length > 0 && depth < 20; depth += 1) {
    const rows = await tx.reply.findMany({
      where: { postId, isDeleted: false, parentId: { in: frontier } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: replyDetailSelect,
    })
    const nextFrontier: string[] = []
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      descendants.push(row)
      nextFrontier.push(row.id)
    }
    frontier = nextFrontier
  }

  return descendants
}

async function loadPostReplies(
  postId: string,
  sort: PostReplySort,
  direction: PostReplyDirection,
  requestedPage: number,
  viewerId?: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const [pinnedReply, normalTotal, myRootReplies] = await Promise.all([
      tx.reply.findFirst({
        where: { postId, isDeleted: false, parentId: null, isPinned: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: replyDetailSelect,
      }),
      tx.reply.count({ where: { postId, isDeleted: false, parentId: null, isPinned: false } }),
      viewerId
        ? tx.reply.findMany({
            where: { postId, authorId: viewerId, isDeleted: false, parentId: null },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: replyDetailSelect,
          })
        : Promise.resolve([]),
    ])
    const totalPages = getPostReplyTotalPages(normalTotal)
    const page = clampPostReplyPage(requestedPage, totalPages)
    const normalRoots = await tx.reply.findMany({
      where: { postId, isDeleted: false, parentId: null, isPinned: false },
      orderBy: getPostReplyOrderBy(sort, direction),
      skip: getPostReplyOffset(page),
      take: POST_REPLY_PAGE_SIZE,
      select: replyDetailSelect,
    })

    const rootIds = [pinnedReply?.id, ...normalRoots.map((reply) => reply.id)].filter((id): id is string => Boolean(id))
    const viewerRootIds = myRootReplies.map((reply) => reply.id)
    const childRootIds = Array.from(new Set([...rootIds, ...viewerRootIds]))
    const childRows = childRootIds.length
      ? await loadVisibleReplyDescendants(tx, postId, childRootIds)
      : []
    const includedRootIds = new Set(rootIds)
    const includedViewerRootIds = new Set(viewerRootIds)
    let added = true
    while (added) {
      added = false
      for (const child of childRows) {
        if (child.parentId && includedRootIds.has(child.parentId) && !includedRootIds.has(child.id)) {
          includedRootIds.add(child.id)
          added = true
        }
        if (child.parentId && includedViewerRootIds.has(child.parentId) && !includedViewerRootIds.has(child.id)) {
          includedViewerRootIds.add(child.id)
          added = true
        }
      }
    }

    const withFloorNumber = <T extends { id: string; parentId: string | null; floorNumber: number | null }>(reply: T) => ({
      ...reply,
      floorNumber: reply.parentId === null ? reply.floorNumber : null,
    })

    return {
      rows: [
        ...(pinnedReply ? [pinnedReply] : []),
        ...normalRoots,
        ...childRows.filter((reply) => includedRootIds.has(reply.id)),
      ].map(withFloorNumber),
      myRows: [
        ...myRootReplies,
        ...childRows.filter((reply) => includedViewerRootIds.has(reply.id)),
      ].map(withFloorNumber),
      pagination: {
        page,
        pageSize: POST_REPLY_PAGE_SIZE,
        total: normalTotal,
        totalPages,
      } satisfies PostReplyPagination,
    }
  })
}

type FocusedReply = {
  id: string
  content: string
  moderationStatus: 'NORMAL' | 'VIOLATION'
  parentId: string | null
  floorNumber: number | null
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
    nicknameViolationDisplay: string | null
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
  floorNumber: number | null
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
        floorNumber: true,
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

            nicknameViolationDisplay: true,
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

export default async function PostDetailPage({ params, searchParams }: Readonly<{ params: Promise<{ postId: string }>; searchParams: Promise<{ focus?: string; commentId?: string; replyId?: string; reply?: string; commentSort?: string; direction?: string; sort?: string; commentPage?: string }> }>) {
  const { postId } = await params
  const query = await searchParams
  const focusId = (query.focus ?? query.replyId ?? query.commentId ?? query.reply)?.slice(0, 80)
  const rawCommentSort = query.commentSort ?? query.sort
  const commentSort = parsePostReplySort(rawCommentSort)
  const commentDirection = parsePostReplyDirection(query.direction, rawCommentSort)
  const requestedCommentPage = Math.max(1, Number.parseInt(query.commentPage || '1', 10) || 1)
  let postCore: Awaited<ReturnType<typeof loadPost>>
  const postLoadStartedAt = Date.now()
  try {
    postCore = await loadPost(postId)
  } catch (error) {
    logPostDetailReadError({
      postId,
      channel: 'detail',
      operation: 'post.findUnique',
      error,
      startedAt: postLoadStartedAt,
    })
    return <PostLoadFallback postId={postId} databaseUnavailable={isDatabasePostDetailError(error)} />
  }

  if (postCore === null) {
    notFound()
  }

  const currentUserStartedAt = Date.now()
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null
  try {
    user = await getCurrentUser()
  } catch (error) {
    // A public post must remain readable when the optional session lookup is
    // unavailable. Interactive state is simply rendered as signed out for
    // this request; a valid session is not revoked or redirected to login.
    logPostDetailReadError({
      postId,
      channel: 'current-user',
      operation: 'auth.getCurrentUser',
      error,
      startedAt: currentUserStartedAt,
    })
  }

  const support = await loadPostSupport(postCore, user?.id)
  const post = {
    ...postCore,
    User: support.author || fallbackPostAuthor(postCore.authorId),
    Board: support.board,
    sticker: support.sticker,
    Like: support.likes,
    PostMedia: support.media,
  }
  const authorLoadFailed = support.authorLoadFailed

  // 审核状态处理：用户可能通过通知/收藏/历史链接进入未审核帖子。
  // 非管理员访问 PENDING/REJECTED 帖子时显示审核提示页，而非 404。
  // 管理员可查看全部（保持现有权限）；普通用户只能查看 APPROVED。
  const viewerIsAdmin = Boolean(user && await loadPostAdminPermission(user, 'post_manage', postId))
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

  if (!authorLoadFailed && (support.authorMissing || post.User.isDeleted || post.User.status !== 'ACTIVE' || !post.User.Profile)) {
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
  let myPostReplies: Awaited<ReturnType<typeof loadPostReplies>>['myRows'] = []
  let commentPagination: PostReplyPagination = {
    page: 1,
    pageSize: POST_REPLY_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  }
  const commentsStartedAt = Date.now()
  try {
    const loadedReplies = await loadPostReplies(postId, commentSort, commentDirection, requestedCommentPage, user?.id)
    postReplies = loadedReplies.rows
    myPostReplies = loadedReplies.myRows
    commentPagination = loadedReplies.pagination
  } catch (error) {
    commentsLoadError = true
    logPostDetailReadError({
      postId,
      channel: 'comments',
      operation: 'reply.loadPostReplies',
      error,
      startedAt: commentsStartedAt,
      userId: user?.id,
    })
  }

  if (focusId && !postReplies.some((reply) => reply.id === focusId)) {
    const focusedReplyStartedAt = Date.now()
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
        floorNumber: reply.parentId === null ? reply.floorNumber : null,
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
      logPostDetailReadError({
        postId,
        channel: 'focused-reply',
        operation: 'reply.loadFocusedReplyChain',
        error,
        startedAt: focusedReplyStartedAt,
        userId: user?.id,
      })
    }
  }

  const focusedReplyExists = Boolean(focusId && postReplies.some((reply) => reply.id === focusId))
  if (user && (!focusId || focusedReplyExists)) {
    const notificationReadStartedAt = Date.now()
    const markedNotifications = await markPersonalNotificationsForTargetRead({
      userId: user.id,
      linkPrefix: focusId ? `/posts/${postId}?focus=${focusId}` : `/posts/${postId}`,
      types: focusId ? ['REPLY', 'LIKE'] : ['LIKE'],
    }).catch((error) => {
      logPostDetailReadError({
        postId,
        channel: 'support',
        operation: 'notifications.markPersonalNotificationsForTargetRead',
        error,
        startedAt: notificationReadStartedAt,
        userId: user?.id,
      })
      return 0
    })
    if (markedNotifications > 0) emitRealtime(user.id, 'notification')
  }

  const allLoadedReplies = [...postReplies, ...myPostReplies]
  const displayNameUserIds = Array.from(new Set([
    post.User.id,
    ...allLoadedReplies.flatMap((reply) => [
      reply.User.id,
      ...reply.ReplyLike.map((like) => like.userId),
      ...reply.ReplyMention.map((mention) => mention.User_ReplyMention_mentionedUserIdToUser.id),
    ]),
  ]))
  let equippedBadgeMap: Awaited<ReturnType<typeof getEquippedBadgesForUsers>> = new Map()
  const badgesStartedAt = Date.now()
  try {
    equippedBadgeMap = await getEquippedBadgesForUsers(displayNameUserIds)
  } catch (error) {
    logPostDetailReadError({
      postId,
      channel: 'support',
      operation: 'badge.getEquippedBadgesForUsers',
      error,
      startedAt: badgesStartedAt,
      userId: user?.id,
    })
  }

  // 当前用户的点赞状态：两次恒定数量的批量查询（避免 N+1）；点赞用户头像列表由 Like / ReplyLike include 提供。
  let viewerPostLiked = false
  const viewerLikedReplyIds = new Set<string>()
  if (user) {
    const replyIds = Array.from(new Set(allLoadedReplies.map((reply) => reply.id)))
    const [viewerPostLike, viewerReplyLikes] = await Promise.allSettled([
      readPostDetailQuery(
        postId,
        'like.findUnique.viewer',
        () => prisma.like.findUnique({ where: { postId_userId: { postId, userId: user.id } }, select: { id: true } }),
        'engagement',
        user.id,
      ),
      readPostDetailQuery(
        postId,
        'replyLike.findMany.viewer',
        () => prisma.replyLike.findMany({
          where: { userId: user.id, replyId: { in: replyIds } },
          select: { replyId: true },
        }),
        'engagement',
        user.id,
      ),
    ])
    if (viewerPostLike.status === 'fulfilled') viewerPostLiked = Boolean(viewerPostLike.value)
    if (viewerReplyLikes.status === 'fulfilled') viewerReplyLikes.value.forEach((like) => viewerLikedReplyIds.add(like.replyId))
  }

  const liked = viewerPostLiked
  const favorited = support.favorited
  const currentUserLiker = user ? { id: user.id, uid: user.uid, avatarUrl: publicImageUrl(user.avatarUrl) } : null
  const authorAvatar = publicImageVariantUrl(profileImageUrl(post.User.Profile?.avatarUrl || post.User.avatarUrl), 'avatar-md')
  const authorName = authorLoadFailed ? '作者资料暂时不可用' : getPublicUserDisplayName(post.User)
  const isArchivedAuthor = authorLoadFailed || post.User.uid === 0
  const canManagePost = viewerIsAdmin
  const canManageReplies = Boolean(user && await loadPostAdminPermission(user, 'reply_manage', postId))
  const canDeletePost = Boolean(user && (user.id === post.User.id || canManagePost))
  const canEditPost = Boolean(user && (user.id === post.User.id || canManagePost))
  const richResult = post.moderationStatus === 'VIOLATION' ? null : validateRichPostContent(post.richContent)
  const publicRichContent = richResult?.valid ? richResult.value : null
  const publicPostContentSource = publicModerationText(publicContentImageMarkers(post.content), post.moderationStatus)
  const publicPostContent = postContentPlainText(publicPostContentSource, publicRichContent)
  const shareCardPostContent = postContentPlainText(publicPostContentSource, publicRichContent, { preserveLineBreaks: true })
  const publicPostTitle = publicModerationText(post.title, post.moderationStatus)
  const safePublicPostContent = publicModerationText(publicPostContent, post.moderationStatus)
  const safeShareCardPostContent = publicModerationText(shareCardPostContent, post.moderationStatus)
  const shareTitle = createPostShareTitle(publicPostTitle, safePublicPostContent, publicRichContent)
  const shareText = createPostShareDescription(safePublicPostContent, publicRichContent)
  const shareCardData: ShareCardData = {
    type: 'post',
    contentId: post.id,
    title: shareTitle,
    description: safeShareCardPostContent || shareText,
    image: firstShareCardImageUrl(post.PostMedia.map(({ url }) => metadataImageVariantUrl(url))),
    url: canonicalShareUrl(`/posts/${post.id}`),
    author: authorName,
    authorAvatar,
    date: formatDate(post.createdAt),
    meta: post.Board ? [{ label: '版块', value: post.Board.name }] : [],
  }
  const serializeReply = ({ ReplyLike, ReplyMention, User, ...reply }: (typeof postReplies)[number]) => ({
    ...reply,
    content: publicModerationText(publicContentImageMarkers(reply.content), reply.moderationStatus),
    stickerId: reply.stickerId ?? null,
    stickerUrl: publicImageUrl(reply.sticker?.url),
    author: User.status === 'ACTIVE' && !User.isDeleted
      ? { ...User, nickname: getPublicUserDisplayName(User), equippedBadge: equippedBadgeMap.get(User.id) || null, profile: User.Profile ? {
          ...User.Profile,
          displayName: getPublicUserDisplayName(User),
        } : User.Profile }
      : { id: '', uid: 0, nickname: '已注销用户', level: 0, avatarUrl: null, profile: null },
    liked: viewerLikedReplyIds.has(reply.id),
    likers: Array.isArray(ReplyLike)
      ? ReplyLike.map((like) => ({
          id: like.User.id,
          uid: like.User.uid,
          nickname: getPublicUserDisplayName(like.User),
          friendRemark: null,
          displayName: getPublicUserDisplayName(like.User),
          avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
          equippedBadge: equippedBadgeMap.get(like.User.id) || null,
        }))
      : [],
    mentions: ReplyMention.map(({ User_ReplyMention_mentionedUserIdToUser: mentionedUser, ...mention }) => ({
      ...mention,
      user: {
        id: mentionedUser.id,
        uid: mentionedUser.uid,
        name: getPublicUserDisplayName(mentionedUser),
      },
    })),
  })
  const replyRows = postReplies.map(serializeReply)
  const myReplyRows = myPostReplies.map(serializeReply)
  const myRootReplyIds = new Set(myReplyRows.filter((reply) => !reply.parentId).map((reply) => reply.id))
  const directReplyCount = new Map<string, number>()
  replyRows.forEach((reply) => {
    if (reply.parentId) directReplyCount.set(reply.parentId, (directReplyCount.get(reply.parentId) || 0) + 1)
  })
  const hotReplyIds = replyRows
    .filter((reply) => !reply.parentId && !myRootReplyIds.has(reply.id) && (reply.likeCount >= 3 || (directReplyCount.get(reply.id) || 0) >= 2))
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
    <ForumDiscoveryDetailController hasReplyTarget={Boolean(focusId)}>
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
          authorBadge={equippedBadgeMap.get(post.User.id) || null}
          shareTitle={shareTitle}
          shareText={shareText}
          shareCardData={shareCardData}
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
            {post.Board ? (
              <Link href={`/boards/${post.Board.slug}`} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">
                {post.Board.name}
              </Link>
            ) : (
              <span className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">E院广场</span>
            )}
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
                <span><UserDisplayName name={authorName} uid={post.User.uid} badge={equippedBadgeMap.get(post.User.id) || null} compact /> · Lv.{post.User.level}</span>
              </Link>
            )}
            <span>{formatDate(post.createdAt)}</span>
            <IpRegionLabel ipRegion={post.ipRegion} />
            <PostViewCounter postId={post.id} initialCount={post.viewCount} />
            <span>回复 {post.replyCount}</span>
          </div>
          <RichPostContent
            richContent={publicRichContent}
            fallbackContent={publicPostContentSource}
            className="mt-8 text-lg leading-9 text-slate-700 post-detail-body"
          />
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
              <LikeButton postId={post.id} initialLiked={liked} initialCount={post.likeCount} currentUserLiker={currentUserLiker} />
              <FavoriteButton postId={post.id} initialFavorited={favorited} initialCount={post.favoriteCount} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEditPost ? (
                <Link href={`/posts/${post.id}/edit`} className="rounded-lg border border-sky-200 px-3 py-2 text-sm font-black text-brand-700">
                  编辑帖子
                </Link>
              ) : null}
              {canManagePost ? (
                <AdminPostActions postId={post.id} isPinned={post.isPinned} isFeatured={post.isFeatured} redirectTo="/forum" />
              ) : canDeletePost ? (
                <DeletePostButton postId={post.id} redirectTo="/forum" />
              ) : null}
            </div>
          </div>
          <LikeAvatars
            likers={(post.Like || []).map((like) => ({
              id: like.User.id,
              uid: like.User.uid,
              avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
            }))}
            totalCount={post.likeCount}
            listUrl={`/api/posts/${post.id}/like`}
            postId={post.id}
            avatarOnly
            responsivePreview
            currentUser={currentUserLiker}
            className="mt-3 post-detail-like-avatars"
          />
        </article>

        <CommentSectionBoundary>
          <PostRepliesSection
            postId={post.id}
            initialReplies={replyRows}
            initialMyReplies={myReplyRows}
            initialReplyCount={post.replyCount}
            currentUserId={user?.id}
            canManageReplies={canManageReplies}
            postAuthorId={post.User.id}
            focusId={focusId}
            sort={commentSort}
            direction={commentDirection}
            pagination={commentPagination}
            hotReplyIds={hotReplyIds}
            commentsLoadError={commentsLoadError}
          />
        </CommentSectionBoundary>
      </main>
      <ForumDiscoveryActionBar
        postId={post.id}
        currentUserId={user?.id}
        currentUserLiker={currentUserLiker}
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
