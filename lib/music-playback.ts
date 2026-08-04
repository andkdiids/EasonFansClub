import type { SessionUser } from '@/lib/auth'

export type MusicPlaybackSource = {
  id: string
  previewUrl?: string | null
  previewDuration?: number | null
  sourceAudioPath?: string | null
  sourceAudioDurationMs?: number | null
}

export type MusicPlaybackResponse = {
  ok: true
  url: string
  isFullPlayback: boolean
  canAnalyzeAudio: boolean
}

function normalizeAudioAnalysisHost(value: string) {
  const candidate = value.trim()
  if (!candidate) return null

  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
    return url.host.toLowerCase()
  } catch {
    return null
  }
}

function getAudioAnalysisCorsHosts() {
  return new Set(
    (process.env.AUDIO_ANALYSIS_CORS_HOSTS || '')
      .split(',')
      .map(normalizeAudioAnalysisHost)
      .filter((host): host is string => Boolean(host)),
  )
}

export function canAnalyzeMusicPlaybackUrl(value: string, requestOrigin?: string) {
  let url: URL
  try {
    url = new URL(value, requestOrigin || 'http://localhost')
  } catch {
    return false
  }

  if (requestOrigin) {
    try {
      if (url.origin === new URL(requestOrigin).origin) return true
    } catch {
      return false
    }
  }

  return getAudioAnalysisCorsHosts().has(url.host.toLowerCase())
}

export function canPlayFullMusic(user?: Pick<SessionUser, 'role' | 'canPlayFullMusic'> | null) {
  return user?.role === 'SUPER_ADMIN' || user?.canPlayFullMusic === true
}

export function getMusicPlaybackUrl(songId: string) {
  return `/api/music/songs/${encodeURIComponent(songId)}/playback`
}

export function resolveMusicPlayback(source: MusicPlaybackSource, user?: Pick<SessionUser, 'role' | 'canPlayFullMusic'> | null) {
  const fullPlayback = canPlayFullMusic(user) && Boolean(source.sourceAudioPath)
  const playbackAvailable = fullPlayback || Boolean(source.previewUrl)
  const previewDuration = Math.max(1, Math.min(60, source.previewDuration || 60))
  const fullDuration = source.sourceAudioDurationMs && source.sourceAudioDurationMs > 0
    ? Math.max(1, Math.ceil(source.sourceAudioDurationMs / 1000))
    : previewDuration

  return {
    songId: source.id,
    previewUrl: playbackAvailable ? getMusicPlaybackUrl(source.id) : '',
    previewDuration: fullPlayback ? fullDuration : previewDuration,
    isFullPlayback: fullPlayback,
  }
}
