import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BoardNav } from '@/components/BoardNav'
import { PostList } from '@/components/PostList'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAdminRole } from '@/lib/security'

export const dynamic = 'force-dynamic'

export default async function BoardPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params
  const user = await getCurrentUser()
  const [boards, board] = await Promise.all([
    prisma.board.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.board.findFirst({ where: { slug, isActive: true } }),
  ])

  if (!board) notFound()

  const posts = await prisma.post.findMany({
    where: {
      boardId: board.id,
      isDeleted: false,
      status: 'PUBLISHED',
      author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
    },
    orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
    include: {
      author: { select: { uid: true, nickname: true, avatarUrl: true, level: true, profile: true } },
      board: { select: { name: true, slug: true } },
      favorites: user ? { where: { userId: user.id }, select: { id: true } } : false,
    },
  })

  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <BoardNav boards={boards} activeSlug={slug} />
        <section>
          <div className="mb-6 rounded-2xl border border-sky-100 bg-white/80 p-7 shadow-sm">
            <p className="text-sm font-black uppercase text-brand-700">BOARD</p>
            <div className="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h1 className="text-4xl font-black text-brand-950">{board.name}</h1>
                {board.description ? <p className="mt-3 text-slate-600">{board.description}</p> : null}
              </div>
              <Link href="/posts/new" className="rounded-xl bg-brand-700 px-5 py-3 text-center font-black text-white">
                发帖
              </Link>
            </div>
          </div>
          <PostList posts={posts} canManage={Boolean(user && isAdminRole(user.role))} />
        </section>
      </main>
    </>
  )
}
