import type { SessionUser } from '@/lib/auth'

export type MusicPlaybackSource = {
  id: string
  previewUrl?: string | null
  previewDuration?: number | null
  sourceAudioDurationMs?: number | null
}

export function canPlayFullMusic(user?: Pick<SessionUser, 'role' | 'canPlayFullMusic'> | null) {
  return user?.role === 'SUPER_ADMIN' || user?.canPlayFullMusic === true
}

export function getMusicPlaybackUrl(songId: string) {
  return `/api/music/songs/${encodeURIComponent(songId)}/playback`
}

export function resolveMusicPlayback(source: MusicPlaybackSource, user?: Pick<SessionUser, 'role' | 'canPlayFullMusic'> | null) {
  const fullPlayback = canPlayFullMusic(user) && Boolean(source.sourceAudioDurationMs && source.sourceAudioDurationMs > 0)
  const playbackAvailable = fullPlayback || Boolean(source.previewUrl)
  const previewDuration = Math.max(1, Math.min(60, source.previewDuration || 60))
  const fullDuration = source.sourceAudioDurationMs && source.sourceAudioDurationMs > 0
    ? Math.max(1, Math.ceil(source.sourceAudioDurationMs / 1000))
    : previewDuration

  return {
    previewUrl: playbackAvailable ? getMusicPlaybackUrl(source.id) : '',
    previewDuration: fullPlayback ? fullDuration : previewDuration,
    isFullPlayback: fullPlayback,
  }
}
