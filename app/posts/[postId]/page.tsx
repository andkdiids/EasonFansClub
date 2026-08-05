import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminPostActions, DeletePostButton, FavoriteButton, LikeButton } from '@/components/PostActions'
import { BackButton } from '@/components/BackButton'
import { CommentSectionBoundary } from '@/components/CommentSectionBoundary'
import { ImageViewer } from '@/components/ImageViewer'
import { PostRepliesSection } from '@/components/PostRepliesSection'
import { PostViewCounter } from '@/components/PostViewCounter'
import { getCurrentUser } from '@/lib/auth'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { isAdminRole } from '@/lib/security'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

const POST_DETAIL_REPLY_LIMIT = 50

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

function loadPost(postId: string, userId?: string) {
  return prisma.post.findFirst({
    where: { id: postId, moderationStatus: 'APPROVED' },
    include: {
      User: {
        select: {
          uid: true,
          id: true,
          nickname: true,
          level: true,
          avatarUrl: true,
          status: true,
          isDeleted: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
      Board: { select: { name: true, slug: true } },
      Like: userId ? { where: { userId }, select: { id: true } } : false,
      PostFavorite: userId ? { where: { userId }, select: { id: true } } : false,
      PostMedia: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' } },
    },
  })
}

function loadPostReplies(postId: string, userId?: string) {
  return prisma.reply.findMany({
    where: { postId, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    take: POST_DETAIL_REPLY_LIMIT,
    select: {
      id: true,
      content: true,
      parentId: true,
      likeCount: true,
      ReplyLike: userId ? { where: { userId }, select: { id: true } } : false,
      ReplyMention: {
        orderBy: { startIndex: 'asc' },
        select: {
          id: true,
          startIndex: true,
          endIndex: true,
          User_ReplyMention_mentionedUserIdToUser: {
            select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } },
          },
        },
      },
      createdAt: true,
      User: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          level: true,
          avatarUrl: true,
          status: true,
          isDeleted: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
    },
  })
}

type FocusedReply = {
  id: string
  content: string
  parentId: string | null
  likeCount: number
  createdAt: Date
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
    level: number
    avatarUrl: string | null
    profile: { displayName: string; avatarUrl: string | null } | null
  }
}

type FocusedReplyQueryRow = {
  id: string
  content: string
  parentId: string | null
  likeCount: number
  createdAt: Date
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
        parentId: true,
        likeCount: true,
        createdAt: true,
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            level: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
        ReplyMention: {
          orderBy: { startIndex: 'asc' },
          select: {
            id: true,
            startIndex: true,
            endIndex: true,
            User_ReplyMention_mentionedUserIdToUser: {
              select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } },
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
          name: mentionedUser.Profile?.displayName || mentionedUser.nickname,
        },
      })),
      author: { ...replyUser, profile: replyUser.Profile },
      likes: [],
    })
    currentId = row.parentId
  }
  return chain
}

export default async function PostDetailPage({ params, searchParams }: Readonly<{ params: Promise<{ postId: string }>; searchParams: Promise<{ focus?: string; reward?: string }> }>) {
  const { postId } = await params
  const query = await searchParams
  const focusId = query.focus?.slice(0, 80)
  const parsedReward = Number(query.reward)
  const rewardPoints = Number.isInteger(parsedReward) && parsedReward > 0 && parsedReward <= 3 ? parsedReward : 0
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
  let postReplies: Awaited<ReturnType<typeof loadPostReplies>> = []
  try {
    postReplies = await loadPostReplies(postId, user?.id)
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
        parentId: reply.parentId,
        likeCount: reply.likeCount,
        createdAt: reply.createdAt,
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
            Profile: { displayName: mention.user.name },
          },
        })),
      })))
    } catch (error) {
      commentsLoadError = true
      console.warn('[post:comments:focus-load-failed]', { postId, focusId, error })
    }
  }

  const liked = Array.isArray(post.Like) && post.Like.length > 0
  const favorited = Array.isArray(post.PostFavorite) && post.PostFavorite.length > 0
  const authorAvatar = publicImageUrl(post.User.Profile.avatarUrl || post.User.avatarUrl)
  const authorName = post.User.Profile.displayName || post.User.nickname
  const isArchivedAuthor = post.User.uid === 0
  const canManagePost = Boolean(user && isAdminRole(user.role))
  const canDeletePost = Boolean(user && (user.id === post.User.id || isAdminRole(user.role)))
  const replyRows = postReplies.map(({ ReplyLike, ReplyMention, User, ...reply }) => ({
    ...reply,
    author: User.status === 'ACTIVE' && !User.isDeleted
      ? { ...User, profile: User.Profile }
      : { id: '', uid: 0, nickname: '已注销用户', level: 0, avatarUrl: null, profile: null },
    liked: Array.isArray(ReplyLike) && ReplyLike.length > 0,
    mentions: ReplyMention.map(({ User_ReplyMention_mentionedUserIdToUser: mentionedUser, ...mention }) => ({
      ...mention,
      user: {
        id: mentionedUser.id,
        uid: mentionedUser.uid,
        name: mentionedUser.Profile?.displayName || mentionedUser.nickname,
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
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-6 px-5 py-8">
        <BackButton fallbackHref="/forum" />
        {rewardPoints ? <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">发布成功，今日首次发帖获得 +{rewardPoints} 挂号费</p> : null}
        <article className="post-detail-article border border-sky-100 bg-white/85 p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">置顶</span> : null}
            {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">精华</span> : null}
            <Link href={`/boards/${post.Board.slug}`} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">
              {post.Board.name}
            </Link>
          </div>
          <h1 className="text-4xl font-black leading-tight text-brand-950">{post.title}</h1>
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
            <PostViewCounter postId={post.id} initialCount={post.viewCount} />
            <span>回复 {post.replyCount}</span>
          </div>
          <div className="mt-8 whitespace-pre-wrap text-lg leading-9 text-slate-700">{post.content}</div>
          {post.PostMedia.length ? <div className="post-media-grid mt-6 grid items-start gap-3 sm:grid-cols-2">{post.PostMedia.map((item, index) => <ImageViewer key={item.id} src={item.url} alt={`帖子图片 ${index + 1}`} buttonClassName="block w-fit max-w-full cursor-zoom-in overflow-hidden bg-transparent text-left" imageClassName="h-auto w-auto max-w-full bg-transparent" />)}</div> : null}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-sky-100 pt-5">
            <div className="flex flex-wrap gap-2">
              <LikeButton postId={post.id} initialLiked={liked} initialCount={post.likeCount} />
              <FavoriteButton postId={post.id} initialFavorited={favorited} initialCount={post.favoriteCount} />
            </div>
            {canManagePost ? (
              <AdminPostActions postId={post.id} isPinned={post.isPinned} isFeatured={post.isFeatured} redirectTo={`/boards/${post.Board.slug}`} />
            ) : canDeletePost ? (
              <DeletePostButton postId={post.id} redirectTo={`/boards/${post.Board.slug}`} />
            ) : null}
          </div>
        </article>

        <CommentSectionBoundary>
          <PostRepliesSection
            postId={post.id}
            initialReplies={replyRows}
            initialReplyCount={post.replyCount}
            currentUserId={user?.id}
            currentUserRole={user?.role}
            focusId={focusId}
            hotReplyIds={hotReplyIds}
            commentsLoadError={commentsLoadError}
          />
        </CommentSectionBoundary>
      </main>
    </>
  )
}
