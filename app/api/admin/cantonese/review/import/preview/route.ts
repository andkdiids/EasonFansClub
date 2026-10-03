import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { parseCandidateImport } from '@/lib/cantonese-candidate-import'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function previewCounts(rows: { externalId: string }[], existing: { externalId: string }[]) {
  const seen = new Set(existing.map((item) => item.externalId))
  let willImport = 0
  for (const row of rows) {
    if (!seen.has(row.externalId)) {
      willImport++
      seen.add(row.externalId)
    }
  }
  return { total: rows.length, willImport, existing: rows.length - willImport }
}

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const parsed = parseCandidateImport(await request.text().catch(() => ''))
  if (parsed instanceof NextResponse) return parsed
  const { teaching, questions, audio } = parsed
  const [existingTeaching, existingQuestions, existingAudio] = await Promise.all([
    prisma.cantoneseLessonContent.findMany({ where: { externalId: { in: teaching.map((item) => item.externalId) } }, select: { externalId: true } }),
    prisma.cantoneseQuestion.findMany({ where: { externalId: { in: questions.map((item) => item.externalId) } }, select: { externalId: true } }),
    prisma.cantoneseAudioAsset.findMany({ where: { externalId: { in: audio.map((item) => item.externalId) } }, select: { externalId: true } }),
  ])
  return NextResponse.json({
    preview: {
      teaching: previewCounts(teaching, existingTeaching),
      questions: previewCounts(questions, existingQuestions),
      audio: previewCounts(audio, existingAudio),
    },
    status: 'CONTENT_REVIEW_REQUIRED',
    writes: false,
  }, { headers: NO_STORE })
}
