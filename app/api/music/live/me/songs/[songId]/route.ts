import { NextResponse } from 'next/server'
import { buildPersonalSongAtlas, getPersonalLiveRows, PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ songId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const { songId } = await params
  const song = buildPersonalSongAtlas(await getPersonalLiveRows(guard.user.id)).find((item) => item.songId === songId)
  return NextResponse.json({ song: song || null }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}
