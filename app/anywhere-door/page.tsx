import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { getPublicSocialPostDetail, getPublicSocialPostFeed } from '@/lib/social-posts'
import { AnywhereDoorDetail } from '@/components/anywhere-door/AnywhereDoorDetail'
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
  let latestDetail: Awaited<ReturnType<typeof getPublicSocialPostDetail>> = null
  const latest = initial.items[0]
  if (latest) {
    try {
      latestDetail = await getPublicSocialPostDetail(latest.id, user.id)
    } catch (error) {
      console.error('[anywhere-door.page.detail]', { errorName: error instanceof Error ? error.name : 'unknown' })
    }
  }
  const morePosts = latestDetail ? initial.items.filter((post) => post.id !== latestDetail?.id) : []

  return (
    <main className="anywhere-door-page mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-5 sm:py-8" data-anywhere-door-page>
      <header className="mb-4 border-b border-sky-100 pb-4 dark:border-slate-700 sm:mb-6 sm:pb-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700 dark:text-sky-300">Anywhere Door</p>
        <h1 className="mt-1 text-2xl font-black text-brand-950 dark:text-slate-100 sm:mt-2 sm:text-3xl">随意门</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-600 dark:text-slate-300 sm:mt-3 sm:leading-7">只同步公开动态，按原发布时间排列。这里是私家 E 院的存档浏览区，不代表 Instagram 官方页面。</p>
      </header>
      <div className="hidden lg:block">
        {latestDetail ? <AnywhereDoorDetail post={latestDetail} morePosts={morePosts} showBackLink={false} /> : <AnywhereDoorFeed initial={initial} />}
      </div>
      <div className="lg:hidden">
        <AnywhereDoorFeed initial={initial} />
      </div>
    </main>
  )
}
