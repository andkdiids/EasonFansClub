import { Suspense } from 'react'
import { ForumHome } from '@/components/ForumHome'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'

export const dynamic = 'force-dynamic'

export default async function ForumPage() {
  const layoutConfig = await getPublishedPageLayoutConfig('forum')
  return <>
    <main className="site-page-main forum-page-main">
      <PageLayoutRenderer pageKey="forum" config={layoutConfig} modules={{
        'forum.main': <Suspense fallback={<div className="forum-loading"><div /><div /></div>}><ForumHome /></Suspense>,
      }} />
    </main>
  </>
}
