import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { parseCantoneseSeedRequest } from '@/lib/cantonese-course-pack-request'
import { getCantoneseSeedPackPreview } from '@/lib/cantonese-seed-pack-preview'
import { planSeedRows, summarizeSeedPlan } from '@/lib/cantonese-seed-import'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const rawBody = await request.text().catch(() => '')
  let body: Record<string, unknown> | null = null
  try {
    const value = JSON.parse(rawBody) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) body = value as Record<string, unknown>
  } catch { /* Existing parser returns a controlled validation response below. */ }
  if (typeof body?.packId === 'string') {
    const preview = await getCantoneseSeedPackPreview(body.packId)
    if (!preview) return NextResponse.json({ ok: false, code: 'UNKNOWN_COURSE_PACK' }, { status: 404, headers: NO_STORE })
    return NextResponse.json({ ...preview, selectedLessonId: body.packId, status: 'CONTENT_REVIEW_REQUIRED' }, { headers: NO_STORE })
  }
  const parsed = parseCantoneseSeedRequest(rawBody)
  if (parsed instanceof NextResponse) return parsed
  const { definitions, teaching, questions, audio, selectedLessonId } = parsed
  const [existingDefinitions, existingTeaching, existingQuestions, existingAudio] = await Promise.all([
    prisma.cantoneseCourseDefinition.findMany({ where: { lessonId: { in: definitions.map((item) => item.lessonId) } } }),
    prisma.cantoneseLessonContent.findMany({ where: { externalId: { in: teaching.map((item) => item.externalId) } } }),
    prisma.cantoneseQuestion.findMany({ where: { externalId: { in: questions.map((item) => item.externalId) } } }),
    prisma.cantoneseAudioAsset.findMany({ where: { externalId: { in: audio.map((item) => item.externalId) } } }),
  ])
  return NextResponse.json({
    preview: {
      definitions: summarizeSeedPlan(planSeedRows(definitions, existingDefinitions, 'definition', 'lessonId')),
      teaching: summarizeSeedPlan(planSeedRows(teaching, existingTeaching, 'teaching')),
      questions: summarizeSeedPlan(planSeedRows(questions, existingQuestions, 'question')),
      audio: summarizeSeedPlan(planSeedRows(audio, existingAudio, 'audio')),
    },
    selectedLessonId,
    status: 'CONTENT_REVIEW_REQUIRED',
    writes: false,
  }, { headers: NO_STORE })
}
