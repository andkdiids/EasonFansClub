export const GLOBAL_POINTS_GRANT_PERMISSION = 'user_reward_manage' as const

export const GLOBAL_POINTS_GRANT_TITLE_MAX_LENGTH = 120
export const GLOBAL_POINTS_GRANT_CONTENT_MAX_LENGTH = 5000
export const GLOBAL_POINTS_GRANT_IDEMPOTENCY_KEY_MAX_LENGTH = 191
export const GLOBAL_POINTS_GRANT_MAX_AMOUNT = 100_000
export const GLOBAL_POINTS_GRANT_BATCH_SIZE = 200
export const GLOBAL_POINTS_GRANT_CONCURRENCY = 12
export const GLOBAL_POINTS_GRANT_WORKER_INTERVAL_MS = 5_000
export const GLOBAL_POINTS_GRANT_CLAIM_TIMEOUT_MS = 5 * 60_000
export const GLOBAL_POINTS_GRANT_MAX_TOTAL_AMOUNT = 2_147_483_647
export const GLOBAL_POINTS_GRANT_STRONG_CONFIRM_AMOUNT = 500
export const GLOBAL_POINTS_GRANT_STRONG_CONFIRM_TOTAL = 5_000_000
export const GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT = 'CONFIRM'
export const GLOBAL_POINTS_GRANT_IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024

export const globalPointsGrantStatuses = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'PARTIAL_FAILED',
  'FAILED',
] as const

export type GlobalPointsGrantStatus = (typeof globalPointsGrantStatuses)[number]
export type GlobalPointsGrantRecipientStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED'
export type GlobalPointsGrantNotificationStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED'

export function requiresGlobalPointsGrantStrongConfirmation(amount: number, totalAmount: number) {
  return amount >= GLOBAL_POINTS_GRANT_STRONG_CONFIRM_AMOUNT || totalAmount >= GLOBAL_POINTS_GRANT_STRONG_CONFIRM_TOTAL
}
