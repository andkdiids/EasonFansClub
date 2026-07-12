import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { AdminPostActions, FavoriteButton, LikeButton } from '@/components/PostActions'
import { ReplyForm } from '@/components/ReplyForm'
import { SiteHeader } from '@/components/SiteHeader'
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
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-5 py-8">
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
        include: {
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
    },
  })
}

export default async function PostDetailPage({ params }: Readonly<{ params: Promise<{ postId: string }> }>) {
  const { postId } = await params
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

  if (post.isDeleted || post.status !== 'PUBLISHED' || post.author.isDeleted || post.author.status !== 'ACTIVE' || !post.author.profile) {
    console.warn('[post:detail:unavailable]', { postId, postStatus: post.status, authorStatus: post.author.status })
    return <PostLoadFallback />
  }

  const liked = Array.isArray(post.likes) && post.likes.length > 0
  const favorited = Array.isArray(post.favorites) && post.favorites.length > 0
  const authorAvatar = publicImageUrl(post.author.profile.avatarUrl || post.author.avatarUrl)
  const authorName = post.author.profile.displayName || post.author.nickname
  const isArchivedAuthor = post.author.uid === 0

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-4xl space-y-6 px-5 py-8">
        <article className="rounded-2xl border border-sky-100 bg-white/85 p-7 shadow-sm">
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
            <span>浏览 {post.viewCount}</span>
            <span>回复 {post.replyCount}</span>
          </div>
          <div className="mt-8 whitespace-pre-wrap text-lg leading-9 text-slate-700">{post.content}</div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-sky-100 pt-5">
            <div className="flex flex-wrap gap-2">
              <LikeButton postId={post.id} initialLiked={liked} initialCount={post.likeCount} />
              <FavoriteButton postId={post.id} initialFavorited={favorited} initialCount={post.favoriteCount} />
            </div>
            {user && isAdminRole(user.role) ? (
              <AdminPostActions postId={post.id} isPinned={post.isPinned} isFeatured={post.isFeatured} redirectTo={`/boards/${post.board.slug}`} />
            ) : null}
          </div>
        </article>

        <section className="space-y-3">
          <h2 className="text-2xl font-black text-brand-950">回复 {post.replyCount}</h2>
          {post.replies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-sky-200 bg-white/65 p-8 text-center text-slate-500">还没有回复。</div>
          ) : (
            post.replies.map((reply, index) => {
              const avatar = publicImageUrl(reply.author.profile?.avatarUrl || reply.author.avatarUrl)
              const name = reply.author.profile?.displayName || reply.author.nickname
              return (
                <article key={reply.id} className="rounded-xl border border-sky-100 bg-white/82 p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3 text-sm font-bold text-slate-500">
                    <Link href={`/user/${formatUid(reply.author.uid)}`} className="flex items-center gap-2 text-brand-950">
                      <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                        {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 1)}
                      </span>
                      <span>{name} · Lv.{reply.author.level}</span>
                    </Link>
                    <span>#{index + 1} · {formatDate(reply.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap leading-7 text-slate-700">{reply.content}</p>
                  {user && (user.id === reply.author.id || isAdminRole(user.role)) ? (
                    <div className="mt-3">
                      <DeleteCommentButton endpoint={`/api/replies/${reply.id}`} />
                    </div>
                  ) : null}
                </article>
              )
            })
          )}
        </section>

        {user ? (
          <ReplyForm postId={post.id} />
        ) : (
          <div className="rounded-xl border border-sky-100 bg-white/82 p-5 text-center font-bold text-slate-600">请先登录后再回复。</div>
        )}
      </main>
    </>
  )
}
