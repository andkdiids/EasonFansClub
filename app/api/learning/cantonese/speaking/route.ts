import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' }

export async function GET(request: Request) {
  const lessonId = new URL(request.url).searchParams.get('lessonId')
  if (lessonId && !/^lesson-0[1-6]$/.test(lessonId)) {
    return NextResponse.json({ ok: false, code: 'INVALID_LESSON' }, { status: 400 })
  }
  const content = await prisma.cantoneseLessonContent.findMany({
    where: { status: 'APPROVED', requiresSpeaking: true, requiresAudio: true, ...(lessonId ? { lessonId } : {}) },
    orderBy: [{ lessonId: 'asc' }, { sortOrder: 'asc' }, { stageId: 'asc' }, { stepId: 'asc' }, { externalId: 'asc' }],
    select: { externalId: true, lessonId: true, stageId: true, stepId: true, title: true,
      displayText: true, jyutping: true, audioId: true, sortOrder: true },
  })
  const audioIds = [...new Set(content.map((item) => item.audioId).filter((id): id is string => Boolean(id)))]
  const audio = audioIds.length ? await prisma.cantoneseAudioAsset.findMany({
    where: { externalId: { in: audioIds }, status: 'APPROVED', assetStatus: 'READY', cosKey: { not: null }, checksum: { not: null }, fileSize: { not: null } },
    select: { externalId: true, cosKey: true, checksum: true, fileSize: true },
  }) : []
  const readyAudioIds = new Set(audio.filter((item) => Boolean(item.cosKey && item.checksum && item.fileSize)).map((item) => item.externalId))
  const items = content.filter((item) => item.displayText?.trim() && item.audioId && readyAudioIds.has(item.audioId))
    .map(({ externalId, displayText, ...item }) => ({ ...item, contentId: externalId, displayText: displayText!.trim() }))
  return NextResponse.json({ items, code: items.length ? 'OK' : 'EMPTY_CONTENT', status: 'APPROVED_ONLY' }, { headers: NO_STORE })
}
