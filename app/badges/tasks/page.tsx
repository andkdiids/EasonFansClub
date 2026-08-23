import { redirect } from 'next/navigation'
import { BadgeTaskCenter } from '@/components/BadgeTaskCenter'
import { getCurrentUser } from '@/lib/auth'
import { getBadgeTaskCenter } from '@/lib/badge-phase5'

export const dynamic = 'force-dynamic'
export const metadata = { title: '勋章任务 | 私家E院' }

export default async function BadgeTasksPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/badges/tasks')
  const result = await getBadgeTaskCenter(user.id)
  return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8"><BadgeTaskCenter initialTracking={result.tracking} initialRecommendations={result.recommendations} maxTracking={result.maxTracking} /></main>
}
