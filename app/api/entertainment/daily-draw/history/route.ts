import { NextResponse } from 'next/server'
import { getEntertainmentDailyDrawHistory } from '@/lib/entertainment'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parsePage(value: string | null) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

function parseLimit(value: string | null) {
  const limit = Number(value)
  return Number.isSafeInteger(limit) && limit > 0 ? Math.min(50, limit) : undefined
}

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/entertainment/daily-draw/history',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  }, '搜索请求过于频繁，请稍后再试')
  if (limited) return limited

  const params = new URL(request.url).searchParams
  const query = sanitizeText(params.get('q'), 120)
  const dateKey = sanitizeText(params.get('date'), 32)

  try {
    const data = await getEntertainmentDailyDrawHistory(guard.user.id, parsePage(params.get('page')), {
      query,
      dateKey: dateKey || null,
      pageSize: parseLimit(params.get('limit')),
    })
    return NextResponse.json(
      { ok: true, data, error: null },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } },
    )
  } catch (error) {
    console.error('[entertainment.dailyDraw.history.search]', error)
    return NextResponse.json(
      { ok: false, data: null, error: '历史处方搜索暂时不可用，请稍后再试' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    )
  }
}
