import { notFound } from 'next/navigation'
import { ActivityDetailView } from '@/components/activities/ActivityDetailView'
import { ActivityViewCounter } from '@/components/activities/ActivityViewCounter'
import { getCurrentUser } from '@/lib/auth'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { getActivityRegistrationState } from '@/lib/activity-registration'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function ActivityDetailPage({ params }: Readonly<{ params: Promise<{ activityId: string }> }>) {
  const { activityId } = await params
  const [publishedActivity, viewer] = await Promise.all([
    prisma.activity.findFirst({
      where: { id: activityId, status: 'PUBLISHED' },
      select: activitySelect,
    }),
    getCurrentUser(),
  ])
  const activity = publishedActivity || await prisma.activity.findFirst({
    where: { id: activityId, status: 'CANCELLED' },
    select: activitySelect,
  })
  if (!activity) notFound()
  const view = serializeActivityRow(activity)
  const registration = viewer
    ? await prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId: view.id, userId: viewer.id } }, select: { id: true } })
    : null
  const availability = getActivityRegistrationState(view, view.signupCount)

  return (
    <main className="site-page-main flat-page mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <ActivityDetailView activity={view} isAuthenticated={Boolean(viewer)} initialIsRegistered={Boolean(registration)} initialRegistrationState={availability.state} initialCanRegister={availability.canRegister && Boolean(viewer) && !registration} />
      <p className="text-right text-xs font-bold text-slate-400 dark:text-slate-500"><ActivityViewCounter activityId={view.id} initialCount={view.viewCount} /></p>
    </main>
  )
}
