import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const url = new URL(request.url)
  const limit = Math.min(30, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '15', 10) || 15))
  const cursor = url.searchParams.get('cursor')
  if (cursor && !/^[a-z0-9]{10,40}$/i.test(cursor)) {
    return NextResponse.json({ ok: false, code: 'INVALID_CURSOR' }, { status: 400, headers: NO_STORE })
  }
  const reviewOnly = url.searchParams.get('review') === '1'
  try {
    const rows = await prisma.cantonesePronunciationAssessment.findMany({
      where: { userId: guard.user.id, ...(reviewOnly ? { overallScore: { lt: 70 } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, contentId: true, assessmentMode: true, createdAt: true,
        expectedText: true, recognizedText: true, overallScore: true, pronunciationScore: true,
        toneScore: true, fluencyScore: true, completenessScore: true, confidence: true },
    })
    const items = rows.slice(0, limit)
    return NextResponse.json({ items, nextCursor: rows.length > limit ? items.at(-1)?.id : null,
      reviewCriterion: reviewOnly ? 'PROVIDER_OVERALL_SCORE_BELOW_70' : null }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, code: 'HISTORY_UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }
}
