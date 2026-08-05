import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canAnalyzeMusicPlaybackUrl, canPlayFullMusic, probeAudioUrl, type MusicPlaybackResponse } from '@/lib/music-playback'
import { prisma } from '@/lib/prisma'
import { createGuessSongSignedUrl, guessSongObjectExists } from '@/lib/guess-song-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ songId: string }> }

export async function GET(request: Request, context: RouteContext) {
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

  const previewOnly = new URL(request.url).searchParams.get('preview') === '1'
  let location = song.previewUrl
  let isFullPlayback = false
  if (!previewOnly && canPlayFullMusic(user) && song.sourceAudioPath) {
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

  // The public preview is handed straight to the browser. Without a server-side
  // probe the client cannot tell "file missing" from "link expired" from
  // "storage down" — all collapse into one generic media error. Probing here
  // lets us return a precise, actionable code. (Full-playback signed URLs are
  // already validated by guessSongObjectExists above, so they are not probed.)
  if (location === song.previewUrl) {
    const probe = await probeAudioUrl(location)
    if (!probe.reachable || (probe.status !== null && probe.status >= 500)) {
      return NextResponse.json({ ok: false, code: 'COS_ACCESS_FAILED', message: '音频服务暂时无法访问，请稍后重试' }, { status: 502 })
    }
    if (probe.status === 404 || probe.status === 410) {
      return NextResponse.json({ ok: false, code: 'AUDIO_NOT_FOUND', message: '音频文件不存在或已被移除' }, { status: 404 })
    }
    if (probe.status === 403 || probe.status === 401) {
      return NextResponse.json({ ok: false, code: 'AUDIO_EXPIRED', message: '音频地址已失效，请刷新页面后重试' }, { status: 403 })
    }
  }

  const response: MusicPlaybackResponse = {
    ok: true,
    url: location,
    isFullPlayback,
    canAnalyzeAudio: canAnalyzeMusicPlaybackUrl(location, request.url),
  }

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
    },
  })
}
