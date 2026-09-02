import { Suspense } from 'react'
import { ForumHome } from '@/components/ForumHome'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'

export const dynamic = 'force-dynamic'

export default async function ForumPage({ searchParams }: { searchParams?: Promise<{ board?: string }> }) {
  const params = await searchParams
  const pageKey = params?.board === 'announcements' ? 'announcement' : 'forum'
  const layoutConfig = await getPublishedPageLayoutConfig(pageKey)
  return <>
    <main className="site-page-main forum-page-main">
      <PageLayoutRenderer pageKey={pageKey} config={layoutConfig} modules={{
        [`${pageKey}.main`]: <Suspense fallback={<div className="forum-loading"><div /><div /></div>}><ForumHome /></Suspense>,
      }} />
    </main>
  </>
}
