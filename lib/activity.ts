import { formatBeijingDateTimeDisplay, parseBeijingDateTime } from '@/lib/registration-availability'

export const activityTypeValues = ['OFFLINE', 'ONLINE', 'CONCERT', 'COMMUNITY', 'BENEFIT', 'OTHER'] as const
export type ActivityTypeValue = (typeof activityTypeValues)[number]

export const activityStatusValues = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const
export type ActivityStatusValue = (typeof activityStatusValues)[number]
export const activityVerificationModeValues = ['NONE', 'MANUAL', 'QR'] as const
export type ActivityVerificationModeValue = (typeof activityVerificationModeValues)[number]

export const activityTypeLabels: Record<ActivityTypeValue, string> = {
  OFFLINE: '线下活动',
  ONLINE: '线上活动',
  CONCERT: '演唱会 / 现场',
  COMMUNITY: '粉丝社群',
  BENEFIT: '福利活动',
  OTHER: '其他活动',
}

export const activityDisplayStatusLabels = {
  DRAFT: '草稿',
  UPCOMING: '即将开始',
  ONGOING: '进行中',
  ENDED: '已结束',
  CANCELLED: '已取消',
} as const

export type ActivityDisplayStatus = keyof typeof activityDisplayStatusLabels

export type ActivityView = {
  id: string
  title: string
  subtitle: string | null
  description: string
  type: ActivityTypeValue
  status: ActivityStatusValue
  displayStatus: ActivityDisplayStatus
  coverUrl: string | null
  bannerUrl: string | null
  locationName: string | null
  locationAddress: string | null
  onlineUrl: string | null
  pointsReward: number | null
  registrationFee: number
  feeDescription: string | null
  linkedMaterial: ActivityLinkedMaterialView | null
  signupLimit: number | null
  signupCount: number
  startsAt: string | null
  endsAt: string | null
  registrationStartAt: string | null
  registrationEndAt: string | null
  verificationMode: ActivityVerificationModeValue
  organizer: string | null
  contactInfo: string | null
  isFeatured: boolean
  isPinned: boolean
  sortOrder: number
  viewCount: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ActivityLinkedMaterialView = {
  id: string
  title: string
  description: string | null
  coverImageUrl: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ENDED' | 'ARCHIVED'
  stockTotal: number
  stockRemaining: number
  exchangeStartAt: string
  exchangeEndAt: string
  redeemEndAt: string
}

type ActivityDateValue = Date | string | null | undefined

function timestamp(value: ActivityDateValue) {
  if (!value) return null
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

function iso(value: ActivityDateValue) {
  const valueTimestamp = timestamp(value)
  return valueTimestamp === null ? null : new Date(valueTimestamp).toISOString()
}

export function parseActivityDateInput(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(normalized)) return parseBeijingDateTime(normalized)
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function getActivityDisplayStatus(
  activity: { status: ActivityStatusValue; startsAt?: ActivityDateValue; endsAt?: ActivityDateValue },
  now: Date = new Date(),
): ActivityDisplayStatus {
  if (activity.status === 'DRAFT') return 'DRAFT'
  if (activity.status === 'CANCELLED') return 'CANCELLED'

  const nowTimestamp = now.getTime()
  const startsAt = timestamp(activity.startsAt)
  const endsAt = timestamp(activity.endsAt)
  if (startsAt !== null && nowTimestamp < startsAt) return 'UPCOMING'
  if (endsAt !== null && nowTimestamp >= endsAt) return 'ENDED'
  return 'ONGOING'
}

const displayStatusOrder: Record<ActivityDisplayStatus, number> = {
  ONGOING: 0,
  UPCOMING: 1,
  ENDED: 2,
  CANCELLED: 3,
  DRAFT: 4,
}

export function sortActivities<T extends Pick<ActivityView, 'status' | 'startsAt' | 'endsAt' | 'isPinned' | 'sortOrder' | 'createdAt'> & { id: string }>(items: readonly T[], now: Date = new Date()) {
  return [...items].sort((left, right) => {
    const pinnedDifference = Number(right.isPinned) - Number(left.isPinned)
    if (pinnedDifference) return pinnedDifference

    const statusDifference = displayStatusOrder[getActivityDisplayStatus(left, now)] - displayStatusOrder[getActivityDisplayStatus(right, now)]
    if (statusDifference) return statusDifference

    const sortOrderDifference = left.sortOrder - right.sortOrder
    if (sortOrderDifference) return sortOrderDifference

    const startDifference = (timestamp(left.startsAt) ?? Number.MAX_SAFE_INTEGER) - (timestamp(right.startsAt) ?? Number.MAX_SAFE_INTEGER)
    if (startDifference) return startDifference

    const createdDifference = (timestamp(right.createdAt) ?? 0) - (timestamp(left.createdAt) ?? 0)
    if (createdDifference) return createdDifference
    return left.id.localeCompare(right.id)
  })
}

export function serializeActivity(activity: {
  id: string
  title: string
  subtitle?: string | null
  description: string
  type: ActivityTypeValue
  status: ActivityStatusValue
  coverUrl?: string | null
  bannerUrl?: string | null
  locationName?: string | null
  locationAddress?: string | null
  onlineUrl?: string | null
  pointsReward?: number | null
  registrationFee?: number
  feeDescription?: string | null
  linkedMaterial?: {
    id: string
    title: string
    description?: string | null
    coverImageUrl?: string | null
    status: 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ENDED' | 'ARCHIVED'
    stockTotal: number
    stockRemaining: number
    exchangeStartAt: ActivityDateValue
    exchangeEndAt: ActivityDateValue
    redeemEndAt: ActivityDateValue
  } | null
  signupLimit?: number | null
  signupCount?: number
  startsAt?: ActivityDateValue
  endsAt?: ActivityDateValue
  registrationStartAt?: ActivityDateValue
  registrationEndAt?: ActivityDateValue
  verificationMode?: ActivityVerificationModeValue
  organizer?: string | null
  contactInfo?: string | null
  isFeatured?: boolean
  isPinned?: boolean
  sortOrder?: number
  viewCount?: number
  publishedAt?: ActivityDateValue
  createdAt: ActivityDateValue
  updatedAt: ActivityDateValue
}, now: Date = new Date()): ActivityView {
  return {
    id: activity.id,
    title: activity.title,
    subtitle: activity.subtitle ?? null,
    description: activity.description,
    type: activity.type,
    status: activity.status,
    displayStatus: getActivityDisplayStatus(activity, now),
    coverUrl: activity.coverUrl ?? null,
    bannerUrl: activity.bannerUrl ?? null,
    locationName: activity.locationName ?? null,
    locationAddress: activity.locationAddress ?? null,
    onlineUrl: activity.onlineUrl ?? null,
    pointsReward: activity.pointsReward ?? null,
    registrationFee: activity.registrationFee ?? 0,
    feeDescription: activity.feeDescription ?? null,
    linkedMaterial: activity.linkedMaterial
      ? {
          id: activity.linkedMaterial.id,
          title: activity.linkedMaterial.title,
          description: activity.linkedMaterial.description ?? null,
          coverImageUrl: activity.linkedMaterial.coverImageUrl ?? null,
          status: activity.linkedMaterial.status,
          stockTotal: activity.linkedMaterial.stockTotal,
          stockRemaining: activity.linkedMaterial.stockRemaining,
          exchangeStartAt: iso(activity.linkedMaterial.exchangeStartAt) || new Date(0).toISOString(),
          exchangeEndAt: iso(activity.linkedMaterial.exchangeEndAt) || new Date(0).toISOString(),
          redeemEndAt: iso(activity.linkedMaterial.redeemEndAt) || new Date(0).toISOString(),
        }
      : null,
    signupLimit: activity.signupLimit ?? null,
    signupCount: activity.signupCount ?? 0,
    startsAt: iso(activity.startsAt),
    endsAt: iso(activity.endsAt),
    registrationStartAt: iso(activity.registrationStartAt),
    registrationEndAt: iso(activity.registrationEndAt),
    verificationMode: activity.verificationMode ?? 'NONE',
    organizer: activity.organizer ?? null,
    contactInfo: activity.contactInfo ?? null,
    isFeatured: activity.isFeatured ?? false,
    isPinned: activity.isPinned ?? false,
    sortOrder: activity.sortOrder ?? 0,
    viewCount: activity.viewCount ?? 0,
    publishedAt: iso(activity.publishedAt),
    createdAt: iso(activity.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(activity.updatedAt) || new Date(0).toISOString(),
  }
}

export function activityDateLabel(value: string | null) {
  return value ? formatBeijingDateTimeDisplay(value) : ''
}

export function activityStatusLabel(status: ActivityDisplayStatus) {
  return activityDisplayStatusLabels[status]
}
