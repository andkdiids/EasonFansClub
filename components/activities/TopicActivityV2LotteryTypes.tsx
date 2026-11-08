import type { TopicLotteryPrizeConfig } from '@/lib/topic-activity-v2-lottery-config'

export type TopicLotteryWinnerSummary = {
  id: string
  nickname: string
  uid: string
  prizeName: string
  wonAt: string | null
  addressDeadline: string | null
  addressSaved: boolean
  shippingStatus: string
  shippedAt: string | null
}

export type TopicLotteryDrawView = {
  id?: string
  state: string
  candidateCount: number
  winnerCount: number
  frozenAt?: string | null
  drawnAt?: string | null
  errorCode?: string | null
  failedReason?: string | null
}

export type TopicLotteryAdminPayload = {
  config: unknown
  configLocked: boolean
  addressEncryptionReady: boolean
  state: string
  candidateCount: number
  pendingSubmissionCount: number
  canShip: boolean
  winners: TopicLotteryWinnerSummary[]
  draw?: TopicLotteryDrawView | null
}

/**
 * Public winner row for a completed draw. This is the ONLY shape the public
 * lottery endpoint may return: no real name, phone, address, e-mail, ID card,
 * claim token or internal id is allowed here.
 */
export type TopicLotteryPublicWinner = {
  nickname: string
  uid: string
  avatarUrl: string | null
  prizeName: string
  wonAt: string | null
}

/** Server-side pagination metadata for the public winner list. */
export type TopicLotteryPublicWinnerPage = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type TopicLotteryPublicPayload = {
  enabled: boolean
  config: unknown
  state: string
  candidateCount: number
  myStatus: string
  myEligibility: boolean | { count: number } | null
  myWinner: {
    id: string
    prize: Pick<TopicLotteryPrizeConfig, 'name' | 'imageUrl' | 'description'>
    wonAt: string | null
    addressDeadline: string | null
    shippingStatus: string
    addressSaved: boolean
    claimUrl: string | null
  } | null
  winners: TopicLotteryPublicWinner[]
  winnerPage: TopicLotteryPublicWinnerPage
  draw: TopicLotteryPublicDraw | null
}

/** Public, redacted summary of a completed draw. Never present before DRAWN. */
export type TopicLotteryPublicDraw = {
  id: string
  state: string
  frozenAt: string | null
  drawnAt: string | null
  candidateCount: number
  winnerCount: number
  errorCode: string | null
}

export type TopicLotteryAddress = {
  recipient: string
  phone: string
  province: string
  city: string
  district: string
  address: string
  remark: string
}

export type TopicLotteryShipment = {
  carrier: string | null
  trackingNumber: string | null
}

export type TopicLotteryAddressPayload = {
  winner: {
    id: string
    prizeName: string
    addressDeadline: string | null
    shippingStatus: string
  }
  address: TopicLotteryAddress | null
  shipment: TopicLotteryShipment | null
}

export type TopicLotteryEntrySource = {
  id: string
  platformName: string
  title: string
  enabled: boolean
  maxImages: number
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function numberOr(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function stringOr(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function booleanOr(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}
