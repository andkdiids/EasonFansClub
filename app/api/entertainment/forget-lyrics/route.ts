import { NextResponse } from 'next/server'
import { getForgetLyricsData, parseForgetLyricsLimit, type ForgetLyricsRange, type ForgetLyricsSort } from '@/lib/forget-lyrics'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseRange(value: string | null): ForgetLyricsRange {
  return value === '7d' || value === 'all' ? value : 'today'
}

function parseSort(value: string | null): ForgetLyricsSort {
  return value === 'most' ? 'most' : 'recent'
}

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  const range = parseRange(params.get('range'))
  const sort = parseSort(params.get('sort'))
  const home = params.get('surface') === 'home'
  const limit = parseForgetLyricsLimit(params.get('limit'))

  try {
    const data = await getForgetLyricsData({
      userId: guard.user.id,
      viewer: guard.user,
      range,
      sort,
      limit,
      home,
    })
    return NextResponse.json({ ok: true, data }, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        Vary: 'Cookie',
      },
    })
  } catch (error) {
    console.error('[api/entertainment/forget-lyrics]', error)
    return NextResponse.json({ ok: false, code: 'FORGET_LYRICS_UNAVAILABLE', message: '忘记歌词暂时无法读取，请稍后重试' }, { status: 503 })
  }
}
