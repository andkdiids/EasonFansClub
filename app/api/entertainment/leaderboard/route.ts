import { NextResponse } from 'next/server'
import { getEntertainmentLeaderboard, EntertainmentLeaderboardError } from '@/lib/entertainment-leaderboard'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function ok<T>(data: T) {
  return NextResponse.json(
    { ok: true, data, error: null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json(
    { ok: false, data: null, error: message, code: code || (status >= 500 ? 'SERVICE_UNAVAILABLE' : 'INVALID_LEADERBOARD_REQUEST') },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return errorResponse('请先登录', guard.response.status, 'UNAUTHENTICATED')

  const params = new URL(request.url).searchParams
  try {
    return ok(await getEntertainmentLeaderboard({
      gameKey: params.get('game') || params.get('gameKey'),
      mode: params.get('mode') || undefined,
      period: params.get('range') ? undefined : params.get('period') || undefined,
      range: params.get('range') || undefined,
      date: params.get('date') || undefined,
      userId: guard.user.id,
      limit: 10,
    }))
  } catch (caught) {
    if (caught instanceof EntertainmentLeaderboardError) {
      return errorResponse(caught.message, caught.status, caught.code)
    }
    console.error('[entertainment.leaderboard]', caught)
    return errorResponse('排行榜加载失败，请稍后重试。', 500)
  }
}
