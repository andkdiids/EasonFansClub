import type { SessionUser } from '@/lib/auth'
import { toPublicMediaUrl } from '@/lib/media-url'

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
    url = new URL(value, requestOrigin || 'https://ecfc.invalid')
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
  const playbackAvailable = fullPlayback || Boolean(toPublicMediaUrl(source.previewUrl))
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

export type AudioProbeResult = {
  reachable: boolean
  status: number | null
  contentType: string | null
}

// Probe a resolved audio URL server-side so we can tell the client precisely
// whether the file is missing (404), the link expired/forbidden (403/401), or
// the storage backend is down (5xx/network). The browser's <audio> element only
// surfaces a generic MEDIA_ERR_SRC_NOT_SUPPORTED, so this is the only reliable
// way to separate "file not found" from "address expired" from "service down".
export async function probeAudioUrl(url: string, timeoutMs = 8000): Promise<AudioProbeResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { reachable: false, status: null, contentType: null }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: '*/*' },
    })
    return {
      reachable: true,
      status: response.status,
      contentType: response.headers.get('content-type'),
    }
  } catch {
    return { reachable: false, status: null, contentType: null }
  } finally {
    clearTimeout(timer)
  }
}
