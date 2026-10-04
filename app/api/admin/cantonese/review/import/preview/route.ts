import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { parseCandidateImport } from '@/lib/cantonese-candidate-import'
import { planSeedRows, summarizeSeedPlan } from '@/lib/cantonese-seed-import'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const parsed = parseCandidateImport(await request.text().catch(() => ''))
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
