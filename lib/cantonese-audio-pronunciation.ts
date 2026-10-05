import type { Prisma } from '@prisma/client'
import { cantoneseJyutpingReviewDigest, CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION, isLatestJyutpingVerification } from './cantonese-jyutping-review'

type Reader = Pick<Prisma.TransactionClient, 'cantoneseLessonContent' | 'cantoneseReviewLog'>
export type PronunciationAsset = {
  externalId: string; text: string; jyutping: string | null; contentId: string | null; lessonId: string | null
}

/** Linked assets are snapshots, not a second human pronunciation review. Reads never sync or write. */
export async function resolveAudioPronunciation(db: Reader, asset: PronunciationAsset) {
  const source = asset.contentId
    ? await db.cantoneseLessonContent.findUnique({ where: { externalId: asset.contentId } })
    : null
  const linked = Boolean(asset.contentId)
  const validSource = !linked || Boolean(source && source.audioId === asset.externalId
    && (!asset.lessonId || source.lessonId === asset.lessonId)
    && (source.requiresAudio || source.requiresSpeaking))
  const text = linked ? source?.displayText?.trim() || '' : asset.text.trim()
  const jyutping = linked ? source?.jyutping?.trim() || null : asset.jyutping?.trim() || null
  const targetType = linked ? 'TEACHING' as const : 'AUDIO' as const
  const targetId = linked ? asset.contentId! : asset.externalId
  const digest = validSource ? cantoneseJyutpingReviewDigest(text, jyutping) : null
  const events = digest ? await db.cantoneseReviewLog.findMany({
    where: { targetType, targetId, action: { in: [CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { action: true, reason: true, createdAt: true },
  }) : []
  return {
    text, jyutping, digest, verified: Boolean(validSource && isLatestJyutpingVerification(events, digest)),
    validSource, sourceId: linked ? asset.contentId : null,
    reviewSource: linked ? 'CONTENT' as const : 'AUDIO' as const,
    snapshotMatches: asset.text.trim() === text && (asset.jyutping?.trim() || null) === jyutping,
  }
}

export async function decorateAudioPronunciation<T extends PronunciationAsset>(db: Reader, asset: T) {
  const source = await resolveAudioPronunciation(db, asset)
  return {
    ...asset, text: source.text, jyutping: source.jyutping,
    jyutpingReviewStatus: source.verified ? 'VERIFIED' : 'JYUTPING_REVIEW_REQUIRED',
    jyutpingReviewSource: source.reviewSource, jyutpingSourceId: source.sourceId,
    pronunciationSnapshotMatches: source.snapshotMatches,
    pronunciationSourceValid: source.validSource,
  }
}
