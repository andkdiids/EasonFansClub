import { createHash } from 'node:crypto'

export const CANTONESE_JYUTPING_REVIEW_ACTION = 'VERIFY_JYUTPING'
export const CANTONESE_JYUTPING_REVOKE_ACTION = 'REVOKE_JYUTPING'

export type CantoneseJyutpingReviewEvent = { action: string; reason: string | null; createdAt?: Date | string }

/** The latest event for an exact text+Jyutping digest determines its state. */
export function isLatestJyutpingVerification(logs: CantoneseJyutpingReviewEvent[], digest: string | null) {
  if (!digest) return false
  const latest = logs
    .filter((entry) => (entry.action === CANTONESE_JYUTPING_REVIEW_ACTION || entry.action === CANTONESE_JYUTPING_REVOKE_ACTION) && entry.reason === digest)
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())[0]
  return latest?.action === CANTONESE_JYUTPING_REVIEW_ACTION
}

/** Hash the reviewed transcription itself so later edits cannot inherit approval. */
export function cantoneseJyutpingReviewDigest(text: string | null | undefined, jyutping: string | null | undefined) {
  const normalizedText = text?.trim()
  const normalizedJyutping = jyutping?.trim()
  if (!normalizedText || !normalizedJyutping) return null
  return `sha256:${createHash('sha256').update(`${normalizedText}\u0000${normalizedJyutping}`).digest('hex')}`
}

export function isCantoneseJyutpingReviewed(input: {
  text: string | null | undefined
  jyutping: string | null | undefined
  verificationReason: string | null | undefined
}) {
  const digest = cantoneseJyutpingReviewDigest(input.text, input.jyutping)
  return Boolean(digest && input.verificationReason === digest)
}

export function cantoneseJyutpingReviewStatus(input: {
  text: string | null | undefined
  jyutping: string | null | undefined
  needsJyutping: boolean
  verificationReason?: string | null
}) {
  if (!input.needsJyutping) return 'NOT_REQUIRED' as const
  return isCantoneseJyutpingReviewed({
    text: input.text,
    jyutping: input.jyutping,
    verificationReason: input.verificationReason,
  }) ? 'VERIFIED' as const : 'JYUTPING_REVIEW_REQUIRED' as const
}
