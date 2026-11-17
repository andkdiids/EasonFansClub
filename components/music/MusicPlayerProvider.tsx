'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { usePathname } from 'next/navigation'
import { MusicMiniPlayer } from '@/components/music/MusicMiniPlayer'
import type { MusicPlaybackResponse } from '@/lib/music-playback'
import {
  appendBrowserListeningEvent,
  BROWSER_LISTENING_MAX_UPLOAD_EVENTS,
  consumeBrowserListeningSegment,
  createBrowserAudioElement,
  getNextBrowserQueueTrack,
  getPreviousBrowserQueueTrack,
  readBrowserListeningEvents,
  readBrowserRejectedListeningEvents,
  rebuildBrowserAudioElement,
  removeBrowserAcknowledgedEvents,
  writeBrowserListeningEvents,
  writeBrowserRejectedListeningEvents,
  type BrowserListeningEvent,
  type BrowserRejectedListeningEvent,
  type BrowserListeningSegment,
  type BrowserRepeatMode,
} from '@/lib/music-browser-playback'
import type { AudioAnalysisMode, AudioAnalysisModeDetails } from '@/types/music-cassette'

export type MusicPreviewTrack = {
  id: string
  songId?: string
  title: string
  artist: string
  albumName?: string | null
  coverUrl?: string | null
  previewUrl: string
  previewDuration?: number | null
  isFullPlayback?: boolean
  canAnalyzeAudio?: boolean
}

type AudioAnalysis = {
  context: AudioContext
  source: MediaElementAudioSourceNode
  analyser: AnalyserNode
}

type PlaybackResolution = MusicPlaybackResponse & {
  playbackApiStatus: number | null
  responseHasUrl: boolean
}

class PlaybackRequestError extends Error {
  readonly status: number | null
  readonly responseHasUrl: boolean
  readonly code: string | null

  constructor(message: string, status: number | null, responseHasUrl: boolean, code: string | null = null) {
    super(message)
    this.name = 'PlaybackRequestError'
    this.status = status
    this.responseHasUrl = responseHasUrl
    this.code = code
  }
}

function errorName(error: unknown) {
  return error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
    ? error.name
    : null
}

function errorMessage(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : error instanceof Error ? error.message : null
  return message?.replace(/https?:\/\/[^\s]+/gi, '[redacted-url]') || null
}

function logPlaybackState(
  event: string,
  track: MusicPreviewTrack,
  audio: HTMLAudioElement | null,
  details: {
    playbackApiStatus?: number | null
    responseHasUrl?: boolean | null
    isFullPlayback?: boolean | null
    error?: unknown
  } = {},
) {
  console.warn(`[EasMusic playback] ${event}`, {
    trackId: track.id,
    trackTitle: track.title,
    songId: track.songId || track.id,
    playbackApiStatus: details.playbackApiStatus ?? null,
    playbackResponseHasUrl: details.responseHasUrl ?? null,
    isFullPlayback: details.isFullPlayback ?? null,
    audioCurrentSrcExists: Boolean(audio?.currentSrc),
    audioReadyState: audio?.readyState ?? null,
    audioNetworkState: audio?.networkState ?? null,
    audioErrorCode: audio?.error?.code ?? null,
    errorName: errorName(details.error),
    errorMessage: errorMessage(details.error),
  })
}

function isMusicPlaybackEndpoint(value: string) {
  try {
    const url = new URL(value, window.location.href)
    return url.origin === window.location.origin
      && /^\/api\/music\/songs\/[^/]+\/playback$/.test(url.pathname)
  } catch {
    return false
  }
}

function getPlaybackErrorMessage(error: unknown, audio: HTMLAudioElement | null) {
  if (error instanceof PlaybackRequestError) {
    switch (error.code) {
      case 'SONG_NOT_FOUND':
      case 'AUDIO_NOT_FOUND':
        return '音频文件不存在或已被移除。'
      case 'AUDIO_EXPIRED':
        return '音频地址已失效，请刷新页面后重试。'
      case 'COS_ACCESS_FAILED':
        return '音频服务暂时无法访问，请稍后重试。'
      case 'FULL_AUDIO_UNAVAILABLE':
      case 'PLAYBACK_API_NETWORK_ERROR':
        return '音频加载失败，请检查网络后重试。'
      case 'PLAYBACK_API_INVALID_JSON':
      case 'PLAYBACK_API_CONTRACT_ERROR':
        return '播放服务异常，请稍后重试。'
      case 'AUDIO_NOT_CONFIGURED':
      case 'NO_PLAYBACK_URL':
        return '该歌曲暂未配置可播放音频。'
    }
    if (error.status === 404 || error.status === 410) return '音频文件不存在或已被移除。'
    if (error.status === 403 || error.status === 401) return '音频地址已失效，请刷新页面后重试。'
    if (error.status === null) return '音频加载失败，请检查网络后重试。'
  }

  switch (errorName(error)) {
    case 'NotAllowedError':
      return '浏览器暂未允许播放，请再次点击播放按钮。'
    case 'NotSupportedError':
      return '当前浏览器不支持该音频格式。'
    case 'AbortError':
      return '播放已取消，请重试。'
  }

  switch (audio?.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return '播放已取消，请重试。'
    case MediaError.MEDIA_ERR_NETWORK:
      return '音频加载失败，请检查网络后重试。'
    case MediaError.MEDIA_ERR_DECODE:
      return '当前音频格式不支持，浏览器无法解码该文件。'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      // A source-not-supported error can also mean a CORS/access problem when
      // the element was asked for cross-origin analysis, so phrase it broadly.
      return '当前音频无法加载：可能是格式不支持，或跨域访问受限。'
  }

  return '播放失败，请稍后重试。'
}

