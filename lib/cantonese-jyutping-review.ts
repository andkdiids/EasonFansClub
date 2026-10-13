import { createHash } from 'node:crypto'

export const CANTONESE_JYUTPING_REVIEW_ACTION = 'VERIFY_JYUTPING'
export const CANTONESE_JYUTPING_REVOKE_ACTION = 'REVOKE_JYUTPING'

export type CantoneseJyutpingReviewEvent = { action: string; reason: string | null; createdAt?: Date | string }

export function recordedJyutpingReview(reason: string | null) {
  if (!reason) return null
  try {
    const value = JSON.parse(reason)
    return value?.kind === 'JYUTPING_REVIEW' && typeof value.digest === 'string' && typeof value.jyutping === 'string'
      ? { digest: value.digest as string, jyutping: value.jyutping as string } : null
  } catch { return null }
}

export function jyutpingVerificationReason(text: string | null, jyutping: string | null) {
  const digest = cantoneseJyutpingReviewDigest(text, jyutping)
  return digest ? JSON.stringify({ kind: 'JYUTPING_REVIEW', digest, jyutping: jyutping!.trim() }) : null
}

/** Historical hash-only events remain valid; never infer their previous text from a different digest. */
export function jyutpingReviewLogView<T extends CantoneseJyutpingReviewEvent>(entry: T, text: string | null, jyutping: string | null) {
  const recorded = recordedJyutpingReview(entry.reason)
  const isConfirmation = entry.action === CANTONESE_JYUTPING_REVIEW_ACTION || entry.action === CANTONESE_JYUTPING_REVOKE_ACTION
  if (isConfirmation) {
    const matchesCurrent = entry.reason === cantoneseJyutpingReviewDigest(text, jyutping)
    return { ...entry, reason: '粤拼核对记录', jyutping: recorded?.jyutping ?? (matchesCurrent ? jyutping : null),
      jyutpingValueSource: recorded ? 'RECORDED' : matchesCurrent ? 'CURRENT_DIGEST_MATCH' : 'UNAVAILABLE' }
  }
  if (entry.action === 'EDIT' && entry.reason) {
    try {
      const change = JSON.parse(entry.reason)
      if (change.kind === 'JYUTPING_EDIT') return { ...entry, reason: '编辑教学内容', jyutping: change.afterJyutping ?? null,
        beforeJyutping: change.beforeJyutping ?? null, afterJyutping: change.afterJyutping ?? null, jyutpingValueSource: 'RECORDED' }
    } catch { /* Historical free-text reasons are retained as-is. */ }
  }
  return { ...entry, jyutping: null, jyutpingValueSource: 'UNAVAILABLE' }
}

/** The latest event for an exact text+Jyutping digest determines its state. */
export function isLatestJyutpingVerification(logs: CantoneseJyutpingReviewEvent[], digest: string | null) {
  if (!digest) return false
  const latest = logs
    .filter((entry) => (entry.action === CANTONESE_JYUTPING_REVIEW_ACTION || entry.action === CANTONESE_JYUTPING_REVOKE_ACTION) && (entry.reason === digest || recordedJyutpingReview(entry.reason)?.digest === digest))
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
  return Boolean(digest && (input.verificationReason === digest || recordedJyutpingReview(input.verificationReason ?? null)?.digest === digest))
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
