import { requireAdminPage } from '@/components/AdminAccess'

import { getForumBoardDisplayName, mergeForumBoardOptions } from '@/lib/boards'
import { publicImageUrl } from '@/lib/images'
import { POST_REVIEW_PAGE_SIZE } from '@/lib/post-moderation'
import { describePostModerationHistoryError, loadPostModerationHistoryByPostIds } from '@/lib/post-moderation-history'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { PostReviewManager, type ReviewBoardOption, type ReviewPost } from './PostReviewManager'

export const dynamic = 'force-dynamic'

export default async function AdminPostReviewPage() {
  await requireAdminPage('/admin/posts/review', 'post_manage')
  const currentUser = await getCurrentUser()
  let posts
  let initialHasMore = false
  try {
    const pageRows = await prisma.post.findMany({
      where: { moderationStatus: 'PENDING', isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: POST_REVIEW_PAGE_SIZE + 1,
      select: {
        id: true,
        boardId: true,
        title: true,
        content: true,
        createdAt: true,
        moderationStatus: true,
        reviewedAt: true,
        rejectionReason: true,
        isPinned: true,
        isFeatured: true,
        User: { select: { uid: true, nickname: true, role: true, Profile: { select: { displayName: true } } } },
        ReviewedBy: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
        Board: { select: { name: true, slug: true } },
        PostMedia: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, thumbnail: true } },
      },
    })
    initialHasMore = pageRows.length > POST_REVIEW_PAGE_SIZE
    posts = pageRows.slice(0, POST_REVIEW_PAGE_SIZE)
  } catch (error) {
    console.error('[admin.posts.review.page]', { error: describePostModerationHistoryError(error) })
    throw error
  }
  // 发布分区候选 = 现有广场/发帖系统的真实分区源（含尚未落库的 configured 快捷分区），
  // 与发帖/编辑页同一数据源；名称由数据源实时提供，不硬编码。
  const boardRows = await prisma.board.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, slug: true, sortOrder: true, createdAt: true },
  })
  const reviewBoards: ReviewBoardOption[] = mergeForumBoardOptions(boardRows).map((board) => ({ id: board.id, name: board.name, slug: board.slug }))
  const historyByPostId = await loadPostModerationHistoryByPostIds(posts.map((post) => post.id), 'admin.posts.review.page')
  const initialPosts: ReviewPost[] = posts.map((post) => ({
    ...post,
    Board: { name: getForumBoardDisplayName(post.Board) },
    createdAt: post.createdAt.toISOString(),
    reviewedAt: post.reviewedAt?.toISOString() || null,
    ReviewedBy: post.ReviewedBy
      ? { id: post.ReviewedBy.id, uid: post.ReviewedBy.uid, name: post.ReviewedBy.nickname?.trim() || 'E院用户' }
      : null,
    PostModerationHistory: (historyByPostId.get(post.id) || []).map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    User: post.User,
    PostMedia: post.PostMedia.map((media) => ({ ...media, url: publicImageUrl(media.url), thumbnail: publicImageUrl(media.thumbnail) })),
  }))

  return <>
    
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Post Moderation</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">帖子审核中心</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">用户发帖后先进入 PENDING，管理员通过后才会在前台展示。管理员也可以在这里设置精选或置顶，或在通过审核时调整发布分区。</p>
      </section>
      <PostReviewManager initialPosts={initialPosts} initialHasMore={initialHasMore} boards={reviewBoards} currentUserRole={currentUser?.role ?? null} />
    </main>
  </>
}
