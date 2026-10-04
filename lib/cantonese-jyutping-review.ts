import { createHash } from 'node:crypto'

export const CANTONESE_JYUTPING_REVIEW_ACTION = 'VERIFY_JYUTPING'

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
