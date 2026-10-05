import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  isCantoneseQuestionType,
  nextCantoneseReviewStatus,
  parseCantoneseReviewAction,
  parseCantoneseReviewEntityType,
  nextCantoneseAudioVersion,
  safeReviewIdentifier,
  safeReviewReason,
} from '@/lib/cantonese-review'
import { parseContentType } from '@/lib/cantonese-content-admin'
import { cantoneseJyutpingReviewDigest, CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION, isLatestJyutpingVerification, jyutpingReviewLogView, jyutpingVerificationReason } from '@/lib/cantonese-jyutping-review'
import { decorateAudioPronunciation, resolveAudioPronunciation } from '@/lib/cantonese-audio-pronunciation'
import { validateCantoneseQuestionQuality } from '@/lib/cantonese-question-quality'
import { requireRequestAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
type RouteContext = { params: Promise<{ type: string; id: string }> }

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status, headers: NO_STORE })
}

function boundedText(value: unknown, maxLength: number, required = false) {
  if (value === undefined) return undefined
  if (value === null && !required) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if ((required && !trimmed) || trimmed.length > maxLength) return null
  return sanitizeText(trimmed, maxLength)
}

function hasOwnField(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field) && body[field] !== undefined
}

/** Teaching edit strings use undefined=unchanged, null/blank=clear for nullable fields. */
function teachingPatchNullableText(body: Record<string, unknown>, field: string, maxLength: number) {
  if (!hasOwnField(body, field)) return undefined
  const value = body[field]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('INVALID_EDIT')
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) throw new Error('INVALID_EDIT')
  const sanitized = sanitizeText(trimmed, maxLength)
  return sanitized || null
}

function teachingPatchRequiredText(body: Record<string, unknown>, field: string, maxLength: number) {
  if (!hasOwnField(body, field)) return undefined
  const value = body[field]
  if (typeof value !== 'string') throw new Error('INVALID_EDIT')
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) throw new Error('INVALID_EDIT')
  const sanitized = sanitizeText(trimmed, maxLength)
  if (!sanitized) throw new Error('INVALID_EDIT')
  return sanitized
}

function teachingPatchBoolean(body: Record<string, unknown>, field: string) {
  if (!hasOwnField(body, field)) return undefined
  if (typeof body[field] !== 'boolean') throw new Error('INVALID_EDIT')
  return body[field]
}

function teachingPatchSortOrder(body: Record<string, unknown>) {
  if (!hasOwnField(body, 'sortOrder')) return undefined
  if ((typeof body.sortOrder !== 'number' && typeof body.sortOrder !== 'string') || (typeof body.sortOrder === 'string' && !body.sortOrder.trim())) throw new Error('INVALID_EDIT')
  const value = Number(body.sortOrder)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_EDIT')
  return value
}

function teachingEditAuditReason(reason: string | null, beforeJyutping: string | null, afterJyutping: string | null, submitted: boolean) {
  if (!submitted) return reason
  const detail = { kind: 'JYUTPING_EDIT', beforeJyutping, afterJyutping, ...(reason ? { note: reason } : {}) }
  const serialized = JSON.stringify(detail)
  if (serialized.length <= 2_000) return serialized
  return JSON.stringify({ kind: 'JYUTPING_EDIT', beforeJyutping, afterJyutping })
}

function jsonValue(value: unknown, maxBytes = 64_000) {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > maxBytes) return null
    return JSON.parse(serialized) as Prisma.InputJsonValue
  } catch {
    return null
  }
}

function safeAudio<T extends { cosKey: string | null; assetStatus: string }>(asset: T) {
  const { cosKey, ...safe } = asset as T & { audioKey?: string | null }
  const publicAsset = { ...safe }
  delete (publicAsset as { audioKey?: string | null }).audioKey
  return { ...publicAsset, serverSupported: Boolean(cosKey && asset.assetStatus === 'READY') }
}

