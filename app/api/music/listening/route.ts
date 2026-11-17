import { NextResponse } from 'next/server'
import { enforceApiRateLimit, requireRequestUser } from '@/lib/security'
import {
  getMusicListeningStats,
  MusicListeningError,
  normalizeMusicListeningEvents,
  recordMusicListeningEvents,
} from '@/lib/music-listening'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LISTENING_OWNER_HEADER = 'x-ecfc-listening-owner'

function errorResponse(error: MusicListeningError) {
  return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
}

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/music/listening:GET',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  return NextResponse.json({ ok: true, acknowledgedEventIds: [], rejectedEventIds: [], rejectedEvents: [], stats: await getMusicListeningStats(guard.user.id) }, {
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' },
  })
}

export async function POST(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const expectedOwner = request.headers.get(LISTENING_OWNER_HEADER)?.trim() || ''
  if (!expectedOwner) {
    return NextResponse.json({ ok: false, code: 'LISTENING_OWNER_REQUIRED', message: '听歌统计账号上下文缺失，请刷新后重试' }, { status: 400 })
  }
  if (expectedOwner !== guard.user.id) {
    return NextResponse.json({ ok: false, code: 'LISTENING_OWNER_MISMATCH', message: '听歌统计账号已变化，请刷新后重试' }, { status: 409 })
  }
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/music/listening:POST',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '听歌统计同步过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null) as { events?: unknown } | null
  try {
    const events = normalizeMusicListeningEvents(body?.events)
    const result = await recordMusicListeningEvents(guard.user.id, events)
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' },
    })
  } catch (error) {
    if (error instanceof MusicListeningError) return errorResponse(error)
    console.error('[music-listening.sync]', error)
    return NextResponse.json({ ok: false, code: 'LISTENING_SYNC_FAILED', message: '听歌统计同步失败，请稍后重试' }, { status: 500 })
  }
}
