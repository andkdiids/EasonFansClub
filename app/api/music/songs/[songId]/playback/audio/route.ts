import { NextResponse } from 'next/server'
import { canPlayFullMusic } from '@/lib/music-playback'
import { prisma } from '@/lib/prisma'
import { streamProtectedGuessSongAudio } from '@/lib/protected-audio'
import { resolveRequestAuth } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ songId: string }> }

async function handle(request: Request, context: RouteContext) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const user = auth.user
  if (!user) return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录' }, { status: 401 })
  if (!canPlayFullMusic(user)) {
    return NextResponse.json({ ok: false, code: 'FULL_PLAYBACK_FORBIDDEN', message: '当前账号没有完整音乐播放权限' }, { status: 403 })
  }

  const { songId } = await context.params
  const song = await prisma.musicSong.findFirst({
    where: {
      id: songId,
      MusicAlbum: { status: 'PUBLISHED' },
    },
    select: { sourceAudioPath: true },
  })
  if (!song?.sourceAudioPath) {
    return NextResponse.json({ ok: false, code: 'FULL_AUDIO_UNAVAILABLE', message: '完整音频暂时不可用' }, { status: 404 })
  }

  return streamProtectedGuessSongAudio(request, song.sourceAudioPath)
}

export async function GET(request: Request, context: RouteContext) {
  return handle(request, context)
}

export async function HEAD(request: Request, context: RouteContext) {
  return handle(request, context)
}
