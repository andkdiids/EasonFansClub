import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Prisma } from '@prisma/client'
import { ActivityDetailView } from '@/components/activities/ActivityDetailView'
import { ActivityViewCounter } from '@/components/activities/ActivityViewCounter'
import { getCurrentUser } from '@/lib/auth'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { activityRegistrationSelect, getActivityRegistrationQuestions, getActivityRegistrationState, serializeActivityRegistration } from '@/lib/activity-registration'
import { prisma } from '@/lib/prisma'
import { buildActivityMetadata, firstAbsoluteMetadataImageUrl, metadataImageVariantUrl } from '@/lib/share-metadata'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { getPublicActivityLotteries } from '@/lib/activity-lottery'

export const dynamic = 'force-dynamic'

const activityMetadataSelect = {
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  locationName: true,
  locationAddress: true,
  coverUrl: true,
  bannerUrl: true,
} satisfies Prisma.ActivitySelect

const activityCreatorSelect = {
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  status: true,
  isDeleted: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ activityId: string }> }>): Promise<Metadata> {
  const { activityId } = await params
  try {
    const activity = await prisma.activity.findFirst({
      where: { id: activityId, status: { in: ['PUBLISHED', 'CANCELLED'] } },
      select: activityMetadataSelect,
    })
    if (!activity) return buildActivityMetadata({ activityId, isPublic: false })

    const imageUrl = firstAbsoluteMetadataImageUrl([
      metadataImageVariantUrl(activity.bannerUrl),
      metadataImageVariantUrl(activity.coverUrl),
    ])
    return buildActivityMetadata({
      activityId,
      title: activity.title,
      description: activity.description,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      locationName: activity.locationName,
      locationAddress: activity.locationAddress,
      imageUrl,
    })
  } catch {
    // Do not expose database-backed activity fields when the public lookup is
    // unavailable or the activity is not in a public lifecycle state.
    return buildActivityMetadata({ activityId, isPublic: false })
  }
}

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
  let shareAuthor = { name: view.organizer || '私家E院', avatarUrl: null as string | null }
  if (activity.createdById) {
    try {
      const creator = await prisma.user.findUnique({ where: { id: activity.createdById }, select: activityCreatorSelect })
      if (creator && creator.status === 'ACTIVE' && !creator.isDeleted) {
        shareAuthor = {
          name: getPublicUserDisplayName(creator),
          avatarUrl: publicImageVariantUrl(profileImageUrl(creator.Profile?.avatarUrl || creator.avatarUrl), 'avatar-md'),
        }
      }
    } catch {
      // A missing creator profile must not prevent the public activity page or poster from rendering.
    }
  }
  const [registration, questions] = await Promise.all([
    viewer
      ? await prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId: view.id, userId: viewer.id } }, select: activityRegistrationSelect })
      : Promise.resolve(null),
    getActivityRegistrationQuestions(prisma, view.id),
  ])
  const lotteries = await getPublicActivityLotteries(view.id, viewer?.id)
  const availability = getActivityRegistrationState(view, view.signupCount)
  const activityMaterialAvailable = !view.linkedMaterial || (view.linkedMaterial.status === 'PUBLISHED' && view.linkedMaterial.stockRemaining > 0)

  return (
    <main className="site-page-main flat-page mx-auto w-full max-w-[1440px] space-y-5 px-4 py-6 sm:px-5 sm:py-8" style={{ maxWidth: '1440px' }}>
      <ActivityDetailView activity={view} shareAuthor={shareAuthor} isAuthenticated={Boolean(viewer)} initialRegistration={registration ? serializeActivityRegistration(registration) : null} initialQuestions={questions} initialRegistrationState={availability.state} initialCanRegister={availability.canRegister && activityMaterialAvailable && Boolean(viewer) && registration?.status !== 'ACTIVE' && registration?.status !== 'CANCELLED'} lotteries={lotteries} />
      <p className="text-right text-xs font-bold text-[var(--foreground-muted)]"><ActivityViewCounter activityId={view.id} initialCount={view.viewCount} /></p>
    </main>
  )
}
