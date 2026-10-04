import { prisma } from '@/lib/prisma'
import { parseCantoneseSeedRequest } from '@/lib/cantonese-course-pack-request'
import { findV6CoursePack } from '@/lib/cantonese-course-packs'
import { planSeedRows, summarizeSeedPlan, type SeedPlanItem } from '@/lib/cantonese-seed-import'
import { cantoneseJyutpingReviewDigest, CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION, isLatestJyutpingVerification } from '@/lib/cantonese-jyutping-review'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function safeCandidate(value: unknown, kind: 'content' | 'question' | 'audio' | 'definition') {
  const item = asRecord(value)
  if (kind === 'content') return {
    externalId: item.externalId, lessonId: item.lessonId, stageId: item.stageId, stepId: item.stepId,
    contentType: item.contentType, title: item.title, body: item.body, displayText: item.displayText,
    jyutping: item.jyutping, translation: item.translation, explanation: item.explanation,
    usageNote: item.usageNote, section: item.section, audioId: item.audioId,
    requiresAudio: item.requiresAudio, requiresSpeaking: item.requiresSpeaking,
    audioReviewStatus: item.audioReviewStatus, audioAssetStatus: item.audioAssetStatus, audioReady: item.audioReady,
    jyutpingReviewStatus: item.jyutpingReviewStatus || ((item.requiresAudio || item.requiresSpeaking) ? 'JYUTPING_REVIEW_REQUIRED' : 'NOT_REQUIRED'),
    sourceReference: item.sourceReference,
  }
  if (kind === 'question') return {
    externalId: item.externalId, lessonId: item.lessonId, stageId: item.stageId, questionType: item.questionType,
    prompt: item.prompt, options: item.options, correctAnswer: item.correctAnswer, explanation: item.explanation,
    prerequisiteContentIds: item.prerequisiteContentIds, audioId: item.audioId,
    speakingReferenceId: item.speakingReferenceId, audioReviewStatus: item.audioReviewStatus,
    audioAssetStatus: item.audioAssetStatus, audioReady: item.audioReady,
  }
  if (kind === 'audio') return {
    externalId: item.externalId, lessonId: item.lessonId, stageId: item.stageId, contentId: item.contentId,
    text: item.text, jyutping: item.jyutping,
    jyutpingReviewStatus: item.jyutpingReviewStatus || (item.jyutping ? 'JYUTPING_REVIEW_REQUIRED' : 'MISSING'),
    assetStatus: item.assetStatus || 'NOT_GENERATED',
  }
  return {
    lessonId: item.lessonId, lessonNumber: item.lessonNumber, title: item.title,
    subtitle: item.subtitle, description: item.description, sortOrder: item.sortOrder,
    prerequisiteLessonId: item.prerequisiteLessonId,
  }
}

function publicPlan<T extends { externalId?: string; lessonId?: string | null }>(
  plan: SeedPlanItem<T>[], kind: 'content' | 'question' | 'audio' | 'definition',
  enrich?: (candidate: T) => Record<string, unknown>,
) {
  return plan.map((row) => ({
    id: row.candidate.externalId || row.candidate.lessonId,
    decision: row.decision,
    candidate: safeCandidate({ ...asRecord(row.candidate), ...(enrich?.(row.candidate) || {}) }, kind),
    current: row.existing ? {
      status: row.existing.status,
      assetStatus: row.existing.assetStatus || null,
      updatedAt: row.existing.updatedAt instanceof Date ? row.existing.updatedAt.toISOString() : null,
    } : null,
    diff: row.diff,
    expectedUpdatedAt: row.existing?.updatedAt instanceof Date ? row.existing.updatedAt.toISOString() : null,
  }))
}

function countSummary(rows: Array<{ decision: string }>) {
  const count = (decision: string) => rows.filter((row) => row.decision === decision).length
  return {
    new: count('CREATE_PENDING'),
    updateAvailable: count('UPDATE_AVAILABLE') + count('CANDIDATE_UPDATE_AVAILABLE'),
    approvedSkipped: count('SKIPPED_ALREADY_APPROVED'),
    unchanged: count('SKIPPED_EXISTING'),
    blocked: count('AUDIO_ASSET_REVIEW_REQUIRED'),
    total: rows.length,
  }
}

