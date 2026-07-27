import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminPostActions, DeletePostButton, FavoriteButton, LikeButton } from '@/components/PostActions'
import { BackButton } from '@/components/BackButton'
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

function loadPost(postId: string, userId?: string) {
  return prisma.post.findUnique({
    where: { id: postId },
    include: {
      author: {
        select: {
          uid: true,
          id: true,
          nickname: true,
          level: true,
          avatarUrl: true,
          status: true,
          isDeleted: true,
          profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
      board: { select: { name: true, slug: true } },
      replies: {
        where: { isDeleted: false, author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } },
        orderBy: { createdAt: 'asc' },
        take: POST_DETAIL_REPLY_LIMIT,
        select: {
          id: true,
          content: true,
          parentId: true,
          likeCount: true,
          likes: userId ? { where: { userId }, select: { id: true } } : false,
          createdAt: true,
          author: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              level: true,
              avatarUrl: true,
              profile: { select: { displayName: true, avatarUrl: true } },
            },
          },
        },
      },
      likes: userId ? { where: { userId }, select: { id: true } } : false,
      favorites: userId ? { where: { userId }, select: { id: true } } : false,
      media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' } },
    },
  })
}

type FocusedReply = {
    id: string
    content: string
    parentId: string | null
    likeCount: number
    createdAt: Date
    author: {
      id: string
      uid: number
      nickname: string
      level: number
      avatarUrl: string | null
      profile: { displayName: string; avatarUrl: string | null } | null
    }
}

async function loadFocusedReplyChain(postId: string, focusId: string) {
  const chain: Array<FocusedReply & { likes: [] }> = []
  let currentId: string | null = focusId
  for (let depth = 0; currentId && depth < 12; depth += 1) {
    const reply: FocusedReply | null = await prisma.reply.findFirst({
      where: { id: currentId, postId, isDeleted: false, author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } },
      select: {
        id: true,
        content: true,
        parentId: true,
        likeCount: true,
        createdAt: true,
        author: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            level: true,
            avatarUrl: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    })
    if (!reply) break
    chain.unshift({ ...reply, likes: [] })
    currentId = reply.parentId
  }
  return chain
}

export default async function PostDetailPage({ params, searchParams }: Readonly<{ params: Promise<{ postId: string }>; searchParams: Promise<{ focus?: string; reward?: string }> }>) {
  const { postId } = await params
  const query = await searchParams
  const focusId = query.focus?.slice(0, 80)
  const rewardPoints = query.reward === '7' ? 7 : 0
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

  if (focusId && !post.replies.some((reply) => reply.id === focusId)) {
    const focusedReplies = await loadFocusedReplyChain(postId, focusId)
    const existingIds = new Set(post.replies.map((reply) => reply.id))
    post.replies.push(...focusedReplies.filter((reply) => !existingIds.has(reply.id)))
  }

  if (post.isDeleted || post.status !== 'PUBLISHED' || post.author.isDeleted || post.author.status !== 'ACTIVE' || !post.author.profile) {
    console.warn('[post:detail:unavailable]', { postId, postStatus: post.status, authorStatus: post.author.status })
    return <PostLoadFallback />
  }

  const liked = Array.isArray(post.likes) && post.likes.length > 0
  const favorited = Array.isArray(post.favorites) && post.favorites.length > 0
  const authorAvatar = publicImageUrl(post.author.profile.avatarUrl || post.author.avatarUrl)
  const authorName = post.author.profile.displayName || post.author.nickname
  const isArchivedAuthor = post.author.uid === 0
  const canManagePost = Boolean(user && isAdminRole(user.role))
  const canDeletePost = Boolean(user && (user.id === post.author.id || isAdminRole(user.role)))
  const replyRows = post.replies.map(({ likes, ...reply }) => ({ ...reply, liked: Array.isArray(likes) && likes.length > 0 }))
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
        {rewardPoints ? <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">发布成功，今日首次发帖获得 +7 积分</p> : null}
        <article className="post-detail-article border border-sky-100 bg-white/85 p-7">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">置顶</span> : null}
            {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">精华</span> : null}
            <Link href={`/boards/${post.board.slug}`} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">
              {post.board.name}
            </Link>
          </div>
          <h1 className="text-4xl font-black leading-tight text-brand-950">{post.title}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm font-bold text-slate-500">
            {isArchivedAuthor ? (
              <span className="flex items-center gap-2 text-brand-950">
                <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-slate-900 text-white">{authorName.slice(0, 1)}</span>
                <span>{authorName}</span>
              </span>
            ) : (
              <Link href={`/user/${formatUid(post.author.uid)}`} className="flex items-center gap-2 text-brand-950">
                <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                  {authorAvatar ? <img src={authorAvatar} alt={authorName} className="h-full w-full object-cover" /> : authorName.slice(0, 1)}
                </span>
                <span>{authorName} · Lv.{post.author.level}</span>
              </Link>
            )}
            <span>{formatDate(post.createdAt)}</span>
            <PostViewCounter postId={post.id} initialCount={post.viewCount} />
            <span>回复 {post.replyCount}</span>
          </div>
          <div className="mt-8 whitespace-pre-wrap text-lg leading-9 text-slate-700">{post.content}</div>
          {post.media.length ? <div className="post-media-grid mt-6 grid items-start gap-3 sm:grid-cols-2">{post.media.map((item, index) => <ImageViewer key={item.id} src={item.url} alt={`帖子图片 ${index + 1}`} buttonClassName="block w-fit max-w-full cursor-zoom-in overflow-hidden bg-transparent text-left" imageClassName="h-auto w-auto max-w-full bg-transparent" />)}</div> : null}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-sky-100 pt-5">
            <div className="flex flex-wrap gap-2">
              <LikeButton postId={post.id} initialLiked={liked} initialCount={post.likeCount} />
              <FavoriteButton postId={post.id} initialFavorited={favorited} initialCount={post.favoriteCount} />
            </div>
            {canManagePost ? (
              <AdminPostActions postId={post.id} isPinned={post.isPinned} isFeatured={post.isFeatured} redirectTo={`/boards/${post.board.slug}`} />
            ) : canDeletePost ? (
              <DeletePostButton postId={post.id} redirectTo={`/boards/${post.board.slug}`} />
            ) : null}
          </div>
        </article>

        <PostRepliesSection
          postId={post.id}
          initialReplies={replyRows}
          initialReplyCount={post.replyCount}
          currentUserId={user?.id}
          currentUserRole={user?.role}
          focusId={focusId}
          hotReplyIds={hotReplyIds}
        />
      </main>
    </>
  )
}
