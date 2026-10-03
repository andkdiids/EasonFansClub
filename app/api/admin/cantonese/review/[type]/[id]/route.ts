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
  return NextResponse.json({ item: type === 'audio' ? audioFromUnion(record as NonNullable<Awaited<ReturnType<typeof prisma.cantoneseAudioAsset.findUnique>>>) : record, logs }, { headers: NO_STORE })
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
  if (!action || (action === 'mark-needs-regeneration' && type !== 'audio')) return jsonError('INVALID_ACTION', '审核操作无效', 400)
  const reason = body.reason === undefined ? null : safeReviewReason(body.reason)
  if (action === 'reject' && !reason) return jsonError('REJECTION_REASON_REQUIRED', '退回时必须填写原因', 400)
  if (body.reason !== undefined && !reason) return jsonError('INVALID_REASON', '审核说明无效', 400)

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (type === 'teaching') {
        const current = await tx.cantoneseLessonContent.findUnique({ where: { externalId: id } })
        if (!current) return null
        const update: Prisma.CantoneseLessonContentUpdateInput = {}
        if (action === 'edit') {
          const title = boundedText(body.title, 255, true)
          const lessonId = boundedText(body.lessonId, 32, true)
          const stageId = boundedText(body.stageId, 64, true)
          const stepId = boundedText(body.stepId, 100, true)
          const content = boundedText(body.body, 100_000, true)
          const displayText = boundedText(body.displayText, 10_000)
          const jyutping = boundedText(body.jyutping, 255)
          const tone = boundedText(body.tone, 64)
          const contentType = body.contentType === undefined ? undefined : parseContentType(body.contentType)
          const translation = boundedText(body.translation, 10_000)
          const explanation = boundedText(body.explanation, 20_000)
          const sortOrder = body.sortOrder === undefined ? undefined : Number(body.sortOrder)
          const examples = jsonValue(body.examples)
          const requiresAudio = body.requiresAudio === undefined ? undefined : body.requiresAudio === true
          const requiresSpeaking = body.requiresSpeaking === undefined ? undefined : body.requiresSpeaking === true
          if (!title || !lessonId || !stageId || !stepId || !content || (body.displayText !== undefined && displayText === null) || (body.jyutping !== undefined && jyutping === null) || (body.tone !== undefined && tone === null) || (body.contentType !== undefined && !contentType) || (body.translation !== undefined && translation === null) || (body.explanation !== undefined && explanation === null) || (body.sortOrder !== undefined && (sortOrder === undefined || !Number.isSafeInteger(sortOrder) || sortOrder < 0)) || (body.examples !== undefined && examples === null)
            || ((requiresSpeaking ?? current.requiresSpeaking) && !(requiresAudio ?? current.requiresAudio))
            || ((requiresAudio ?? current.requiresAudio) && !(body.displayText === undefined ? current.displayText : displayText)?.trim())) throw new Error('INVALID_EDIT')
          Object.assign(update, { title, lessonId, stageId, stepId, body: content, status: nextCantoneseReviewStatus(current.status, 'edit'), reviewer: { disconnect: true }, reviewedAt: null, reviewNote: null })
          if (body.displayText !== undefined) update.displayText = displayText
          if (body.jyutping !== undefined) update.jyutping = jyutping
          if (body.tone !== undefined) update.tone = tone
          if (body.contentType !== undefined) update.contentType = contentType as string
          if (body.translation !== undefined) update.translation = translation ?? null
          if (body.explanation !== undefined) update.explanation = explanation ?? null
          if (body.sortOrder !== undefined) update.sortOrder = sortOrder as number
          if (body.requiresAudio !== undefined) update.requiresAudio = requiresAudio
          if (body.requiresSpeaking !== undefined) update.requiresSpeaking = requiresSpeaking
          if (body.examples !== undefined) update.examples = examples === Prisma.JsonNull ? Prisma.JsonNull : examples as Prisma.InputJsonValue
        } else if (action === 'approve' || action === 'reject') {
          if (action === 'approve') {
            if (current.requiresSpeaking && !current.requiresAudio) throw new Error('INVALID_EDIT')
            if (current.requiresAudio) {
              const audio = current.audioId ? await tx.cantoneseAudioAsset.findUnique({ where: { externalId: current.audioId } }) : null
              if (!audio || audio.status !== 'APPROVED' || audio.assetStatus !== 'READY' || !audio.cosKey || !audio.checksum || !audio.fileSize) throw new Error('AUDIO_NOT_READY')
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
        await tx.cantoneseReviewLog.create({ data: { reviewer: { connect: { id: guard.user.id } }, targetType: 'TEACHING', targetId: id, action: action.toUpperCase(), oldStatus: current.status, newStatus: record.status, reason } })
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
      if (action === 'edit') {
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
    return jsonError('REVIEW_UPDATE_FAILED', '审核操作暂时失败，请稍后重试', 500)
  }
}
