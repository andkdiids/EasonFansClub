import { redirect } from 'next/navigation'
import { PostCreateForm } from '@/components/PostCreateForm'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function NewPostPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const boards = await prisma.board.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  })

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className="mb-6">
          <p className="text-sm font-black uppercase text-brand-700">CREATE POST</p>
          <h1 className="mt-2 text-4xl font-black text-brand-950">发布帖子</h1>
        </div>
        <PostCreateForm boards={boards} />
      </main>
    </>
  )
}
