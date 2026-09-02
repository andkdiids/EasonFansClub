import { Suspense } from 'react'
import { ForumHome } from '@/components/ForumHome'

export const dynamic = 'force-dynamic'

export default function ForumPage() {
  return <>
    <main className="site-page-main forum-page-main">
      <Suspense fallback={<div className="forum-loading"><div /><div /></div>}><ForumHome /></Suspense>
    </main>
  </>
}
