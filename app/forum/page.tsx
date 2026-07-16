import { Suspense } from 'react'
import { ForumHome } from '@/components/ForumHome'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'

export const dynamic = 'force-dynamic'

export default async function ForumPage() {
  const [user, layoutConfig] = await Promise.all([getCurrentUser(), getPublishedPageLayoutConfig('forum')])
  return <>
    <SiteHeader user={user} />
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">
      <PageLayoutRenderer pageKey="forum" config={layoutConfig} modules={{
        'forum.main': <Suspense fallback={<div className="h-40 animate-pulse rounded-[28px] bg-sky-50" />}><ForumHome /></Suspense>,
      }} />
    </main>
  </>
}
