import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canPlayFullMusic, type MusicPlaybackResponse } from '@/lib/music-playback'
import { prisma } from '@/lib/prisma'
import { createGuessSongSignedUrl, guessSongObjectExists } from '@/lib/guess-song-storage'

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

  if (!song) return NextResponse.json({ ok: false, code: 'SONG_NOT_FOUND', message: '歌曲不存在' }, { status: 404 })

  // Authentication failure must fail closed for the private source. Public
  // visitors still receive the existing 60-second preview when available.
  const user = await getCurrentUser().catch((error) => {
    console.warn('[music-playback.auth]', error)
    return null
  })

  let location = song.previewUrl
  let isFullPlayback = false
  if (canPlayFullMusic(user) && song.sourceAudioPath) {
    try {
      // Check the private object before signing it. A missing full source must
      // fall back to the existing public preview instead of returning a dead
      // signed URL.
      if (await guessSongObjectExists(song.sourceAudioPath)) {
        // The source object is private. A short-lived signed URL is only put in
        // the JSON response after the server has checked the current user.
        location = await createGuessSongSignedUrl(song.sourceAudioPath, 3600)
        isFullPlayback = true
      }
    } catch (error) {
      console.error('[music-playback.source-url]', error)
      // A full-source failure must not take down the existing public preview.
      location = song.previewUrl
      isFullPlayback = false
      if (!location) return NextResponse.json({ ok: false, code: 'FULL_AUDIO_UNAVAILABLE', message: '完整音频暂时不可用' }, { status: 503 })
    }
  }

  if (!location) return NextResponse.json({ ok: false, code: 'AUDIO_NOT_CONFIGURED', message: '暂无可播放音频' }, { status: 404 })

  const response: MusicPlaybackResponse = {
    ok: true,
    url: location,
    isFullPlayback,
  }

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
    },
  })
}