function audioFromUnion(record: NonNullable<Awaited<ReturnType<typeof prisma.cantoneseAudioAsset.findUnique>>>) {
  return safeAudio(record)
}

async function hasJyutpingVerification(tx: Prisma.TransactionClient, targetType: 'TEACHING' | 'AUDIO', targetId: string, text: string | null, jyutping: string | null) {
  const digest = cantoneseJyutpingReviewDigest(text, jyutping)
  if (!digest) return false
  const logs = await tx.cantoneseReviewLog.findMany({
    where: { targetType, targetId, action: { in: [CANTONESE_JYUTPING_REVIEW_ACTION, CANTONESE_JYUTPING_REVOKE_ACTION] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { action: true, reason: true, createdAt: true },
  })
  return isLatestJyutpingVerification(logs, digest)
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') return jsonError('FORBIDDEN', '只有管理员可以审核粤语课程', 403)
  const params = await context.params
  const type = parseCantoneseReviewEntityType(params.type)
  const id = safeReviewIdentifier(params.id)
  if (!type || !id) return jsonError('INVALID_TARGET', '审核目标无效', 400)

  const [record, logs] = await Promise.all([
    type === 'teaching'
      ? prisma.cantoneseLessonContent.findUnique({ where: { externalId: id } })
      : type === 'question'
        ? prisma.cantoneseQuestion.findUnique({ where: { externalId: id } })
        : prisma.cantoneseAudioAsset.findUnique({ where: { externalId: id } }),
    prisma.cantoneseReviewLog.findMany({
      where: { targetType: type.toUpperCase(), targetId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, oldStatus: true, newStatus: true, reason: true, createdAt: true, reviewer: { select: { id: true, nickname: true } } },
    }),
  ])
  if (!record) return jsonError('NOT_FOUND', '审核内容不存在', 404)
  const teachingRecord = type === 'teaching' ? record as NonNullable<Awaited<ReturnType<typeof prisma.cantoneseLessonContent.findUnique>>> : null
  const questionRecord = type === 'question' ? record as NonNullable<Awaited<ReturnType<typeof prisma.cantoneseQuestion.findUnique>>> : null
  const audioRecord = type === 'audio' ? record as NonNullable<Awaited<ReturnType<typeof prisma.cantoneseAudioAsset.findUnique>>> : null
  // Display history is bounded, but older valid confirmations must not disappear with pagination.
  const verified = teachingRecord && (teachingRecord.requiresAudio || teachingRecord.requiresSpeaking)
    ? await hasJyutpingVerification(prisma, 'TEACHING', id, teachingRecord.displayText, teachingRecord.jyutping)
    : false
  let item: Record<string, unknown> = audioRecord
    ? await decorateAudioPronunciation(prisma, audioFromUnion(audioRecord))
    : teachingRecord
      ? { ...teachingRecord, jyutpingReviewStatus: teachingRecord.requiresAudio || teachingRecord.requiresSpeaking ? (verified ? 'VERIFIED' : 'JYUTPING_REVIEW_REQUIRED') : 'NOT_REQUIRED' }
      : questionRecord || {}
  if (teachingRecord?.audioId && teachingRecord.requiresAudio) {
    const audio = await prisma.cantoneseAudioAsset.findUnique({ where: { externalId: teachingRecord.audioId }, select: { text: true, jyutping: true, status: true, assetStatus: true, cosKey: true, checksum: true, fileSize: true } })
    item = { ...item, audioReviewStatus: audio?.status || null, audioAssetStatus: audio?.assetStatus || null, audioReady: Boolean(audio?.status === 'APPROVED' && audio.assetStatus === 'READY' && audio.cosKey && audio.checksum && audio.fileSize && audio.text === teachingRecord.displayText && audio.jyutping === teachingRecord.jyutping) }
  } else if (questionRecord?.audioId && (questionRecord.questionType === 'LISTENING' || questionRecord.questionType === 'SPEAKING')) {
    const audio = await prisma.cantoneseAudioAsset.findUnique({ where: { externalId: questionRecord.audioId }, select: { status: true, assetStatus: true, cosKey: true, checksum: true, fileSize: true } })
    item = { ...item, audioReviewStatus: audio?.status || null, audioAssetStatus: audio?.assetStatus || null, audioReady: Boolean(audio?.status === 'APPROVED' && audio.assetStatus === 'READY' && audio.cosKey && audio.checksum && audio.fileSize) }
  }
  return NextResponse.json({ item, logs: logs.map((entry) => jyutpingReviewLogView(entry, teachingRecord?.displayText ?? audioRecord?.text ?? null, teachingRecord?.jyutping ?? audioRecord?.jyutping ?? null)) }, { headers: NO_STORE })
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') return jsonError('FORBIDDEN', '只有管理员可以审核粤语课程', 403)
  const params = await context.params
  const type = parseCantoneseReviewEntityType(params.type)
  const id = safeReviewIdentifier(params.id)
  if (!type || !id) return jsonError('INVALID_TARGET', '审核目标无效', 400)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return jsonError('INVALID_BODY', '请求内容无效', 400)
  const action = parseCantoneseReviewAction(body.action)
  if (!action || (action === 'mark-needs-regeneration' && type !== 'audio') || ((action === 'verify-jyutping' || action === 'revoke-jyutping') && type === 'question')) return jsonError('INVALID_ACTION', '审核操作无效', 400)
  const reason = body.reason === undefined ? null : safeReviewReason(body.reason)
  if (action === 'reject' && !reason) return jsonError('REJECTION_REASON_REQUIRED', '退回时必须填写原因', 400)
  if (body.reason !== undefined && !reason) return jsonError('INVALID_REASON', '审核说明无效', 400)

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (type === 'teaching') {
        const current = await tx.cantoneseLessonContent.findUnique({ where: { externalId: id } })
        if (!current) return null
        const update: Prisma.CantoneseLessonContentUpdateInput = {}
        let logReason = reason
        if (action === 'verify-jyutping' || action === 'revoke-jyutping') {
          const digest = cantoneseJyutpingReviewDigest(current.displayText, current.jyutping)
          if (!digest) throw new Error('JYUTPING_REVIEW_REQUIRED')
          if (action === 'verify-jyutping') {
            await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'TEACHING', targetId: id, action: CANTONESE_JYUTPING_REVIEW_ACTION, oldStatus: current.status, newStatus: current.status, reason: jyutpingVerificationReason(current.displayText, current.jyutping) } })
            return current
          }
          const record = current.status === 'APPROVED'
            ? await tx.cantoneseLessonContent.update({ where: { externalId: id }, data: { status: 'CONTENT_REVIEW_REQUIRED', reviewer: { disconnect: true }, reviewedAt: null, reviewNote: null } })
            : current
          await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'TEACHING', targetId: id, action: CANTONESE_JYUTPING_REVOKE_ACTION, oldStatus: current.status, newStatus: record.status, reason: jyutpingVerificationReason(current.displayText, current.jyutping) } })
          return record
        } else if (action === 'edit') {
          const title = teachingPatchRequiredText(body, 'title', 255)
          const lessonId = teachingPatchRequiredText(body, 'lessonId', 32)
          const stageId = teachingPatchRequiredText(body, 'stageId', 64)
          const stepId = teachingPatchRequiredText(body, 'stepId', 100)
          const content = teachingPatchRequiredText(body, 'body', 100_000)
          const displayText = teachingPatchNullableText(body, 'displayText', 10_000)
          const jyutping = teachingPatchNullableText(body, 'jyutping', 255)
          const tone = teachingPatchNullableText(body, 'tone', 64)
          const contentType = hasOwnField(body, 'contentType') ? parseContentType(body.contentType) : undefined
          const translation = teachingPatchNullableText(body, 'translation', 10_000)
          const explanation = teachingPatchNullableText(body, 'explanation', 20_000)
          const section = teachingPatchNullableText(body, 'section', 100)
          const usageNote = teachingPatchNullableText(body, 'usageNote', 10_000)
          const sourceReference = teachingPatchNullableText(body, 'sourceReference', 2_000)
          const dialogueId = teachingPatchNullableText(body, 'dialogueId', 100)
          const speaker = teachingPatchNullableText(body, 'speaker', 16)
          const sortOrder = teachingPatchSortOrder(body)
          const examples = hasOwnField(body, 'examples')
            ? body.examples === null ? null : jsonValue(body.examples)
            : undefined
          const requiresAudio = teachingPatchBoolean(body, 'requiresAudio')
          const requiresSpeaking = teachingPatchBoolean(body, 'requiresSpeaking')
          if (contentType === null
            || (hasOwnField(body, 'examples') && body.examples !== null && examples === null)) throw new Error('INVALID_EDIT')

          const nextDisplayText = displayText === undefined ? current.displayText : displayText
          const nextRequiresAudio = requiresAudio === undefined ? current.requiresAudio : requiresAudio
          const nextRequiresSpeaking = requiresSpeaking === undefined ? current.requiresSpeaking : requiresSpeaking
          if ((nextRequiresSpeaking && !nextRequiresAudio) || ((nextRequiresAudio || nextRequiresSpeaking) && !nextDisplayText?.trim())) throw new Error('INVALID_EDIT')

          let changed = false
          if (title !== undefined) { update.title = title; changed ||= title !== current.title }
          if (lessonId !== undefined) { update.lessonId = lessonId; changed ||= lessonId !== current.lessonId }
          if (stageId !== undefined) { update.stageId = stageId; changed ||= stageId !== current.stageId }
          if (stepId !== undefined) { update.stepId = stepId; changed ||= stepId !== current.stepId }
          if (content !== undefined) { update.body = content; changed ||= content !== current.body }
          if (displayText !== undefined) { update.displayText = displayText; changed ||= displayText !== current.displayText }
          if (jyutping !== undefined) { update.jyutping = jyutping; changed ||= jyutping !== current.jyutping }
          if (tone !== undefined) { update.tone = tone; changed ||= tone !== current.tone }
          if (contentType !== undefined) {
            if (!contentType) throw new Error('INVALID_EDIT')
            update.contentType = contentType
            changed ||= contentType !== current.contentType
          }
          if (translation !== undefined) { update.translation = translation; changed ||= translation !== current.translation }
          if (explanation !== undefined) { update.explanation = explanation; changed ||= explanation !== current.explanation }
          if (section !== undefined) { update.section = section; changed ||= section !== current.section }
          if (usageNote !== undefined) { update.usageNote = usageNote; changed ||= usageNote !== current.usageNote }
          if (sourceReference !== undefined) { update.sourceReference = sourceReference; changed ||= sourceReference !== current.sourceReference }
          if (dialogueId !== undefined) { update.dialogueId = dialogueId; changed ||= dialogueId !== current.dialogueId }
          if (speaker !== undefined) { update.speaker = speaker; changed ||= speaker !== current.speaker }
          if (sortOrder !== undefined) { update.sortOrder = sortOrder; changed ||= sortOrder !== current.sortOrder }
          if (requiresAudio !== undefined) { update.requiresAudio = requiresAudio; changed ||= requiresAudio !== current.requiresAudio }
          if (requiresSpeaking !== undefined) { update.requiresSpeaking = requiresSpeaking; changed ||= requiresSpeaking !== current.requiresSpeaking }
          if (examples !== undefined) {
            update.examples = examples === null ? Prisma.JsonNull : examples as Prisma.InputJsonValue
            changed ||= JSON.stringify(examples) !== JSON.stringify(current.examples)
          }

          // A form may submit the current nullable values back as null. Treating that as a no-op
          // keeps a same-value Jyutping save from resetting review state or versioning the row.
          if (!changed) return current

          Object.assign(update, {
            status: nextCantoneseReviewStatus(current.status, 'edit'),
            reviewer: { disconnect: true },
            reviewedAt: null,
            reviewNote: null,
            contentVersion: current.contentVersion + 1,
          })
          const nextJyutping = jyutping === undefined ? current.jyutping : jyutping
          const oldDigest = cantoneseJyutpingReviewDigest(current.displayText, current.jyutping)
          const newDigest = cantoneseJyutpingReviewDigest(nextDisplayText, nextJyutping)
          if (oldDigest !== newDigest && oldDigest) {
            // Explicitly revoke the old pair so returning to it cannot inherit stale approval.
            await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'TEACHING', targetId: id, action: CANTONESE_JYUTPING_REVOKE_ACTION, oldStatus: current.status, newStatus: nextCantoneseReviewStatus(current.status, 'edit'), reason: oldDigest } })
          }
          logReason = teachingEditAuditReason(reason, current.jyutping, nextJyutping, true)
        } else if (action === 'approve' || action === 'reject') {
          if (action === 'approve') {
            if (current.requiresSpeaking && !current.requiresAudio) throw new Error('INVALID_EDIT')
            if ((current.requiresAudio || current.requiresSpeaking) && !await hasJyutpingVerification(tx, 'TEACHING', id, current.displayText, current.jyutping)) throw new Error('JYUTPING_REVIEW_REQUIRED')
            if (current.requiresAudio) {
              const audio = current.audioId ? await tx.cantoneseAudioAsset.findUnique({ where: { externalId: current.audioId } }) : null
              if (!audio || audio.status !== 'APPROVED' || audio.assetStatus !== 'READY' || !audio.cosKey || !audio.checksum || !audio.fileSize) throw new Error('AUDIO_NOT_READY')
              if (audio.text !== current.displayText || audio.jyutping !== current.jyutping) throw new Error('AUDIO_CONTENT_MISMATCH')
            }
          }
          update.status = nextCantoneseReviewStatus(current.status, action)
          update.reviewer = { connect: { id: guard.user.id } }
          update.reviewedAt = new Date()
          update.reviewNote = reason
        } else {
          throw new Error('INVALID_ACTION')
        }
        const record = await tx.cantoneseLessonContent.update({ where: { externalId: id }, data: update })
        await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'TEACHING', targetId: id, action: action.toUpperCase(), oldStatus: current.status, newStatus: record.status, reason: logReason } })
        return record
      }

      if (type === 'question') {
        const current = await tx.cantoneseQuestion.findUnique({ where: { externalId: id } })
        if (!current) return null
        const update: Prisma.CantoneseQuestionUpdateInput = {}
        if (action === 'edit') {
          const lessonId = boundedText(body.lessonId, 32, true)
          const stageId = boundedText(body.stageId, 64, true)
          const prompt = boundedText(body.prompt, 20_000, true)
          const explanation = boundedText(body.explanation, 20_000, true)
          const questionType = typeof body.questionType === 'string' && isCantoneseQuestionType(body.questionType) ? body.questionType : null
          const options = jsonValue(body.options)
          const correctAnswer = jsonValue(body.correctAnswer)
          const prerequisiteContentIds = jsonValue(body.prerequisiteContentIds)
          const audioId = boundedText(body.audioId, 191)
          const speakingReferenceId = boundedText(body.speakingReferenceId, 191)
          const lyricPrescriptionId = boundedText(body.lyricPrescriptionId, 191)
          const sortOrder = body.sortOrder === undefined ? undefined : Number(body.sortOrder)
          if (!lessonId || !stageId || !prompt || !explanation || !questionType || !Array.isArray(body.options) || options === null || correctAnswer === undefined || correctAnswer === null || !Array.isArray(body.prerequisiteContentIds) || prerequisiteContentIds === null || (body.audioId !== undefined && audioId === null) || (body.speakingReferenceId !== undefined && speakingReferenceId === null) || (body.lyricPrescriptionId !== undefined && lyricPrescriptionId === null) || (body.sortOrder !== undefined && (sortOrder === undefined || !Number.isSafeInteger(sortOrder) || sortOrder < 0))) throw new Error('INVALID_EDIT')
          if (lyricPrescriptionId && !await tx.lyricPrescription.findUnique({ where: { id: lyricPrescriptionId }, select: { id: true } })) throw new Error('LYRIC_SOURCE_NOT_FOUND')
          Object.assign(update, { lessonId, stageId, prompt, explanation, questionType, options, correctAnswer, prerequisiteContentIds, status: nextCantoneseReviewStatus(current.status, 'edit'), reviewer: { disconnect: true }, reviewedAt: null, reviewNote: null })
          if (body.audioId !== undefined) update.audioId = audioId
          if (body.speakingReferenceId !== undefined) update.speakingReferenceId = speakingReferenceId
          if (body.sortOrder !== undefined) update.sortOrder = sortOrder as number
          if (body.lyricPrescriptionId !== undefined) update.LyricPrescription = lyricPrescriptionId ? { connect: { id: lyricPrescriptionId } } : { disconnect: true }
        } else if (action === 'approve' || action === 'reject') {
          if (action === 'approve') {
            const qualityCode = validateCantoneseQuestionQuality(current)
            if (qualityCode) throw new Error(`QUESTION_${qualityCode}`)
            const prerequisites = Array.isArray(current.prerequisiteContentIds) && current.prerequisiteContentIds.every((value) => typeof value === 'string')
              ? current.prerequisiteContentIds as string[] : null
            if (!prerequisites) throw new Error('QUESTION_PREREQUISITE_NOT_APPROVED')
            const requiredContents = await tx.cantoneseLessonContent.findMany({
              where: { externalId: { in: prerequisites } },
              select: { externalId: true, lessonId: true, status: true, requiresSpeaking: true, requiresAudio: true, displayText: true, jyutping: true },
            })
            if (requiredContents.length !== prerequisites.length || requiredContents.some((item) => item.lessonId !== current.lessonId || item.status !== 'APPROVED')) throw new Error('QUESTION_PREREQUISITE_NOT_APPROVED')
            for (const item of requiredContents) {
              if ((item.requiresAudio || item.requiresSpeaking) && !await hasJyutpingVerification(tx, 'TEACHING', item.externalId, item.displayText, item.jyutping)) throw new Error('JYUTPING_REVIEW_REQUIRED')
            }
            if (current.questionType === 'LISTENING' || current.questionType === 'SPEAKING') {
              const audio = current.audioId ? await tx.cantoneseAudioAsset.findUnique({ where: { externalId: current.audioId } }) : null
              if (!audio || audio.status !== 'APPROVED' || audio.assetStatus !== 'READY' || !audio.cosKey || !audio.checksum || !audio.fileSize) throw new Error('AUDIO_NOT_READY')
            }
            if (current.questionType === 'SPEAKING') {
              const speaking = current.speakingReferenceId ? await tx.cantoneseLessonContent.findUnique({ where: { externalId: current.speakingReferenceId } }) : null
              if (!speaking || speaking.status !== 'APPROVED' || speaking.lessonId !== current.lessonId || !speaking.requiresSpeaking || speaking.audioId !== current.audioId) throw new Error('SPEAKING_REFERENCE_NOT_READY')
            }
          }
          update.status = nextCantoneseReviewStatus(current.status, action)
          update.reviewer = { connect: { id: guard.user.id } }
          update.reviewedAt = new Date()
          update.reviewNote = reason
        } else {
          throw new Error('INVALID_ACTION')
        }
        const record = await tx.cantoneseQuestion.update({ where: { externalId: id }, data: update })
        await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'QUESTION', targetId: id, action: action.toUpperCase(), oldStatus: current.status, newStatus: record.status, reason } })
        return record
      }

      const current = await tx.cantoneseAudioAsset.findUnique({ where: { externalId: id } })
      if (!current) return null
      const update: Prisma.CantoneseAudioAssetUpdateInput = {}
      if (action === 'verify-jyutping' || action === 'revoke-jyutping') {
        if (current.contentId) throw new Error('CONTENT_JYUTPING_SOURCE_REQUIRED')
        const digest = cantoneseJyutpingReviewDigest(current.text, current.jyutping)
        if (!digest) throw new Error('JYUTPING_REVIEW_REQUIRED')
        if (action === 'verify-jyutping') {
          await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'AUDIO', targetId: id, action: CANTONESE_JYUTPING_REVIEW_ACTION, oldStatus: current.status, newStatus: current.status, reason: jyutpingVerificationReason(current.text, current.jyutping) } })
          return safeAudio(current)
        }
        const record = current.status === 'APPROVED'
          ? await tx.cantoneseAudioAsset.update({ where: { externalId: id }, data: { status: 'CONTENT_REVIEW_REQUIRED', reviewer: { disconnect: true }, reviewedAt: null, reviewNote: null } })
          : current
        await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'AUDIO', targetId: id, action: CANTONESE_JYUTPING_REVOKE_ACTION, oldStatus: current.status, newStatus: record.status, reason: jyutpingVerificationReason(current.text, current.jyutping) } })
        return safeAudio(record)
      } else if (action === 'edit') {
        if (current.contentId && ((body.text !== undefined && body.text !== current.text) || (body.jyutping !== undefined && body.jyutping !== current.jyutping) || (body.contentId !== undefined && body.contentId !== current.contentId))) throw new Error('CONTENT_JYUTPING_SOURCE_REQUIRED')
        const spokenText = boundedText(body.text, 4000, true)
        const jyutping = boundedText(body.jyutping, 255)
        const lessonId = boundedText(body.lessonId, 32)
        const contentId = boundedText(body.contentId, 191)
        const voiceProfile = boundedText(body.voiceProfile, 64, true)
        const speed = body.speed === undefined || body.speed === null || body.speed === '' ? undefined : Number(body.speed)
        const sampleRate = body.sampleRate === undefined ? undefined : Number(body.sampleRate)
        const codec = body.codec === undefined ? undefined : boundedText(body.codec, 16, true)
        const notes = boundedText(body.notes, 10_000)
        if (!spokenText || body.audioVersion !== undefined || body.checksum !== undefined || body.fileSize !== undefined || body.cosKey !== undefined || body.audioKey !== undefined || (body.voiceProfile !== undefined && !voiceProfile) || (body.jyutping !== undefined && jyutping === null) || (body.lessonId !== undefined && lessonId === null) || (body.contentId !== undefined && contentId === null) || (body.notes !== undefined && notes === null) || (speed !== undefined && (!Number.isFinite(speed) || speed < -2 || speed > 6)) || (sampleRate !== undefined && (!Number.isSafeInteger(sampleRate) || ![8000, 16000].includes(sampleRate))) || (codec !== undefined && codec !== 'mp3')) throw new Error('INVALID_EDIT')
        const audioVersion = nextCantoneseAudioVersion(current.audioVersion)
        Object.assign(update, {
          text: spokenText,
          audioVersion,
          audioKey: null,
          status: nextCantoneseReviewStatus(current.status, 'edit'),
          assetStatus: 'NEEDS_REGENERATION',
          cosKey: null,
          checksum: null,
          fileSize: null,
          reviewer: { disconnect: true },
          reviewedAt: null,
          reviewNote: null,
        })
        if (body.jyutping !== undefined) update.jyutping = jyutping
        if (body.lessonId !== undefined) update.lessonId = lessonId
        if (body.contentId !== undefined) update.contentId = contentId
        if (body.voiceProfile !== undefined) update.voiceProfile = voiceProfile as string
        if (speed !== undefined) update.speed = speed
        if (sampleRate !== undefined) update.sampleRate = sampleRate
        if (codec !== undefined) update.codec = codec
        if (body.notes !== undefined) update.notes = notes ?? null
      } else if (action === 'approve' || action === 'reject') {
        if (action === 'approve') {
          const pronunciation = await resolveAudioPronunciation(tx, current)
          if (!pronunciation.validSource || !pronunciation.snapshotMatches) throw new Error('AUDIO_CONTENT_MISMATCH')
          if (!pronunciation.verified) throw new Error('JYUTPING_REVIEW_REQUIRED')
        }
        if (action === 'approve' && (!current.cosKey || !current.checksum || !current.fileSize || current.assetStatus !== 'READY')) throw new Error('AUDIO_NOT_READY')
        update.status = nextCantoneseReviewStatus(current.status, action)
        update.reviewer = { connect: { id: guard.user.id } }
        update.reviewedAt = new Date()
        update.reviewNote = reason
      } else if (action === 'mark-needs-regeneration') {
        update.assetStatus = 'NEEDS_REGENERATION'
        update.status = 'CONTENT_REVIEW_REQUIRED'
        update.audioVersion = nextCantoneseAudioVersion(current.audioVersion)
        update.audioKey = null
        update.cosKey = null
        update.checksum = null
        update.fileSize = null
        update.reviewer = { connect: { id: guard.user.id } }
        update.reviewedAt = new Date()
        update.reviewNote = reason || '需重新生成音频'
      } else {
        throw new Error('INVALID_ACTION')
      }
      const record = await tx.cantoneseAudioAsset.update({ where: { externalId: id }, data: update })
      await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'AUDIO', targetId: id, action: action.toUpperCase().replaceAll('-', '_'), oldStatus: current.status, newStatus: record.status, reason: reason || (action === 'mark-needs-regeneration' ? '需重新生成音频' : null) } })
      return safeAudio(record)
    })
    if (!updated) return jsonError('NOT_FOUND', '审核内容不存在', 404)
    return NextResponse.json({ item: updated }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_EDIT') return jsonError('INVALID_EDIT', '提交的审核内容无效', 400)
    if (error instanceof Error && error.message === 'INVALID_ACTION') return jsonError('INVALID_ACTION', '审核操作无效', 400)
    if (error instanceof Error && error.message === 'LYRIC_SOURCE_NOT_FOUND') return jsonError('LYRIC_SOURCE_NOT_FOUND', '关联的歌词来源不存在', 400)
    if (error instanceof Error && error.message === 'AUDIO_NOT_READY') return jsonError('AUDIO_NOT_READY', '音频资源尚未就绪，不能审核通过', 409)
    if (error instanceof Error && error.message === 'JYUTPING_REVIEW_REQUIRED') return jsonError('JYUTPING_REVIEW_REQUIRED', '请先核对粤拼，再生成或审核标准音频。', 409)
    if (error instanceof Error && error.message === 'CONTENT_JYUTPING_SOURCE_REQUIRED') return jsonError('CONTENT_JYUTPING_SOURCE_REQUIRED', '请在关联教学内容中编辑及核对粤拼；音频引用该确认结果', 409)
    if (error instanceof Error && error.message === 'AUDIO_CONTENT_MISMATCH') return jsonError('AUDIO_CONTENT_MISMATCH', '标准音频文本或粤拼与教学内容不一致', 409)
    if (error instanceof Error && error.message === 'QUESTION_PREREQUISITE_NOT_APPROVED') return jsonError('QUESTION_PREREQUISITE_NOT_APPROVED', '题目关联的前置教学尚未审核通过', 409)
    if (error instanceof Error && error.message === 'SPEAKING_REFERENCE_NOT_READY') return jsonError('SPEAKING_REFERENCE_NOT_READY', '跟读参考内容及音频尚未就绪', 409)
    if (error instanceof Error && error.message.startsWith('QUESTION_')) return jsonError('INVALID_QUESTION', '题目结构或答案不符合审核要求', 409)
    return jsonError('REVIEW_UPDATE_FAILED', '审核操作暂时失败，请稍后重试', 500)
  }
}
