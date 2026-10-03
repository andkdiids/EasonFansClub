import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { parseCandidateImport } from '@/lib/cantonese-candidate-import'

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
  const { teaching, questions, audio } = parsed
  try {
    const counts = await prisma.$transaction(async (tx) => {
      const teachingResult = teaching.length ? await tx.cantoneseLessonContent.createMany({ data: teaching, skipDuplicates: true }) : { count: 0 }
      const questionResult = questions.length ? await tx.cantoneseQuestion.createMany({ data: questions, skipDuplicates: true }) : { count: 0 }
      const audioResult = audio.length ? await tx.cantoneseAudioAsset.createMany({ data: audio, skipDuplicates: true }) : { count: 0 }
      return { teaching: teachingResult.count, questions: questionResult.count, audio: audioResult.count }
    })
    return NextResponse.json({ imported: counts, status: 'CONTENT_REVIEW_REQUIRED', existingRecordsPreserved: true }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'CANDIDATE_IMPORT_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
