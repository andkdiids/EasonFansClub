import { redirect } from 'next/navigation'
import { PostCreateForm } from '@/components/PostCreateForm'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const canPostAnnouncement = await hasAdminPermission(user, 'post_manage')
  const boards = await prisma.board.findMany({
    where: {
      isActive: true,
      ...(canPostAnnouncement ? {} : { slug: { not: 'announcements' } }),
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 100,
    select: { id: true, name: true, slug: true },
  })
  const query = await searchParams

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-5 py-8">
        <div className="mb-6">
          <h1 className="mt-2 text-4xl font-black text-brand-950">发布帖子</h1>
        </div>
        <PostCreateForm boards={boards} initialBoardSlug={query.board} />
      </main>
    </>
  )
}
