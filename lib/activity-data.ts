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
} as const

export type ActivityRow = Prisma.ActivityGetPayload<{ select: typeof activitySelect }>

export function serializeActivityRow(row: ActivityRow, now = new Date()) {
  return serializeActivity({
    ...row,
    coverUrl: publicImageUrl(row.coverUrl),
    bannerUrl: publicImageUrl(row.bannerUrl),
  }, now)
}
