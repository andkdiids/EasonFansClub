import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { BoardNav } from '@/components/BoardNav'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { PostList } from '@/components/PostList'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import type { PageLayoutPageKey } from '@/lib/page-layout/types'
import { prisma } from '@/lib/prisma'
import { isAdminRole } from '@/lib/security'

export const dynamic = 'force-dynamic'

const BOARD_POST_PAGE_SIZE = 50

type BoardPost = Awaited<ReturnType<typeof loadBoardPosts>>[number]

async function loadBoardPosts(boardId: string, userId?: string) {
  return prisma.post.findMany({
    where: {
      boardId,
      isDeleted: false,
      status: 'PUBLISHED',
      author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
    },
    orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: BOARD_POST_PAGE_SIZE,
    select: {
      id: true,
      title: true,
      content: true,
      likeCount: true,
      favoriteCount: true,
      replyCount: true,
      viewCount: true,
      isPinned: true,
      isFeatured: true,
      createdAt: true,
      author: { select: { id: true, uid: true, nickname: true, avatarUrl: true, level: true, profile: true } },
      board: { select: { name: true, slug: true } },
      favorites: userId ? { where: { userId }, select: { id: true } } : false,
    },
  })
}

function EmptyBlock({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sky-200 bg-white/65 p-8 text-center text-sm font-bold text-slate-500">
      {children}
    </div>
  )
}

function PostListOrEmpty({
  posts,
  emptyText,
  canManage,
  currentUserId,
}: {
  posts: BoardPost[]
  emptyText: string
  canManage: boolean
  currentUserId?: string
}) {
  return posts.length ? <PostList posts={posts} canManage={canManage} currentUserId={currentUserId} /> : <EmptyBlock>{emptyText}</EmptyBlock>
}

export default async function BoardPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params
  const user = await getCurrentUser()
  const [boards, board] = await Promise.all([
    prisma.board.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      select: { id: true, name: true, slug: true, description: true, postCount: true },
    }),
    prisma.board.findFirst({ where: { slug, isActive: true } }),
  ])

  if (!board) notFound()

  const isAdmin = Boolean(user && isAdminRole(user.role))
  const isAnnouncementsBoard = board.slug === 'announcements'
  const canCreateInBoard = !isAnnouncementsBoard || isAdmin
  const pageKey: PageLayoutPageKey = isAnnouncementsBoard ? 'announcement' : 'forum'

  const [posts, layoutConfig] = await Promise.all([
    loadBoardPosts(board.id, user?.id),
    getPublishedPageLayoutConfig(pageKey),
  ])

  const pinnedPosts = posts.filter((post) => post.isPinned)
  const featuredPosts = posts.filter((post) => post.isFeatured && !post.isPinned)
  const latestPosts = posts.filter((post) => !post.isPinned && !post.isFeatured)
  const hotPosts = [...latestPosts]
    .sort((a, b) => (b.viewCount + b.replyCount * 3 + b.likeCount * 2) - (a.viewCount + a.replyCount * 3 + a.likeCount * 2))
    .slice(0, 8)

  const forumModules = {
    'forum.header': (
      <div className="rounded-2xl border border-sky-100 bg-white/80 p-7 shadow-sm">
        <p className="text-sm font-black uppercase text-brand-700">BOARD</p>
        <h1 className="mt-2 text-4xl font-black text-brand-950">{board.name}</h1>
        {board.description ? <p className="mt-3 text-slate-600">{board.description}</p> : null}
      </div>
    ),
    'forum.categoryNav': <BoardNav boards={boards} activeSlug={slug} />,
    'forum.createPost': canCreateInBoard ? (
      <div className="rounded-xl border border-sky-100 bg-white/80 p-5 shadow-sm">
        <p className="text-sm font-black text-brand-950">参与讨论</p>
        <p className="mt-2 text-sm font-bold text-slate-500">分享你的近况、提问或发布新帖。</p>
        <Link href="/posts/new" className="mt-4 inline-flex rounded-xl bg-brand-700 px-5 py-3 text-center font-black text-white">
          发帖
        </Link>
      </div>
    ) : <EmptyBlock>当前板块暂不开放发帖。</EmptyBlock>,
    'forum.pinnedPosts': <PostListOrEmpty posts={pinnedPosts} emptyText="暂无置顶帖子。" canManage={isAdmin} currentUserId={user?.id} />,
    'forum.featuredPosts': <PostListOrEmpty posts={featuredPosts} emptyText="暂无精华帖子。" canManage={isAdmin} currentUserId={user?.id} />,
    'forum.latestPosts': <PostListOrEmpty posts={latestPosts} emptyText="暂无最新帖子。" canManage={isAdmin} currentUserId={user?.id} />,
    'forum.hotPosts': <PostListOrEmpty posts={hotPosts} emptyText="暂无热门帖子。" canManage={isAdmin} currentUserId={user?.id} />,
    'forum.sidebar': (
      <div className="rounded-xl border border-sky-100 bg-white/78 p-4 shadow-sm">
        <p className="text-sm font-black text-brand-950">板块信息</p>
        <p className="mt-2 text-sm font-bold text-slate-500">帖子数：{board.postCount}</p>
        {board.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{board.description}</p> : null}
      </div>
    ),
    'forum.pagination': <EmptyBlock>当前显示最新 {BOARD_POST_PAGE_SIZE} 篇帖子。</EmptyBlock>,
  }

  const announcementModules = {
    'announcement.header': (
      <div className="rounded-xl border border-sky-100 bg-white/80 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-brand-950">{board.name}</h1>
            {board.description ? <p className="mt-1 text-sm font-bold text-slate-500">{board.description}</p> : null}
          </div>
          {isAdmin ? (
            <Link href="/posts/new" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-black text-white">
              发布公告
            </Link>
          ) : null}
        </div>
      </div>
    ),
    'announcement.pinned': <PostListOrEmpty posts={pinnedPosts} emptyText="暂无置顶公告。" canManage={isAdmin} currentUserId={user?.id} />,
    'announcement.list': <PostListOrEmpty posts={posts.filter((post) => !post.isPinned)} emptyText="暂无公告。" canManage={isAdmin} currentUserId={user?.id} />,
    'announcement.updateLogEntry': (
      <div className="rounded-xl border border-sky-100 bg-white/78 p-4 shadow-sm">
        <p className="text-sm font-black text-brand-950">更新日志</p>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-500">查看网站功能更新、修复和重要说明。</p>
        <Link href="/feedback" className="mt-4 inline-flex rounded-lg bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
          查看更新日志
        </Link>
      </div>
    ),
    'announcement.sidebar': <BoardNav boards={boards} activeSlug={slug} />,
    'announcement.pagination': <EmptyBlock>当前显示最新 {BOARD_POST_PAGE_SIZE} 条公告。</EmptyBlock>,
  }

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <PageLayoutRenderer
          pageKey={pageKey}
          config={layoutConfig}
          modules={isAnnouncementsBoard ? announcementModules : forumModules}
        />
      </main>
    </>
  )
}
