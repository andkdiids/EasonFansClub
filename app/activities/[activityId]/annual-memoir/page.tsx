import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getMemoirAvailability } from '@/lib/annual-memoir-policy'
import { readMemoir, type MemoirReport } from '@/lib/annual-memoir-report'
import { prisma } from '@/lib/prisma'
import { MemoirReader } from './MemoirReader'

export default async function Page({ params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params
  const path = `/activities/${encodeURIComponent(activityId)}/annual-memoir`
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`)
  const [snapshot, config] = await Promise.all([
    readMemoir(activityId, user.id),
    prisma.annualMemoirConfig.findUnique({ where: { activityId }, include: { activity: true } }),
  ])
  if (!config && !snapshot) notFound()
  const availability = config && getMemoirAvailability({
    schedule: config, now: new Date(), hasSnapshot: !!snapshot,
    configuredAndPublished: config.enabled && config.activity.status === 'PUBLISHED' &&
      config.activity.type === 'TOPIC_ACTIVITY' && !!config.activity.coverUrl &&
      !!config.annualBadgeId,
  })
  if (!snapshot && !availability?.visible) notFound()
  return <MemoirReader activityId={activityId} year={snapshot?.year ?? config!.year}
    initialReport={snapshot ? snapshot.payload as unknown as MemoirReport : null}
    canGenerate={!!availability?.canGenerate} />
}
