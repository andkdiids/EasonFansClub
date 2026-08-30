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
      <header className="anywhere-door-page-heading">
        <h1 className="anywhere-door-page-title">随意门</h1>
        <p className="anywhere-door-page-description">只同步公开动态，按原发布时间排列。这里是私家 E 院的存档浏览区，不代表 Instagram 官方页面。</p>
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
