import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin } from '@/lib/security'
import { assistSuggestion, CANTONESE_STAGES, contentIdBase, exactApprovedMatch, suggestedContentType, suggestedStage } from '@/lib/cantonese-content-assist'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const title = body?.title === undefined || body?.title === null ? null : body.title
  const stageId = body?.stageId === undefined || body?.stageId === null ? null : body.stageId
  if (!text || text.length > 4000 || typeof title !== 'string' && title !== null
    || typeof title === 'string' && title.length > 255
    || typeof stageId !== 'string' && stageId !== null
    || stageId !== null && !CANTONESE_STAGES.includes(stageId as (typeof CANTONESE_STAGES)[number])) {
    return NextResponse.json({ ok: false, code: 'INVALID_ASSIST_INPUT' }, { status: 400, headers: NO_STORE })
  }

  const matches = await prisma.cantoneseLessonContent.findMany({
    where: { status: 'APPROVED', OR: [{ displayText: text }, { body: text }] },
    select: { externalId: true, displayText: true, body: true, jyutping: true, contentType: true,
      lessonId: true, stageId: true, requiresAudio: true, requiresSpeaking: true },
    orderBy: { externalId: 'asc' },
  })
  const exactMatch = exactApprovedMatch(text, matches)
  const recommendedStageId = suggestedStage(exactMatch?.contentType || suggestedContentType(text), exactMatch)
  const stage = suggestedStage(exactMatch?.contentType || suggestedContentType(text), exactMatch, stageId)
  const base = contentIdBase(text, stage)
  const [existingContent, existingAudio, latest] = await Promise.all([
    prisma.cantoneseLessonContent.findMany({ where: { externalId: { startsWith: base } }, select: { externalId: true } }),
    prisma.cantoneseAudioAsset.findMany({ where: { externalId: { startsWith: base } }, select: { externalId: true } }),
    prisma.cantoneseLessonContent.findFirst({ where: { stageId: stage }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } }),
  ])
  const usedIds = new Set([...existingContent, ...existingAudio].map((item) => item.externalId))
  const suggestion = assistSuggestion({ text, title, stageId, matches, usedIds, nextSortOrder: (latest?.sortOrder ?? -1) + 1 })
  if (!suggestion) return NextResponse.json({ ok: false, code: 'ID_SPACE_EXHAUSTED' }, { status: 409, headers: NO_STORE })
  return NextResponse.json({ suggestion: { ...suggestion, recommendedStageId }, requiresHumanReview: true }, { headers: NO_STORE })
}
