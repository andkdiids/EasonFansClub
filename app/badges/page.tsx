import type { Metadata } from 'next'
import { BadgeExhibitionHall } from '@/components/BadgeExhibitionHall'
import { getCurrentUser } from '@/lib/auth'
import { getBadgeExhibitionGallery } from '@/lib/badge-service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '勋章展览馆 | 私家E院',
  description: '在私家E院查看所有荣誉藏品与自己的勋章收藏。',
}

export default async function BadgeMuseumPage() {
  const viewer = await getCurrentUser()
  const gallery = await getBadgeExhibitionGallery(viewer?.id || null)
  return <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 sm:py-8"><BadgeExhibitionHall gallery={gallery} /></main>
}
