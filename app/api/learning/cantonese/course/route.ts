import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [lessonContents, questions, audioAssets] = await Promise.all([
    prisma.cantoneseLessonContent.findMany({
      where: { status: 'APPROVED' },
      orderBy: [{ lessonId: 'asc' }, { stageId: 'asc' }, { stepId: 'asc' }, { externalId: 'asc' }],
      select: {
        externalId: true, lessonId: true, stageId: true, stepId: true, title: true, body: true,
        displayText: true, jyutping: true, tone: true, examples: true, audioId: true, updatedAt: true,
      },
    }),
    prisma.cantoneseQuestion.findMany({
      where: { status: 'APPROVED' },
      orderBy: [{ lessonId: 'asc' }, { stageId: 'asc' }, { externalId: 'asc' }],
      select: {
        externalId: true, lessonId: true, stageId: true, questionType: true, prompt: true,
        options: true, explanation: true, prerequisiteContentIds: true,
        audioId: true, lyricPrescriptionId: true, updatedAt: true,
      },
    }),
    prisma.cantoneseAudioAsset.findMany({
      where: { status: 'APPROVED', assetStatus: 'READY', cosKey: { not: null } },
      orderBy: [{ lessonId: 'asc' }, { externalId: 'asc' }],
      select: { externalId: true, text: true, jyutping: true, lessonId: true, contentId: true, audioVersion: true, checksum: true, fileSize: true, updatedAt: true },
    }),
  ])

  return NextResponse.json({
    lessonContents,
    questions,
    audioAssets,
    statusFilter: 'APPROVED_ONLY',
  }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } })
}