export async function getCantoneseSeedPackPreview(lessonId: string) {
  const pack = findV6CoursePack(lessonId)
  if (!pack) return null
  const parsed = parseCantoneseSeedRequest(JSON.stringify({ packId: lessonId }))
  if (parsed instanceof Response) return null
  const { definitions, teaching, questions, audio } = parsed
  const [existingDefinitions, existingTeaching, existingQuestions, existingAudio] = await Promise.all([
    prisma.cantoneseCourseDefinition.findMany({ where: { lessonId: { in: definitions.map((row) => row.lessonId) } } }),
    prisma.cantoneseLessonContent.findMany({ where: { externalId: { in: teaching.map((row) => row.externalId) } } }),
    prisma.cantoneseQuestion.findMany({ where: { externalId: { in: questions.map((row) => row.externalId) } } }),
    prisma.cantoneseAudioAsset.findMany({ where: { externalId: { in: audio.map((row) => row.externalId) } } }),
  ])
  const plans = {
    definitions: planSeedRows(definitions, existingDefinitions, 'definition', 'lessonId'),
    content: planSeedRows(teaching, existingTeaching, 'teaching'),
    questions: planSeedRows(questions, existingQuestions, 'question'),
    audio: planSeedRows(audio, existingAudio, 'audio'),
  }
  const contentPairs = plans.content.filter((row) => Boolean(row.candidate.requiresAudio || row.candidate.requiresSpeaking)).map((row) => ({
    type: 'TEACHING' as const, id: row.candidate.externalId!,
    digest: cantoneseJyutpingReviewDigest(row.candidate.displayText, row.candidate.jyutping),
  })).filter((row): row is { type: 'TEACHING'; id: string; digest: string } => Boolean(row.digest))
  const audioPairs = plans.audio.map((row) => ({
    type: 'AUDIO' as const, id: row.candidate.externalId!,
    digest: cantoneseJyutpingReviewDigest(row.candidate.text, row.candidate.jyutping),
  })).filter((row): row is { type: 'AUDIO'; id: string; digest: string } => Boolean(row.digest))
  const reviewEvents = contentPairs.length || audioPairs.length ? await prisma.cantoneseReviewLog.findMany({
    where: {
      OR: [
        ...(contentPairs.length ? [{ targetType: 'TEACHING', targetId: { in: contentPairs.map((row) => row.id) } }] : []),
        ...(audioPairs.length ? [{ targetType: 'AUDIO', targetId: { in: audioPairs.map((row) => row.id) } }] : []),
      ],
      action: { in: [CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION] },
      reason: { in: [...contentPairs, ...audioPairs].map((row) => row.digest) },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { targetType: true, targetId: true, action: true, reason: true, createdAt: true },
  }) : []
  const candidateJyutpingVerified = (type: 'TEACHING' | 'AUDIO', id: string, digest: string | null) => Boolean(
    isLatestJyutpingVerification(reviewEvents.filter((event) => event.targetType === type && event.targetId === id), digest),
  )
  const verifiedContent = new Set(contentPairs.filter((row) => candidateJyutpingVerified(row.type, row.id, row.digest)).map((row) => row.id))
  const rawAudioById = new Map<string, Record<string, unknown>>()
  for (const row of plans.audio) {
    const raw = row.existing ? row.existing : row.candidate
    if (raw.externalId) rawAudioById.set(raw.externalId, raw as Record<string, unknown>)
  }
  const audioStatus = (candidateValue: unknown) => {
    const candidate = asRecord(candidateValue)
    const audio = typeof candidate.audioId === 'string' ? rawAudioById.get(candidate.audioId) : null
    const ready = Boolean(audio?.status === 'APPROVED' && audio.assetStatus === 'READY' && audio.cosKey && audio.checksum && audio.fileSize)
    return { audioReviewStatus: audio?.status || null, audioAssetStatus: audio?.assetStatus || null, audioReady: ready }
  }
  const contentItems = publicPlan(plans.content, 'content', (candidate) => ({
    ...audioStatus(candidate),
    jyutpingReviewStatus: !(candidate.requiresAudio || candidate.requiresSpeaking) ? 'NOT_REQUIRED'
      : candidateJyutpingVerified('TEACHING', candidate.externalId || '', cantoneseJyutpingReviewDigest(candidate.displayText, candidate.jyutping))
        ? 'VERIFIED' : candidate.jyutping ? 'JYUTPING_REVIEW_REQUIRED' : 'MISSING',
  }))
  const questionItems = publicPlan(plans.questions, 'question', audioStatus)
  const audioItems = publicPlan(plans.audio, 'audio', (candidate) => ({
    jyutpingReviewStatus: candidateJyutpingVerified('AUDIO', candidate.externalId || '', cantoneseJyutpingReviewDigest(candidate.text, candidate.jyutping))
      ? 'VERIFIED' : candidate.jyutping ? 'JYUTPING_REVIEW_REQUIRED' : 'MISSING',
  }))
  return {
    lesson: {
      lessonId,
      lessonNumber: pack.definition.lessonNumber,
      title: pack.definition.title,
      subtitle: pack.definition.subtitle,
      description: pack.definition.description,
      teachingCount: teaching.length,
      questionCount: questions.length,
      audioCount: audio.length,
      speakingCount: teaching.filter((row) => row.requiresSpeaking).length,
      jyutping: {
        needsPronunciation: teaching.filter((row) => row.requiresAudio || row.requiresSpeaking).length,
        candidates: teaching.filter((row) => Boolean(row.jyutping)).length,
        reviewRequired: teaching.filter((row) => row.requiresAudio || row.requiresSpeaking).length - verifiedContent.size,
        missing: teaching.filter((row) => (row.requiresAudio || row.requiresSpeaking) && !row.jyutping).length,
        verified: verifiedContent.size,
      },
    },
    summary: {
      content: countSummary(contentItems),
      questions: countSummary(questionItems),
      audio: countSummary(audioItems),
    },
    items: {
      content: contentItems,
      questions: questionItems,
      audio: audioItems,
      definitions: publicPlan(plans.definitions, 'definition'),
    },
    legacySummary: {
      definitions: summarizeSeedPlan(plans.definitions),
      teaching: summarizeSeedPlan(plans.content),
      questions: summarizeSeedPlan(plans.questions),
      audio: summarizeSeedPlan(plans.audio),
    },
    writes: false as const,
  }
}

export async function listCantoneseSeedPacks() {
  const { V6_COURSE_PACKS } = await import('@/lib/cantonese-course-packs')
  return Promise.all(V6_COURSE_PACKS.map(async (pack) => {
    const preview = await getCantoneseSeedPackPreview(pack.definition.lessonId)
    if (!preview) return null
    const counts = preview.summary
    const missing = counts.content.new + counts.questions.new + counts.audio.new
    const changed = counts.content.updateAvailable + counts.questions.updateAvailable + counts.audio.updateAvailable
      + counts.content.blocked + counts.questions.blocked + counts.audio.blocked
    const existing = counts.content.unchanged + counts.questions.unchanged + counts.audio.unchanged
      + counts.content.approvedSkipped + counts.questions.approvedSkipped + counts.audio.approvedSkipped
    const total = pack.teaching.length + pack.questions.length + pack.audio.length
    const status = changed > 0 ? 'UPDATE_AVAILABLE'
      : missing === total ? 'NOT_IMPORTED'
        : missing > 0 ? 'PARTIAL' : existing > 0 ? 'IMPORTED' : 'NOT_IMPORTED'
    return { ...preview.lesson, status }
  })).then((rows) => rows.filter(Boolean))
}
