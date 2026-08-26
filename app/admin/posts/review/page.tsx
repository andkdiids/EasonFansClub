import { requireAdminPage } from '@/components/AdminAccess'

import { publicImageUrl } from '@/lib/images'
import { POST_REVIEW_PAGE_SIZE } from '@/lib/post-moderation'
import { describePostModerationHistoryError, loadPostModerationHistoryByPostIds } from '@/lib/post-moderation-history'
import { prisma } from '@/lib/prisma'
import { PostReviewManager, type ReviewPost } from './PostReviewManager'

export const dynamic = 'force-dynamic'

export default async function AdminPostReviewPage() {
  await requireAdminPage('/admin/posts/review', 'post_manage')
  let posts
  let initialHasMore = false
  try {
    const pageRows = await prisma.post.findMany({
      where: { moderationStatus: 'PENDING', isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: POST_REVIEW_PAGE_SIZE + 1,
      select: {
        id: true,
        title: true,
        content: true,
        createdAt: true,
        moderationStatus: true,
        reviewedAt: true,
        rejectionReason: true,
        isPinned: true,
        isFeatured: true,
        User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
        ReviewedBy: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
        Board: { select: { name: true } },
        PostMedia: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, thumbnail: true } },
      },
    })
    initialHasMore = pageRows.length > POST_REVIEW_PAGE_SIZE
    posts = pageRows.slice(0, POST_REVIEW_PAGE_SIZE)
  } catch (error) {
    console.error('[admin.posts.review.page]', { error: describePostModerationHistoryError(error) })
    throw error
  }
  const historyByPostId = await loadPostModerationHistoryByPostIds(posts.map((post) => post.id), 'admin.posts.review.page')
  const initialPosts: ReviewPost[] = posts.map((post) => ({
    ...post,
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
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">用户发帖后先进入 PENDING，管理员通过后才会在前台展示。管理员也可以在这里设置精选或置顶。</p>
      </section>
      <PostReviewManager initialPosts={initialPosts} initialHasMore={initialHasMore} />
    </main>
  </>
}
