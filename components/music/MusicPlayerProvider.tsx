'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
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
  prepareTrack: (track: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>
  playTrack: (track: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>
  pause: () => void
  eject: () => void
  toggleMuted: () => void
  previous: () => Promise<void>
  next: () => Promise<void>
}

const MusicPlayerContext = createContext<PlayerContextValue | null>(null)

export function MusicPlayerProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname()
  const isImmersiveGameRoute = /^\/games\/[^/]+\/play(?:\/|$)/.test(pathname)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<MusicPreviewTrack[]>([])
  const durationRef = useRef(60)
  const prepareGenerationRef = useRef(0)
  const loadingTimeoutRef = useRef<number | null>(null)
  const loadingTimedOutRef = useRef(false)
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

  function stop(resetTrack = false) {
    prepareGenerationRef.current += 1
    clearLoadingTimeout()
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
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
    const onTimeUpdate = () => {
      const cappedTime = Math.min(audio.currentTime, durationRef.current)
      setElapsed(cappedTime)
      if (audio.currentTime >= durationRef.current) {
        audio.pause()
        audio.currentTime = durationRef.current
        setEnded(true)
      }
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
      setElapsed(durationRef.current)
      setPlaying(false)
      setEnded(true)
    }
    const onError = () => {
      clearLoadingTimeout()
      setLoading(false)
      setPlaying(false)
      setError('这盘磁带暂时无法播放，请换一首试试。')
    }
    const onPauseAll = () => audio.pause()
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    window.addEventListener('easmusic:pause-all', onPauseAll)
    return () => {
      clearLoadingTimeout()
      window.removeEventListener('easmusic:pause-all', onPauseAll)
      audio.pause()
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
    const nextDuration = Math.max(1, Math.min(60, nextTrack.previewDuration || 60))
    durationRef.current = nextDuration
    setDuration(nextDuration)
    setLoading(true)
    startLoadingTimeout()
    audio.src = nextTrack.previewUrl
    audio.currentTime = 0
    audio.load()
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
    prepareTrack,
    playTrack,
    pause: () => audioRef.current?.pause(),
    eject: () => stop(true),
    toggleMuted: () => {
      const nextMuted = !muted
      if (audioRef.current) audioRef.current.muted = nextMuted
      setMuted(nextMuted)
    },
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
