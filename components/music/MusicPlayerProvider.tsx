'use client'

import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { usePathname } from 'next/navigation'
import { MusicMiniPlayer } from '@/components/music/MusicMiniPlayer'

export type MusicPreviewTrack = {
  id: string
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
  if (!AudioContextClass) {
    console.warn('[EasMusic waveform] Web Audio API is unavailable; showing the idle baseline.')
    return null
  }

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
  } catch (error) {
    if (context) void context.close().catch(() => undefined)
    console.warn('[EasMusic waveform] Could not connect the existing audio element; showing the idle baseline.', error)
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
  const durationRef = useRef(60)
  const fullPlaybackRef = useRef(false)
  const prepareGenerationRef = useRef(0)
  const loadingTimeoutRef = useRef<number | null>(null)
  const loadingTimedOutRef = useRef(false)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [track, setTrack] = useState<MusicPreviewTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(60)
  const [expanded, setExpanded] = useState(false)

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
      setError('磁带读取超时，请检查网络后重试。')
    }, 15_000)
  }

  function resumeAudioContext() {
    const context = analysisRef.current?.context
    if (context && context.state === 'suspended') {
      void context.resume().catch(() => {
        console.warn('[EasMusic waveform] AudioContext could not be resumed; showing the idle baseline.')
      })
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
    // Set CORS before any src assignment. Direct COS URLs must answer with a
    // matching Access-Control-Allow-Origin header for analyser data to exist.
    audio.crossOrigin = 'anonymous'
    audio.preload = 'metadata'
    audioRef.current = audio

    const analysis = createAudioAnalysis(audio)
    analysisRef.current = analysis
    setAnalyserNode(analysis?.analyser || null)

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
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setElapsed(fullPlaybackRef.current && Number.isFinite(audio.duration) ? audio.duration : durationRef.current)
      setPlaying(false)
      setEnded(true)
    }
    const onError = () => {
      clearLoadingTimeout()
      setLoading(false)
      setPlaying(false)
      setError('这盘磁带暂时无法播放，请换一首试听。')
      console.warn('[EasMusic audio] Playback failed. If this is a direct COS URL, check CORS for https://ecfc.fans and the local development origin.', {
        mediaErrorCode: audio.error?.code,
        crossOrigin: audio.crossOrigin,
      })
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
      disposeAudioAnalysis(audio, analysis)
      if (analysisRef.current === analysis) analysisRef.current = null
      setAnalyserNode((current) => current === analysis?.analyser ? null : current)
      audioRef.current = null
    }
  }, [])

  async function playTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
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
        } catch {
          setError(loadingTimedOutRef.current ? '磁带读取超时，请检查网络后重试。' : '浏览器阻止了播放，请再次点击播放按钮。')
          setPlaying(false)
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
    audio.src = nextTrack.previewUrl
    audio.currentTime = 0
    audio.load()
    resumeAudioContext()
    try {
      await audio.play()
    } catch {
      setPlaying(false)
      setError(loadingTimedOutRef.current ? '磁带读取超时，请检查网络后重试。' : '浏览器阻止了播放，请再次点击播放按钮。')
    } finally {
      clearLoadingTimeout()
      setLoading(false)
    }
  }

  async function prepareTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    const audio = audioRef.current
    if (!audio) return
    const generation = prepareGenerationRef.current + 1
    prepareGenerationRef.current = generation
    audio.pause()
    queueRef.current = queue.length ? queue : [nextTrack]
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
