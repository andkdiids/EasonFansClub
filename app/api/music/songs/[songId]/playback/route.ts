import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canPlayFullMusic } from '@/lib/music-playback'
import { prisma } from '@/lib/prisma'
import { createGuessSongSignedUrl } from '@/lib/guess-song-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ songId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { songId } = await context.params
  const song = await prisma.musicSong.findFirst({
    where: {
      id: songId,
      MusicAlbum: { status: 'PUBLISHED' },
    },
    select: {
      previewUrl: true,
      sourceAudioPath: true,
    },
  })

  if (!song) return NextResponse.json({ message: '歌曲不存在' }, { status: 404 })

  // Authentication failure must fail closed for the private source. Public
  // visitors still receive the existing 60-second preview when available.
  const user = await getCurrentUser().catch((error) => {
    console.warn('[music-playback.auth]', error)
    return null
  })

  let location = song.previewUrl
  if (canPlayFullMusic(user) && song.sourceAudioPath) {
    try {
      // The source object is private. A short-lived signed URL is only put in
      // the redirect response after the server has checked the current user.
      location = await createGuessSongSignedUrl(song.sourceAudioPath, 3600)
    } catch (error) {
      console.error('[music-playback.source-url]', error)
      return NextResponse.json({ message: '完整音频暂时不可用' }, { status: 503 })
    }
  }

  if (!location) return NextResponse.json({ message: '暂无可播放音频' }, { status: 404 })

  return NextResponse.redirect(location, {
    status: 307,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
    },
  })
}
