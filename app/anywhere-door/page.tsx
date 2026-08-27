import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { getPublicSocialPostFeed } from '@/lib/social-posts'
import { AnywhereDoorFeed } from '@/components/anywhere-door/AnywhereDoorFeed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AnywhereDoorPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=/anywhere-door')
  if (!(await canAccessAnywhereDoor(user))) notFound()
  let initial = { items: [], nextCursor: null } as Awaited<ReturnType<typeof getPublicSocialPostFeed>>
  try {
    initial = await getPublicSocialPostFeed({ viewerId: user.id })
  } catch (error) {
    console.error('[anywhere-door.page]', { errorName: error instanceof Error ? error.name : 'unknown' })
  }
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-5 sm:py-8">
      <header className="mb-5 rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">Anywhere Door</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">随意门</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600">只同步公开动态，按原发布时间排列。这里是私家 E 院的存档浏览区，不代表 Instagram 官方页面。</p>
      </header>
      <AnywhereDoorFeed initial={initial} />
    </main>
  )
}