// A media element can only have one MediaElementSourceNode for its lifetime.
// Keeping this cache at module scope makes that invariant explicit even if a
// provider is mounted through a development-only Strict Mode pass.
const audioAnalysisCache = new WeakMap<HTMLAudioElement, AudioAnalysis>()

function getAudioContextConstructor() {
  return window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

function createAudioAnalysis(audio: HTMLAudioElement): AudioAnalysis | null {
  const cached = audioAnalysisCache.get(audio)
  if (cached) return cached

  const AudioContextClass = getAudioContextConstructor()
  if (!AudioContextClass) return null

  let context: AudioContext | null = null
  try {
    const createdContext = new AudioContextClass()
    context = createdContext
    const source = createdContext.createMediaElementSource(audio)
    const analyser = createdContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.65
    source.connect(analyser)
    analyser.connect(createdContext.destination)
    const analysis = { context: createdContext, source, analyser }
    audioAnalysisCache.set(audio, analysis)
    return analysis
  } catch {
    if (context) void context.close().catch(() => undefined)
    return null
  }
}

function disposeAudioAnalysis(audio: HTMLAudioElement, analysis: AudioAnalysis | null) {
  if (!analysis) return
  analysis.source.disconnect()
  analysis.analyser.disconnect()
  if (audioAnalysisCache.get(audio) === analysis) audioAnalysisCache.delete(audio)
  void analysis.context.close().catch(() => undefined)
}

type PlayerContextValue = {
  track: MusicPreviewTrack | null
  playing: boolean
  loading: boolean
  ended: boolean
  error: string | null
  muted: boolean
  elapsed: number
  duration: number
  audioRef: RefObject<HTMLAudioElement | null>
  analyserNode: AnalyserNode | null
  audioAnalysisMode: AudioAnalysisMode
  canAnalyzeAudio: boolean
  reportAudioAnalysisMode: (mode: AudioAnalysisMode, details?: AudioAnalysisModeDetails) => void
  prepareTrack: (track: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>
  playTrack: (track: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>
  pause: () => void
  eject: () => void
  toggleMuted: () => void
  playInsertionSound: () => void
  previous: () => Promise<void>
  next: () => Promise<void>
  seek: (seconds: number) => void
  repeatMode: BrowserRepeatMode
  cycleRepeatMode: () => void
}

type MiniPlayerPosition = { x: number; y: number }

const MINI_PLAYER_STORAGE_KEY = 'easmusic:mini-player-ui'

const MusicPlayerContext = createContext<PlayerContextValue | null>(null)

export function MusicPlayerProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname()
  const isImmersiveGameRoute = /^\/games\/[^/]+\/play(?:\/|$)/.test(pathname || '')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const analysisRef = useRef<AudioAnalysis | null>(null)
  const queueRef = useRef<MusicPreviewTrack[]>([])
  const playbackCacheRef = useRef(new Map<string, Promise<PlaybackResolution>>())
  const trackRef = useRef<MusicPreviewTrack | null>(null)
  const repeatModeRef = useRef<BrowserRepeatMode>('list')
  const autoAdvancedTrackRef = useRef<string | null>(null)
  const durationRef = useRef(60)
  const fullPlaybackRef = useRef(false)
  const prepareGenerationRef = useRef(0)
  const loadingTimeoutRef = useRef<number | null>(null)
  const loadingTimedOutRef = useRef(false)
  const audioAnalysisModeRef = useRef<AudioAnalysisMode>('idle')
  const canAnalyzeAudioRef = useRef(false)
  const audioBindingRef = useRef<{ audio: HTMLAudioElement; dispose: () => void } | null>(null)
  const bindAudioElementRef = useRef<((audio: HTMLAudioElement) => void) | null>(null)
  const listeningUserIdRef = useRef<string | null>(null)
  const listeningPendingRef = useRef<BrowserListeningEvent[]>([])
  const listeningSegmentRef = useRef<BrowserListeningSegment | null>(null)
  const listeningFlushTimerRef = useRef<number | null>(null)
  const listeningSyncRef = useRef<Promise<void> | null>(null)
  const listeningAuthRequestRef = useRef<Promise<string | null> | null>(null)
  const resolveListeningUserRef = useRef<() => Promise<string | null>>(async () => null)
  const playTrackRef = useRef<(nextTrack: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>>(async () => undefined)
  const flushListeningRef = useRef<(discard?: boolean) => void>(() => undefined)
  const beginListeningRef = useRef<(audio: HTMLAudioElement) => void>(() => undefined)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [audioAnalysisMode, setAudioAnalysisMode] = useState<AudioAnalysisMode>('idle')
  const [canAnalyzeAudio, setCanAnalyzeAudio] = useState(false)
  const [track, setTrack] = useState<MusicPreviewTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(60)
  const [repeatMode, setRepeatMode] = useState<BrowserRepeatMode>('list')
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [miniPlayerPosition, setMiniPlayerPosition] = useState<MiniPlayerPosition | null>(null)
  const [miniPlayerHydrated, setMiniPlayerHydrated] = useState(false)

  trackRef.current = track

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(MINI_PLAYER_STORAGE_KEY) || 'null') as {
        collapsed?: unknown
        x?: unknown
        y?: unknown
      } | null
      if (typeof stored?.collapsed === 'boolean') setCollapsed(stored.collapsed)
      if (typeof stored?.x === 'number' && Number.isFinite(stored.x) && typeof stored?.y === 'number' && Number.isFinite(stored.y)) {
        setMiniPlayerPosition({ x: stored.x, y: stored.y })
      }
    } catch {
      // The player keeps its default position when localStorage is unavailable.
    } finally {
      setMiniPlayerHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!miniPlayerHydrated) return
    try {
      window.localStorage.setItem(MINI_PLAYER_STORAGE_KEY, JSON.stringify({
        collapsed,
        x: miniPlayerPosition?.x ?? null,
        y: miniPlayerPosition?.y ?? null,
      }))
    } catch {
      // Position persistence is optional and must not affect playback.
    }
  }, [collapsed, miniPlayerHydrated, miniPlayerPosition])

  useEffect(() => {
    void resolveListeningUserRef.current()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void resolveListeningUserRef.current()
      else flushListeningRef.current(true)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  const reportAudioAnalysisMode = useCallback((mode: AudioAnalysisMode, details: AudioAnalysisModeDetails = {}) => {
    const previousMode = audioAnalysisModeRef.current
    if (previousMode === mode) return
    audioAnalysisModeRef.current = mode
    setAudioAnalysisMode(mode)

    if (process.env.NODE_ENV !== 'production') {
      const hasFrequencyData = details.hasFrequencyData
        ?? (details.analyserAllZero ? false : mode === 'real')
      console.info('[Waveform]', {
        mode,
        analyserAvailable: Boolean(analysisRef.current?.analyser),
        audioContextState: analysisRef.current?.context.state ?? null,
        hasFrequencyData,
        canAnalyzeAudio: details.canAnalyzeAudio ?? canAnalyzeAudioRef.current,
      })
      if (mode === 'fallback') console.info('[Waveform] fallback activated')
      if (mode === 'real') console.info('[Waveform] real analyser')
    }
  }, [])

  const resetAudioAnalysisMode = useCallback(() => {
    reportAudioAnalysisMode('idle')
  }, [reportAudioAnalysisMode])

  function clearLoadingTimeout() {
    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = null
    }
  }

  function startLoadingTimeout() {
    clearLoadingTimeout()
    loadingTimedOutRef.current = false
    loadingTimeoutRef.current = window.setTimeout(() => {
      loadingTimedOutRef.current = true
      audioRef.current?.pause()
      setLoading(false)
      setPlaying(false)
      setError('音频加载失败，请检查网络后重试。')
      const currentTrack = trackRef.current
      if (currentTrack) logPlaybackState('audio-load-timeout', currentTrack, audioRef.current)
    }, 15_000)
  }

  function clearListeningFlushTimer() {
    if (listeningFlushTimerRef.current !== null) {
      window.clearInterval(listeningFlushTimerRef.current)
      listeningFlushTimerRef.current = null
    }
  }

  function getListeningStorage() {
    try {
      return window.localStorage
    } catch {
      return null
    }
  }

  function syncPendingListening(userId: string) {
    if (listeningSyncRef.current) return
    const storage = getListeningStorage()
    const pending = listeningUserIdRef.current === userId && listeningPendingRef.current.length
      ? listeningPendingRef.current
      : storage
        ? readBrowserListeningEvents(storage, userId)
        : listeningPendingRef.current
    if (!pending.length) return
    const batch = pending.slice(0, BROWSER_LISTENING_MAX_UPLOAD_EVENTS)
    let continueSync = false
    const request = (async () => {
      try {
        const response = await fetch('/api/music/listening', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-ECFC-Listening-Owner': userId,
          },
          body: JSON.stringify({ events: batch }),
        })
        if (!response.ok) {
          if (response.status === 409) void resolveListeningUserRef.current()
          return
        }
        const payload: unknown = await response.json()
        if (!payload || typeof payload !== 'object') return
        const body = payload as {
          acknowledgedEventIds?: unknown
          rejectedEventIds?: unknown
          rejectedEvents?: unknown
        }
        const acknowledgedEventIds = Array.isArray(body.acknowledgedEventIds)
          ? body.acknowledgedEventIds.filter((id): id is string => typeof id === 'string')
          : []
        const rejectedEventIds = Array.isArray(body.rejectedEventIds)
          ? body.rejectedEventIds.filter((id): id is string => typeof id === 'string')
          : []
        if (!acknowledgedEventIds.length && !rejectedEventIds.length) return
        const current = listeningUserIdRef.current === userId && listeningPendingRef.current.length
          ? listeningPendingRef.current
          : storage
            ? readBrowserListeningEvents(storage, userId)
            : listeningPendingRef.current
        const rejectedDetails = Array.isArray(body.rejectedEvents)
          ? body.rejectedEvents.filter((item): item is { eventId: string; reason: string } => Boolean(item)
            && typeof item === 'object'
            && 'eventId' in item
            && typeof item.eventId === 'string'
            && 'reason' in item
            && typeof item.reason === 'string')
          : []
        const rejectedById = new Map(rejectedDetails.map((item) => [item.eventId, item.reason]))
        const rejectedEvents: BrowserRejectedListeningEvent[] = current
          .filter((event: BrowserListeningEvent) => rejectedEventIds.includes(event.eventId))
          .map((event: BrowserListeningEvent) => ({ ...event, reason: rejectedById.get(event.eventId) || 'REJECTED' }))
        let rejectedArchiveReady = rejectedEventIds.length === 0
        if (rejectedEventIds.length && storage) {
          const previousRejected = readBrowserRejectedListeningEvents(storage, userId)
          const previousRejectedIds = new Set(previousRejected.map((event) => event.eventId))
          const alreadyArchived = rejectedEvents.length === rejectedEventIds.length
            && rejectedEvents.every((event) => previousRejectedIds.has(event.eventId))
          if (alreadyArchived) {
            rejectedArchiveReady = true
          } else if (rejectedEvents.length === rejectedEventIds.length) {
            const mergedRejected = [...previousRejected]
            for (const event of rejectedEvents) {
              if (!mergedRejected.some((item) => item.eventId === event.eventId)) mergedRejected.push(event)
            }
            rejectedArchiveReady = writeBrowserRejectedListeningEvents(storage, userId, mergedRejected)
          }
        }
        const acknowledgedToRemove = acknowledgedEventIds.filter((eventId) => !rejectedEventIds.includes(eventId))
        const rejectedToRemove = rejectedArchiveReady ? rejectedEventIds : []
        const remaining = removeBrowserAcknowledgedEvents(current, acknowledgedToRemove, rejectedToRemove)
        const persisted = storage ? writeBrowserListeningEvents(storage, userId, remaining) : false
        if (listeningUserIdRef.current === userId) {
          listeningPendingRef.current = persisted ? remaining : current
        }
        continueSync = persisted && rejectedArchiveReady && remaining.length > 0
      } catch {
        // Keep the account-scoped queue for the next authenticated attempt.
      }
    })()
    listeningSyncRef.current = request
    void request.finally(() => {
      if (listeningSyncRef.current === request) {
        listeningSyncRef.current = null
        if (continueSync && listeningUserIdRef.current === userId) syncPendingListening(userId)
      }
    })
  }

  function appendListeningEvents(userId: string, events: readonly BrowserListeningEvent[]) {
    if (!events.length) return
    const storage = getListeningStorage()
    let pending = listeningUserIdRef.current === userId && listeningPendingRef.current.length
      ? listeningPendingRef.current
      : storage ? readBrowserListeningEvents(storage, userId) : []
    for (const event of events) pending = appendBrowserListeningEvent(pending, event)
    if (storage) writeBrowserListeningEvents(storage, userId, pending)
    if (listeningUserIdRef.current === userId) listeningPendingRef.current = pending
    syncPendingListening(userId)
  }

  function flushListeningSegment(discard = false) {
    const segment = listeningSegmentRef.current
    if (!segment) {
      if (discard) clearListeningFlushTimer()
      return
    }
    const consumed = consumeBrowserListeningSegment(segment, performance.now())
    appendListeningEvents(segment.userId, consumed.events)
    listeningSegmentRef.current = discard ? null : consumed.segment
    if (discard) clearListeningFlushTimer()
  }

  function beginListeningSegment(audio: HTMLAudioElement) {
    const userId = listeningUserIdRef.current
    if (!userId || audio !== audioRef.current || audio.paused) return
    const existing = listeningSegmentRef.current
    if (existing?.userId === userId) return
    if (existing) flushListeningSegment(true)
    const nowWallMs = Date.now()
    listeningSegmentRef.current = {
      userId,
      startedAtMs: nowWallMs,
      cursorAtMs: nowWallMs,
      cursorPerfMs: performance.now(),
    }
    clearListeningFlushTimer()
    listeningFlushTimerRef.current = window.setInterval(() => flushListeningRef.current(), 5_000)
  }

  async function resolveListeningUser() {
    if (listeningAuthRequestRef.current) return listeningAuthRequestRef.current
    const request = (async () => {
      let response: Response
      try {
        response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
      } catch {
        return listeningUserIdRef.current
      }
      if (!response.ok) return listeningUserIdRef.current
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return listeningUserIdRef.current
      }
      if (!payload || typeof payload !== 'object' || !('user' in payload)) return listeningUserIdRef.current
      const user = (payload as { user?: unknown }).user
      const nextUserId = user && typeof user === 'object' && 'id' in user && typeof user.id === 'string'
        ? user.id
        : null
      const previousUserId = listeningUserIdRef.current
      if (previousUserId !== nextUserId) {
        if (listeningSegmentRef.current?.userId === previousUserId && previousUserId) flushListeningSegment(true)
        else {
          listeningSegmentRef.current = null
          clearListeningFlushTimer()
        }
        listeningUserIdRef.current = nextUserId
        const storage = getListeningStorage()
        listeningPendingRef.current = nextUserId && storage
          ? readBrowserListeningEvents(storage, nextUserId)
          : []
      }
      if (nextUserId) {
        syncPendingListening(nextUserId)
        const audio = audioRef.current
        if (audio && !audio.paused) beginListeningSegment(audio)
      }
      return nextUserId
    })()
    listeningAuthRequestRef.current = request
    void request.finally(() => {
      if (listeningAuthRequestRef.current === request) listeningAuthRequestRef.current = null
    })
    return request
  }

  resolveListeningUserRef.current = resolveListeningUser

  async function requestPlayback(nextTrack: MusicPreviewTrack): Promise<PlaybackResolution> {
    if (!nextTrack.previewUrl) {
      throw new PlaybackRequestError('NO_PLAYBACK_URL', 404, false)
    }

    if (!isMusicPlaybackEndpoint(nextTrack.previewUrl)) {
      return {
        ok: true,
        url: nextTrack.previewUrl,
        isFullPlayback: nextTrack.isFullPlayback === true,
        canAnalyzeAudio: nextTrack.canAnalyzeAudio === true,
        playbackApiStatus: null,
        responseHasUrl: true,
      }
    }

    const cached = playbackCacheRef.current.get(nextTrack.previewUrl)
    if (cached) return cached

    const request = (async () => {
      let response: Response
      try {
        response = await fetch(nextTrack.previewUrl, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
      } catch (fetchError) {
        logPlaybackState('playback-api-network-error', nextTrack, audioRef.current, { error: fetchError })
        throw new PlaybackRequestError('PLAYBACK_API_NETWORK_ERROR', null, false, 'PLAYBACK_API_NETWORK_ERROR')
      }

      let payload: unknown = null
      try {
        payload = await response.json()
      } catch (parseError) {
        logPlaybackState('playback-api-invalid-json', nextTrack, audioRef.current, {
          playbackApiStatus: response.status,
          error: parseError,
        })
        throw new PlaybackRequestError('PLAYBACK_API_INVALID_JSON', response.status, false, 'PLAYBACK_API_INVALID_JSON')
      }

      const body = payload && typeof payload === 'object'
        ? payload as Partial<MusicPlaybackResponse> & { code?: unknown; message?: unknown }
        : null
      const responseHasUrl = typeof body?.url === 'string' && body.url.length > 0
      const isFullPlayback = typeof body?.isFullPlayback === 'boolean' ? body.isFullPlayback : null
      const canAnalyzeAudio = typeof body?.canAnalyzeAudio === 'boolean' ? body.canAnalyzeAudio : null
      logPlaybackState('playback-api-response', nextTrack, audioRef.current, {
        playbackApiStatus: response.status,
        responseHasUrl,
        isFullPlayback,
      })

      if (!response.ok) {
        throw new PlaybackRequestError(
          typeof body?.message === 'string' ? body.message : `PLAYBACK_API_${response.status}`,
          response.status,
          responseHasUrl,
          typeof body?.code === 'string' ? body.code : null,
        )
      }
      if (body?.ok !== true || !responseHasUrl || typeof isFullPlayback !== 'boolean' || typeof canAnalyzeAudio !== 'boolean') {
        throw new PlaybackRequestError('PLAYBACK_API_CONTRACT_ERROR', response.status, responseHasUrl, 'PLAYBACK_API_CONTRACT_ERROR')
      }

      return {
        ok: true as const,
        url: body.url as string,
        isFullPlayback,
        canAnalyzeAudio,
        playbackApiStatus: response.status,
        responseHasUrl,
      }
    })()

    playbackCacheRef.current.set(nextTrack.previewUrl, request)
    try {
      const resolution = await request
      if (playbackCacheRef.current.get(nextTrack.previewUrl) === request) {
        playbackCacheRef.current.delete(nextTrack.previewUrl)
      }
      return resolution
    } catch (requestError) {
      playbackCacheRef.current.delete(nextTrack.previewUrl)
      throw requestError
    }
  }

  function prepareAudioSource(currentAudio: HTMLAudioElement, url: string, canAnalyzeAudio: boolean) {
    let sameOrigin = false
    try {
      sameOrigin = new URL(url, window.location.href).origin === window.location.origin
    } catch {
      sameOrigin = false
    }

    const shouldAnalyzeAudio = sameOrigin || canAnalyzeAudio
    canAnalyzeAudioRef.current = shouldAnalyzeAudio
    setCanAnalyzeAudio(shouldAnalyzeAudio)
    let audio = currentAudio
    if (!shouldAnalyzeAudio) {
      const previousAnalysis = analysisRef.current || audioAnalysisCache.get(audio) || null
      if (previousAnalysis) {
        audio = rebuildBrowserAudioElement(
          audio,
          createBrowserAudioElement,
          (oldAudio: HTMLAudioElement) => {
            if (audioBindingRef.current?.audio === oldAudio) {
              audioBindingRef.current.dispose()
              audioBindingRef.current = null
            }
            disposeAudioAnalysis(oldAudio, previousAnalysis)
          },
          (nextAudio: HTMLAudioElement) => bindAudioElementRef.current?.(nextAudio),
        )
        audioRef.current = audio
        analysisRef.current = null
        setAnalyserNode(null)
      }
    }
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    resetAudioAnalysisMode()

    if (shouldAnalyzeAudio) {
      audio.crossOrigin = 'anonymous'
      const analysis = createAudioAnalysis(audio)
      analysisRef.current = analysis
      setAnalyserNode(analysis?.analyser || null)
    } else {
      audio.removeAttribute('crossorigin')
      analysisRef.current = null
      setAnalyserNode(null)
    }
    return audio
  }

  function resumeAudioContext() {
    const context = analysisRef.current?.context
    if (context && context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }
  }

  function primeAudioAnalysisForGesture(audio: HTMLAudioElement) {
    audio.crossOrigin = 'anonymous'
    const analysis = createAudioAnalysis(audio)
    if (analysis) {
      analysisRef.current = analysis
      setAnalyserNode(analysis.analyser)
      void analysis.context.resume().catch(() => undefined)
    }
  }

  function stop(resetTrack = false) {
    prepareGenerationRef.current += 1
    clearLoadingTimeout()
    flushListeningSegment(true)
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    resetAudioAnalysisMode()
    canAnalyzeAudioRef.current = false
    setCanAnalyzeAudio(false)
    fullPlaybackRef.current = false
    setPlaying(false)
    setLoading(false)
    setEnded(false)
    setError(null)
    setElapsed(0)
    if (resetTrack) setTrack(null)
  }

  flushListeningRef.current = flushListeningSegment
  beginListeningRef.current = beginListeningSegment

  useEffect(() => {
    const bindAudioElement = (audio: HTMLAudioElement) => {
      const advanceQueue = () => {
        const currentTrack = trackRef.current
        if (currentTrack?.id && autoAdvancedTrackRef.current === currentTrack.id) return
        const target = currentTrack
          ? getNextBrowserQueueTrack(queueRef.current, currentTrack.id, repeatModeRef.current)
          : null
        if (target) {
          autoAdvancedTrackRef.current = currentTrack?.id || null
          void playTrackRef.current(target, queueRef.current)
        }
      }
      const onTimeUpdate = () => {
        if (audio !== audioRef.current) return
        const cappedTime = fullPlaybackRef.current ? audio.currentTime : Math.min(audio.currentTime, durationRef.current)
        setElapsed(cappedTime)
        if (!fullPlaybackRef.current && audio.currentTime >= durationRef.current) {
          audio.pause()
          audio.currentTime = durationRef.current
          setEnded(true)
          advanceQueue()
        }
      }
      const onLoadedMetadata = () => {
        if (audio !== audioRef.current || !fullPlaybackRef.current || !Number.isFinite(audio.duration) || audio.duration <= 0) return
        durationRef.current = audio.duration
        setDuration(audio.duration)
      }
      const onPlaying = () => {
        if (audio !== audioRef.current) return
        clearLoadingTimeout()
        setPlaying(true)
        setLoading(false)
        setEnded(false)
        setError(null)
        autoAdvancedTrackRef.current = null
        beginListeningRef.current(audio)
      }
      const onPause = () => {
        if (audio !== audioRef.current) return
        flushListeningRef.current(true)
        setPlaying(false)
        reportAudioAnalysisMode('idle')
      }
      const onEnded = () => {
        if (audio !== audioRef.current) return
        flushListeningRef.current(true)
        setElapsed(fullPlaybackRef.current && Number.isFinite(audio.duration) ? audio.duration : durationRef.current)
        setPlaying(false)
        setEnded(true)
        reportAudioAnalysisMode('idle')
        advanceQueue()
      }
      const onError = () => {
        if (audio !== audioRef.current) return
        flushListeningRef.current(true)
        clearLoadingTimeout()
        setLoading(false)
        setPlaying(false)
        reportAudioAnalysisMode('idle')
        const currentTrack = trackRef.current
        const mediaError = audio.error?.code === 1
          ? new DOMException('Playback was aborted', 'AbortError')
          : audio.error?.code === 4
            ? new DOMException('The audio source is not supported', 'NotSupportedError')
            : undefined
        setError(getPlaybackErrorMessage(mediaError, audio))
        if (currentTrack) logPlaybackState('audio-error', currentTrack, audio, { error: mediaError })
      }
      const onPauseAll = () => {
        if (audio === audioRef.current) audio.pause()
      }
      audio.addEventListener('timeupdate', onTimeUpdate)
      audio.addEventListener('loadedmetadata', onLoadedMetadata)
      audio.addEventListener('playing', onPlaying)
      audio.addEventListener('pause', onPause)
      audio.addEventListener('ended', onEnded)
      audio.addEventListener('error', onError)
      window.addEventListener('easmusic:pause-all', onPauseAll)
      audioBindingRef.current = {
        audio,
        dispose: () => {
          window.removeEventListener('easmusic:pause-all', onPauseAll)
          audio.removeEventListener('timeupdate', onTimeUpdate)
          audio.removeEventListener('loadedmetadata', onLoadedMetadata)
          audio.removeEventListener('playing', onPlaying)
          audio.removeEventListener('pause', onPause)
          audio.removeEventListener('ended', onEnded)
          audio.removeEventListener('error', onError)
        },
      }
    }

    bindAudioElementRef.current = bindAudioElement
    const audio = createBrowserAudioElement()
    audioRef.current = audio
    analysisRef.current = null
    canAnalyzeAudioRef.current = false
    setAnalyserNode(null)
    setCanAnalyzeAudio(false)
    resetAudioAnalysisMode()
    bindAudioElement(audio)

    return () => {
      clearLoadingTimeout()
      flushListeningRef.current(true)
      const activeAudio = audioRef.current || audio
      audioBindingRef.current?.dispose()
      audioBindingRef.current = null
      activeAudio.pause()
      fullPlaybackRef.current = false
      canAnalyzeAudioRef.current = false
      setCanAnalyzeAudio(false)
      reportAudioAnalysisMode('idle')
      const analysis = analysisRef.current || audioAnalysisCache.get(activeAudio) || null
      disposeAudioAnalysis(activeAudio, analysis)
      analysisRef.current = null
      setAnalyserNode(null)
      audioRef.current = null
      bindAudioElementRef.current = null
    }
  }, [reportAudioAnalysisMode, resetAudioAnalysisMode])

  async function playResolvedTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    let audio = audioRef.current
    if (!audio) return
    const generation = ++prepareGenerationRef.current
    audio.muted = muted
    if (trackRef.current?.id === nextTrack.id && audio.currentSrc) {
      if (audio.paused) {
        if (audio.ended || ended) {
          audio.currentTime = 0
          setElapsed(0)
          setEnded(false)
        }
        setError(null)
        setLoading(true)
        startLoadingTimeout()
        resumeAudioContext()
        try {
          await audio.play()
          if (prepareGenerationRef.current !== generation || audioRef.current !== audio) {
            audio.pause()
            return
          }
        } catch (playError) {
          if (prepareGenerationRef.current !== generation || audioRef.current !== audio) return
          setPlaying(false)
          setError(getPlaybackErrorMessage(playError, audio))
          logPlaybackState('audio-play-rejected', nextTrack, audio, {
            isFullPlayback: fullPlaybackRef.current,
            error: playError,
          })
        } finally {
          if (prepareGenerationRef.current === generation && audioRef.current === audio) {
            clearLoadingTimeout()
            setLoading(false)
          }
        }
      } else {
        audio.pause()
      }
      return
    }
    audio.pause()
    queueRef.current = queue.length ? queue : [nextTrack]
    setTrack(nextTrack)
    setElapsed(0)
    setEnded(false)
    setError(null)
    fullPlaybackRef.current = nextTrack.isFullPlayback === true
    const nextDuration = fullPlaybackRef.current
      ? Math.max(1, nextTrack.previewDuration || 60)
      : Math.max(1, Math.min(60, nextTrack.previewDuration || 60))
    durationRef.current = nextDuration
    setDuration(nextDuration)
    setLoading(true)
    startLoadingTimeout()
    audio = prepareAudioSource(audio, nextTrack.previewUrl, nextTrack.canAnalyzeAudio === true)
    if (prepareGenerationRef.current !== generation || audioRef.current !== audio) return
    audio.muted = muted
    audio.src = nextTrack.previewUrl
    audio.currentTime = 0
    audio.load()
    resumeAudioContext()
    try {
      await audio.play()
      if (prepareGenerationRef.current !== generation || audioRef.current !== audio) {
        audio.pause()
        return
      }
    } catch (playError) {
      if (prepareGenerationRef.current !== generation || audioRef.current !== audio) return
      setPlaying(false)
      setError(getPlaybackErrorMessage(playError, audio))
      logPlaybackState('audio-play-rejected', nextTrack, audio, {
        isFullPlayback: fullPlaybackRef.current,
        error: playError,
      })
    } finally {
      if (prepareGenerationRef.current === generation && audioRef.current === audio) {
        clearLoadingTimeout()
        setLoading(false)
      }
    }
  }

  async function prepareResolvedTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    let audio = audioRef.current
    if (!audio) return
    const generation = ++prepareGenerationRef.current
    audio.pause()
    queueRef.current = queue.length ? queue : [nextTrack]
    fullPlaybackRef.current = nextTrack.isFullPlayback === true
    const preparedDuration = fullPlaybackRef.current
      ? Math.max(1, nextTrack.previewDuration || 60)
      : Math.max(1, Math.min(60, nextTrack.previewDuration || 60))
    durationRef.current = preparedDuration
    setDuration(preparedDuration)
    audio = prepareAudioSource(audio, nextTrack.previewUrl, nextTrack.canAnalyzeAudio === true)
    if (prepareGenerationRef.current !== generation || audioRef.current !== audio) return
    audio.src = nextTrack.previewUrl
    audio.currentTime = 0
    audio.load()
    const intendedMuted = muted
    audio.muted = true
    resumeAudioContext()
    try {
      await audio.play()
      if (prepareGenerationRef.current !== generation || audioRef.current !== audio) return
      audio.pause()
      audio.currentTime = 0
    } catch {
      // The visible play control remains available if a browser declines priming.
    } finally {
      if (prepareGenerationRef.current === generation && audioRef.current === audio) audio.muted = intendedMuted
    }
  }

  async function playTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    const audio = audioRef.current
    if (!audio) return

    // Resuming an already resolved source stays on the click path. This also
    // lets a second click recover from a browser NotAllowedError without a
    // second playback API request.
    if (trackRef.current?.id === nextTrack.id && audio.currentSrc) {
      primeAudioAnalysisForGesture(audio)
      await playResolvedTrack(nextTrack, queue)
      return
    }

    prepareGenerationRef.current += 1
    const generation = prepareGenerationRef.current
    audio.pause()
    setLoading(true)
    startLoadingTimeout()
    // Create/resume the analysis context while the click gesture is still
    // active. The playback endpoint may require an async request before it
    // returns the actual URL; waiting until after that request can leave the
    // browser AudioContext suspended and produce a silent player.
    primeAudioAnalysisForGesture(audio)
    try {
      const resolution = await requestPlayback(nextTrack)
      if (prepareGenerationRef.current !== generation) return
      const resolvedTrack: MusicPreviewTrack = {
        ...nextTrack,
        songId: nextTrack.songId || nextTrack.id,
        previewUrl: resolution.url,
        isFullPlayback: resolution.isFullPlayback,
        canAnalyzeAudio: resolution.canAnalyzeAudio,
      }
      await playResolvedTrack(resolvedTrack, queue)
    } catch (playbackError) {
      if (prepareGenerationRef.current !== generation) return
      clearLoadingTimeout()
      setLoading(false)
      setPlaying(false)
      setError(getPlaybackErrorMessage(playbackError, audio))
      logPlaybackState('playback-failed', nextTrack, audio, {
        playbackApiStatus: playbackError instanceof PlaybackRequestError ? playbackError.status : null,
        responseHasUrl: playbackError instanceof PlaybackRequestError ? playbackError.responseHasUrl : null,
        isFullPlayback: nextTrack.isFullPlayback ?? null,
        error: playbackError,
      })
    }
  }

  async function prepareTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    const generation = ++prepareGenerationRef.current
    try {
      const resolution = await requestPlayback(nextTrack)
      if (prepareGenerationRef.current !== generation) return
      await prepareResolvedTrack({
        ...nextTrack,
        songId: nextTrack.songId || nextTrack.id,
        previewUrl: resolution.url,
        isFullPlayback: resolution.isFullPlayback,
        canAnalyzeAudio: resolution.canAnalyzeAudio,
      }, queue)
    } catch (prepareError) {
      logPlaybackState('prepare-failed', nextTrack, audioRef.current, {
        playbackApiStatus: prepareError instanceof PlaybackRequestError ? prepareError.status : null,
        responseHasUrl: prepareError instanceof PlaybackRequestError ? prepareError.responseHasUrl : null,
        error: prepareError,
      })
    }
  }

  function playInsertionSound() {
    if (!canAnalyzeAudioRef.current) return
    const analysis = analysisRef.current
    if (!analysis || analysis.context.state === 'closed') return
    const { context } = analysis
    resumeAudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(220, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(92, context.currentTime + 0.24)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.3)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
  }

  function seek(nextSeconds: number) {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(nextSeconds)) return
    flushListeningSegment(true)
    const nextTime = Math.max(0, Math.min(durationRef.current, nextSeconds))
    audio.currentTime = nextTime
    setElapsed(nextTime)
    setEnded(false)
    if (!audio.paused) beginListeningSegment(audio)
  }

  function cycleRepeatMode() {
    const nextMode: BrowserRepeatMode = repeatModeRef.current === 'list'
      ? 'single'
      : repeatModeRef.current === 'single'
        ? 'shuffle'
        : 'list'
    repeatModeRef.current = nextMode
    setRepeatMode(nextMode)
  }

  async function move(direction: -1 | 1) {
    const currentTrack = trackRef.current
    if (!currentTrack) return
    const queue = queueRef.current
    const target = direction < 0
      ? getPreviousBrowserQueueTrack(queue, currentTrack.id)
      : getNextBrowserQueueTrack(queue, currentTrack.id, repeatModeRef.current)
    if (target) await playTrack(target, queue)
  }

  playTrackRef.current = playTrack

  const value: PlayerContextValue = {
    track,
    playing,
    loading,
    ended,
    error,
    muted,
    elapsed,
    duration,
    audioRef,
    analyserNode,
    audioAnalysisMode,
    canAnalyzeAudio,
    reportAudioAnalysisMode,
    prepareTrack,
    playTrack,
    pause: () => audioRef.current?.pause(),
    eject: () => stop(true),
    toggleMuted: () => {
      const nextMuted = !muted
      if (audioRef.current) audioRef.current.muted = nextMuted
      setMuted(nextMuted)
    },
    playInsertionSound,
    previous: () => move(-1),
    next: () => move(1),
    seek,
    repeatMode,
    cycleRepeatMode,
  }

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      {track && !isImmersiveGameRoute ? (
        <MusicMiniPlayer
          title={track.title}
          artist={track.albumName || track.artist}
          coverUrl={track.coverUrl}
          playing={playing}
          loading={loading}
          expanded={expanded}
          collapsed={collapsed}
          position={miniPlayerPosition}
          progress={Math.min(100, elapsed / duration * 100)}
           elapsed={elapsed}
           duration={duration}
           repeatMode={repeatMode}
          onToggleExpanded={() => setExpanded((value) => !value)}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onPositionChange={setMiniPlayerPosition}
          onTogglePlayback={() => void playTrack(track)}
          onPrevious={() => void move(-1)}
          onNext={() => void move(1)}
           onSeek={seek}
           onCycleRepeat={cycleRepeatMode}
          onClose={() => stop(true)}
        />
      ) : null}
    </MusicPlayerContext.Provider>
  )
}

export function useMusicPlayer() {
  const value = useContext(MusicPlayerContext)
  if (!value) throw new Error('useMusicPlayer must be used within MusicPlayerProvider')
  return value
}
