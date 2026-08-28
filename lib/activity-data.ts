import { publicImageUrl } from '@/lib/images'
import { serializeActivity } from '@/lib/activity'
import type { Prisma } from '@prisma/client'

export const activitySelect = {
  id: true,
  title: true,
  subtitle: true,
  description: true,
  type: true,
  status: true,
  coverUrl: true,
  bannerUrl: true,
  locationName: true,
  locationAddress: true,
  onlineUrl: true,
  pointsReward: true,
  signupLimit: true,
  signupCount: true,
  startsAt: true,
  endsAt: true,
  registrationStartAt: true,
  registrationEndAt: true,
  verificationMode: true,
  organizer: true,
  contactInfo: true,
  isFeatured: true,
  isPinned: true,
  sortOrder: true,
  viewCount: true,
  publishedAt: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { ActivityRegistration: { where: { status: { in: ['ACTIVE'] } } } } },
} satisfies Prisma.ActivitySelect

export type ActivityRow = Prisma.ActivityGetPayload<{ select: typeof activitySelect }>

export function serializeActivityRow(row: ActivityRow, now = new Date()) {
  const { _count, ...activity } = row
  return serializeActivity({
    ...activity,
    coverUrl: publicImageUrl(activity.coverUrl),
    bannerUrl: publicImageUrl(activity.bannerUrl),
    // Activity.signupCount is a legacy denormalized value. The relation count
    // is the source of truth for every public/admin activity read.
    signupCount: _count.ActivityRegistration,
  }, now)
}
