import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth'
import { buildPageMetadata } from '@/lib/share-metadata'
import { getSalonOptions, getSalonPosts, parseSalonFilters } from '@/lib/salon'
import { SalonHome } from '@/components/salon/SalonHome'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: '沙龙',
    description: '记录现场，也分享你眼中的那一刻。',
    canonical: '/salon',
  })
}

export default async function SalonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const currentUser = await getCurrentUser()
  const filters = parseSalonFilters(params)
  const [feed, options] = await Promise.all([
    getSalonPosts(filters, currentUser?.id),
    getSalonOptions(),
  ])
  return <SalonHome initialPosts={feed.posts} initialHasMore={feed.hasMore} initialNextCursor={feed.nextCursor} options={options} currentUserId={currentUser?.id || null} />
}
