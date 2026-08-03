'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { usePathname } from 'next/navigation'
import { MusicMiniPlayer } from '@/components/music/MusicMiniPlayer'
import type { MusicPlaybackResponse } from '@/lib/music-playback'
import type { AudioAnalysisMode } from '@/types/music-cassette'

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
}

type AudioAnalysis = {
  context: AudioContext
  source: MediaElementAudioSourceNode
  analyser: AnalyserNode
}

type AudioAnalysisModeDetails = {
  analyserAllZero?: boolean
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
    if (error.status === 403) return '音频地址已失效，请重新加载。'
    if (error.code === 'FULL_AUDIO_UNAVAILABLE') return '音频加载失败，请检查网络后重试。'
    if (error.code === 'PLAYBACK_API_NETWORK_ERROR') return '音频加载失败，请检查网络后重试。'
    if (error.code === 'PLAYBACK_API_INVALID_JSON' || error.code === 'PLAYBACK_API_CONTRACT_ERROR') {
      return '播放失败，请稍后重试。'
    }
    if (error.code === 'AUDIO_NOT_CONFIGURED' || error.code === 'NO_PLAYBACK_URL') {
      return '该歌曲暂未配置可播放音频。'
    }
    if (error.status === 404 || error.code === 'SONG_NOT_FOUND') return '音频文件不存在。'
    if (error.status === null) return '音频加载失败，请检查网络后重试。'
  }

  switch (errorName(error)) {
    case 'NotAllowedError':
      return '浏览器暂未允许播放，请再次点击播放按钮。'
    case 'NotSupportedError':
      return '当前音频格式或地址无法播放。'
    case 'AbortError':
      return '播放已取消，请重试。'
  }

  switch (audio?.error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return '播放已取消，请重试。'
    case MediaError.MEDIA_ERR_NETWORK:
      return '音频加载失败，请检查网络后重试。'
    case MediaError.MEDIA_ERR_DECODE:
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return '当前音频格式或地址无法播放。'
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
  reportAudioAnalysisMode: (mode: AudioAnalysisMode, details?: AudioAnalysisModeDetails) => void
  prepareTrack: (track: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>
  playTrack: (track: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>
  pause: () => void
  eject: () => void
  toggleMuted: () => void
  playInsertionSound: () => void
  previous: () => Promise<void>
  next: () => Promise<void>
}

const MusicPlayerContext = createContext<PlayerContextValue | null>(null)

export function MusicPlayerProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname()
  const isImmersiveGameRoute = /^\/games\/[^/]+\/play(?:\/|$)/.test(pathname)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const analysisRef = useRef<AudioAnalysis | null>(null)
  const queueRef = useRef<MusicPreviewTrack[]>([])
  const playbackCacheRef = useRef(new Map<string, Promise<PlaybackResolution>>())
  const trackRef = useRef<MusicPreviewTrack | null>(null)
  const durationRef = useRef(60)
  const fullPlaybackRef = useRef(false)
  const prepareGenerationRef = useRef(0)
  const loadingTimeoutRef = useRef<number | null>(null)
  const loadingTimedOutRef = useRef(false)
  const audioAnalysisModeRef = useRef<AudioAnalysisMode>('idle')
  const analysisFallbackLoggedRef = useRef(false)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [audioAnalysisMode, setAudioAnalysisMode] = useState<AudioAnalysisMode>('idle')
  const [track, setTrack] = useState<MusicPreviewTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(60)
  const [expanded, setExpanded] = useState(false)

  trackRef.current = track

  const reportAudioAnalysisMode = useCallback((mode: AudioAnalysisMode, details: AudioAnalysisModeDetails = {}) => {
    const previousMode = audioAnalysisModeRef.current
    if (previousMode === mode) return
    audioAnalysisModeRef.current = mode
    setAudioAnalysisMode(mode)

    if (process.env.NODE_ENV !== 'production' && mode === 'fallback' && !analysisFallbackLoggedRef.current) {
      analysisFallbackLoggedRef.current = true
      console.info('[EasMusic waveform] fallback visualization enabled', {
        previousMode,
        audioAnalysisMode: mode,
        audioContextState: analysisRef.current?.context.state ?? null,
        analyserAvailable: Boolean(analysisRef.current?.analyser),
        analyserAllZero: details.analyserAllZero ?? false,
      })
    }
  }, [])

  const resetAudioAnalysisMode = useCallback(() => {
    analysisFallbackLoggedRef.current = false
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

  async function requestPlayback(nextTrack: MusicPreviewTrack): Promise<PlaybackResolution> {
    if (!nextTrack.previewUrl) {
      throw new PlaybackRequestError('NO_PLAYBACK_URL', 404, false)
    }

    if (!isMusicPlaybackEndpoint(nextTrack.previewUrl)) {
      return {
        ok: true,
        url: nextTrack.previewUrl,
        isFullPlayback: nextTrack.isFullPlayback === true,
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
      if (body?.ok !== true || !responseHasUrl || typeof isFullPlayback !== 'boolean') {
        throw new PlaybackRequestError('PLAYBACK_API_CONTRACT_ERROR', response.status, responseHasUrl, 'PLAYBACK_API_CONTRACT_ERROR')
      }

      return {
        ok: true as const,
        url: body.url as string,
        isFullPlayback,
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

  function prepareAudioSource(audio: HTMLAudioElement, url: string) {
    // The deployed COS objects currently do not send Access-Control-Allow-Origin.
    // Do not force a cross-origin media element through MediaElementSourceNode:
    // browsers reject the load or mute it before audio.play() can succeed.
    let sameOrigin = false
    try {
      sameOrigin = new URL(url, window.location.href).origin === window.location.origin
    } catch {
      sameOrigin = false
    }

    resetAudioAnalysisMode()
    const previousAnalysis = analysisRef.current
    if (previousAnalysis) {
      disposeAudioAnalysis(audio, previousAnalysis)
      analysisRef.current = null
      setAnalyserNode(null)
    }

    if (sameOrigin) {
      audio.crossOrigin = 'anonymous'
      const analysis = createAudioAnalysis(audio)
      analysisRef.current = analysis
      setAnalyserNode(analysis?.analyser || null)
    } else {
      audio.removeAttribute('crossorigin')
    }
  }

  function resumeAudioContext() {
    const context = analysisRef.current?.context
    if (context && context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }
  }

  function stop(resetTrack = false) {
    prepareGenerationRef.current += 1
    clearLoadingTimeout()
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    resetAudioAnalysisMode()
    fullPlaybackRef.current = false
    setPlaying(false)
    setLoading(false)
    setEnded(false)
    setError(null)
    setElapsed(0)
    if (resetTrack) setTrack(null)
  }

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audioRef.current = audio
    analysisRef.current = null
    setAnalyserNode(null)
    resetAudioAnalysisMode()

    const onTimeUpdate = () => {
      const cappedTime = fullPlaybackRef.current ? audio.currentTime : Math.min(audio.currentTime, durationRef.current)
      setElapsed(cappedTime)
      if (!fullPlaybackRef.current && audio.currentTime >= durationRef.current) {
        audio.pause()
        audio.currentTime = durationRef.current
        setEnded(true)
      }
    }
    const onLoadedMetadata = () => {
      if (!fullPlaybackRef.current || !Number.isFinite(audio.duration) || audio.duration <= 0) return
      durationRef.current = audio.duration
      setDuration(audio.duration)
    }
    const onPlaying = () => {
      clearLoadingTimeout()
      setPlaying(true)
      setLoading(false)
      setEnded(false)
      setError(null)
    }
    const onPause = () => {
      setPlaying(false)
      reportAudioAnalysisMode('idle')
    }
    const onEnded = () => {
      setElapsed(fullPlaybackRef.current && Number.isFinite(audio.duration) ? audio.duration : durationRef.current)
      setPlaying(false)
      setEnded(true)
      reportAudioAnalysisMode('idle')
    }
    const onError = () => {
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
    const onPauseAll = () => audio.pause()
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    window.addEventListener('easmusic:pause-all', onPauseAll)

    return () => {
      clearLoadingTimeout()
      window.removeEventListener('easmusic:pause-all', onPauseAll)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.pause()
      fullPlaybackRef.current = false
      reportAudioAnalysisMode('idle')
      const analysis = analysisRef.current
      disposeAudioAnalysis(audio, analysis)
      analysisRef.current = null
      setAnalyserNode(null)
      audioRef.current = null
    }
  }, [reportAudioAnalysisMode, resetAudioAnalysisMode])

  async function playResolvedTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    const audio = audioRef.current
    if (!audio) return
    prepareGenerationRef.current += 1
    audio.muted = muted
    if (track?.id === nextTrack.id && audio.src) {
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
        } catch (playError) {
          setPlaying(false)
          setError(getPlaybackErrorMessage(playError, audio))
          logPlaybackState('audio-play-rejected', nextTrack, audio, {
            isFullPlayback: fullPlaybackRef.current,
            error: playError,
          })
        } finally {
          clearLoadingTimeout()
          setLoading(false)
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
    prepareAudioSource(audio, nextTrack.previewUrl)
    audio.src = nextTrack.previewUrl
    audio.currentTime = 0
    audio.load()
    resumeAudioContext()
    try {
      await audio.play()
    } catch (playError) {
      setPlaying(false)
      setError(getPlaybackErrorMessage(playError, audio))
      logPlaybackState('audio-play-rejected', nextTrack, audio, {
        isFullPlayback: fullPlaybackRef.current,
        error: playError,
      })
    } finally {
      clearLoadingTimeout()
      setLoading(false)
    }
  }

  async function prepareResolvedTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    const audio = audioRef.current
    if (!audio) return
    const generation = prepareGenerationRef.current + 1
    prepareGenerationRef.current = generation
    audio.pause()
    queueRef.current = queue.length ? queue : [nextTrack]
    fullPlaybackRef.current = nextTrack.isFullPlayback === true
    const preparedDuration = fullPlaybackRef.current
      ? Math.max(1, nextTrack.previewDuration || 60)
      : Math.max(1, Math.min(60, nextTrack.previewDuration || 60))
    durationRef.current = preparedDuration
    setDuration(preparedDuration)
    prepareAudioSource(audio, nextTrack.previewUrl)
    audio.src = nextTrack.previewUrl
    audio.currentTime = 0
    audio.load()
    const intendedMuted = muted
    audio.muted = true
    resumeAudioContext()
    try {
      await audio.play()
      if (prepareGenerationRef.current !== generation) return
      audio.pause()
      audio.currentTime = 0
    } catch {
      // The visible play control remains available if a browser declines priming.
    } finally {
      if (prepareGenerationRef.current === generation) audio.muted = intendedMuted
    }
  }

  async function playTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    const audio = audioRef.current
    if (!audio) return

    // Resuming an already resolved source stays on the click path. This also
    // lets a second click recover from a browser NotAllowedError without a
    // second playback API request.
    if (track?.id === nextTrack.id && audio.currentSrc) {
      await playResolvedTrack(nextTrack, queue)
      return
    }

    prepareGenerationRef.current += 1
    const generation = prepareGenerationRef.current
    audio.pause()
    setLoading(true)
    startLoadingTimeout()
    try {
      const resolution = await requestPlayback(nextTrack)
      if (prepareGenerationRef.current !== generation) return
      const resolvedTrack: MusicPreviewTrack = {
        ...nextTrack,
        songId: nextTrack.songId || nextTrack.id,
        previewUrl: resolution.url,
        isFullPlayback: resolution.isFullPlayback,
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
    const generation = prepareGenerationRef.current
    try {
      const resolution = await requestPlayback(nextTrack)
      if (prepareGenerationRef.current !== generation) return
      await prepareResolvedTrack({
        ...nextTrack,
        songId: nextTrack.songId || nextTrack.id,
        previewUrl: resolution.url,
        isFullPlayback: resolution.isFullPlayback,
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

  async function move(direction: -1 | 1) {
    if (!track) return
    const queue = queueRef.current
    const index = queue.findIndex((item) => item.id === track.id)
    const target = queue[index + direction]
    if (target) await playTrack(target, queue)
  }

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
          progress={Math.min(100, elapsed / duration * 100)}
          onToggleExpanded={() => setExpanded((value) => !value)}
          onTogglePlayback={() => void playTrack(track)}
          onPrevious={() => void move(-1)}
          onNext={() => void move(1)}
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
