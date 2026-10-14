import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { parseCantoneseSeedRequest } from '@/lib/cantonese-course-pack-request'
import { planSeedRows } from '@/lib/cantonese-seed-import'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const rawBody = await request.text().catch(() => '')
  let confirmation: unknown = null
  try { confirmation = (JSON.parse(rawBody) as Record<string, unknown>).confirmed } catch { /* Parser returns a controlled body error. */ }
  if (confirmation !== true) return NextResponse.json({ ok: false, code: 'IMPORT_CONFIRMATION_REQUIRED' }, { status: 400, headers: NO_STORE })
  const parsed = parseCantoneseSeedRequest(rawBody)
  if (parsed instanceof NextResponse) return parsed
  const { definitions, teaching, questions, audio, selectedLessonId, updateExistingCandidates } = parsed
  try {
    const counts = await prisma.$transaction(async (tx) => {
      const [existingDefinitions, existingTeaching, existingQuestions, existingAudio] = await Promise.all([
        tx.cantoneseCourseDefinition.findMany({ where: { lessonId: { in: definitions.map((row) => row.lessonId) } } }),
        tx.cantoneseLessonContent.findMany({ where: { externalId: { in: teaching.map((row) => row.externalId) } } }),
        tx.cantoneseQuestion.findMany({ where: { externalId: { in: questions.map((row) => row.externalId) } } }),
        tx.cantoneseAudioAsset.findMany({ where: { externalId: { in: audio.map((row) => row.externalId) } } }),
      ])
      const definitionPlan = planSeedRows(definitions, existingDefinitions, 'definition', 'lessonId')
      const teachingPlan = planSeedRows(teaching, existingTeaching, 'teaching')
      const questionPlan = planSeedRows(questions, existingQuestions, 'question')
      const audioPlan = planSeedRows(audio, existingAudio, 'audio')
      const definitionResult = await tx.cantoneseCourseDefinition.createMany({ data: definitionPlan.filter((row) => row.decision === 'CREATE_PENDING').map((row) => row.candidate), skipDuplicates: true })
      const teachingResult = await tx.cantoneseLessonContent.createMany({ data: teachingPlan.filter((row) => row.decision === 'CREATE_PENDING').map((row) => row.candidate), skipDuplicates: true })
      const questionResult = await tx.cantoneseQuestion.createMany({ data: questionPlan.filter((row) => row.decision === 'CREATE_PENDING').map((row) => row.candidate), skipDuplicates: true })
      const audioResult = await tx.cantoneseAudioAsset.createMany({ data: audioPlan.filter((row) => row.decision === 'CREATE_PENDING').map((row) => row.candidate), skipDuplicates: true })
      const updated = { definitions: 0, teaching: 0, questions: 0, audio: 0 }
      if (updateExistingCandidates) {
        for (const row of definitionPlan.filter((item) => item.decision === 'CANDIDATE_UPDATE_AVAILABLE')) {
          const { lessonId, status: _status, ...data } = row.candidate
          void _status
          updated.definitions += (await tx.cantoneseCourseDefinition.updateMany({
            where: { lessonId, status: row.existing!.status as 'DRAFT' | 'CONTENT_REVIEW_REQUIRED' | 'ARCHIVED', updatedAt: row.existing!.updatedAt },
            data,
          })).count
        }
        for (const row of teachingPlan.filter((item) => item.decision === 'CANDIDATE_UPDATE_AVAILABLE')) {
          const { externalId, status: _status, ...data } = row.candidate
          void _status
          updated.teaching += (await tx.cantoneseLessonContent.updateMany({
            where: { externalId, status: row.existing!.status as 'DRAFT' | 'CONTENT_REVIEW_REQUIRED' | 'REJECTED', updatedAt: row.existing!.updatedAt },
            data,
          })).count
        }
        for (const row of questionPlan.filter((item) => item.decision === 'CANDIDATE_UPDATE_AVAILABLE')) {
          const { externalId, status: _status, ...data } = row.candidate
          void _status
          updated.questions += (await tx.cantoneseQuestion.updateMany({
            where: { externalId, status: row.existing!.status as 'DRAFT' | 'CONTENT_REVIEW_REQUIRED' | 'REJECTED', updatedAt: row.existing!.updatedAt },
            data,
          })).count
        }
        for (const row of audioPlan.filter((item) => item.decision === 'CANDIDATE_UPDATE_AVAILABLE')) {
          const { externalId, status: _status, assetStatus: _assetStatus, ...data } = row.candidate
          void _status
          void _assetStatus
          updated.audio += (await tx.cantoneseAudioAsset.updateMany({
            where: { externalId, status: row.existing!.status as 'DRAFT' | 'CONTENT_REVIEW_REQUIRED' | 'REJECTED', updatedAt: row.existing!.updatedAt, assetStatus: 'NOT_GENERATED', cosKey: null },
            data,
          })).count
        }
      }
      return {
        imported: { definitions: definitionResult.count, teaching: teachingResult.count, questions: questionResult.count, audio: audioResult.count },
        updated,
        skippedAlreadyApproved: {
          definitions: definitionPlan.filter((row) => row.decision === 'SKIPPED_ALREADY_APPROVED').length,
          teaching: teachingPlan.filter((row) => row.decision === 'SKIPPED_ALREADY_APPROVED').length,
          questions: questionPlan.filter((row) => row.decision === 'SKIPPED_ALREADY_APPROVED').length,
          audio: audioPlan.filter((row) => row.decision === 'SKIPPED_ALREADY_APPROVED').length,
        },
        updateAvailable: {
          definitions: definitionPlan.filter((row) => row.decision === 'UPDATE_AVAILABLE').length,
          teaching: teachingPlan.filter((row) => row.decision === 'UPDATE_AVAILABLE').length,
          questions: questionPlan.filter((row) => row.decision === 'UPDATE_AVAILABLE').length,
          audio: audioPlan.filter((row) => row.decision === 'UPDATE_AVAILABLE').length,
        },
        unchanged: {
          definitions: definitionPlan.filter((row) => row.decision === 'SKIPPED_EXISTING').length,
          teaching: teachingPlan.filter((row) => row.decision === 'SKIPPED_EXISTING').length,
          questions: questionPlan.filter((row) => row.decision === 'SKIPPED_EXISTING').length,
          audio: audioPlan.filter((row) => row.decision === 'SKIPPED_EXISTING').length,
        },
        blocked: {
          definitions: 0,
          teaching: teachingPlan.filter((row) => row.decision === 'AUDIO_ASSET_REVIEW_REQUIRED').length,
          questions: questionPlan.filter((row) => row.decision === 'AUDIO_ASSET_REVIEW_REQUIRED').length,
          audio: audioPlan.filter((row) => row.decision === 'AUDIO_ASSET_REVIEW_REQUIRED').length,
        },
      }
    })
    const sum = (groups: Record<string, number>) => Object.values(groups).reduce((total, value) => total + value, 0)
    const result = {
      created: sum(counts.imported),
      updated: sum(counts.updated),
      skippedAlreadyApproved: sum(counts.skippedAlreadyApproved),
      unchanged: sum(counts.unchanged),
      blocked: sum(counts.blocked),
      failed: 0,
    }
    return NextResponse.json({ ...counts, result, selectedLessonId, status: 'CONTENT_REVIEW_REQUIRED', existingRecordsPreserved: true }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'CANDIDATE_IMPORT_FAILED', result: { created: 0, updated: 0, skippedAlreadyApproved: 0, unchanged: 0, blocked: 0, failed: 1 } }, { status: 500, headers: NO_STORE })
  }
}
