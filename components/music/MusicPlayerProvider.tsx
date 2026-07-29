'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
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
  elapsed: number
  duration: number
  playTrack: (track: MusicPreviewTrack, queue?: MusicPreviewTrack[]) => Promise<void>
  pause: () => void
  previous: () => Promise<void>
  next: () => Promise<void>
}

const MusicPlayerContext = createContext<PlayerContextValue | null>(null)

export function MusicPlayerProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<MusicPreviewTrack[]>([])
  const [track, setTrack] = useState<MusicPreviewTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(60)
  const [expanded, setExpanded] = useState(false)

  function stop(resetTrack = false) {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setPlaying(false)
    setLoading(false)
    setElapsed(0)
    if (resetTrack) setTrack(null)
  }

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audioRef.current = audio
    const onTimeUpdate = () => setElapsed(audio.currentTime)
    const onPlaying = () => { setPlaying(true); setLoading(false) }
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      audio.currentTime = 0
      setElapsed(0)
      setPlaying(false)
    }
    const onError = () => { setLoading(false); setPlaying(false) }
    const onPauseAll = () => audio.pause()
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    window.addEventListener('easmusic:pause-all', onPauseAll)
    return () => {
      window.removeEventListener('easmusic:pause-all', onPauseAll)
      audio.pause()
      audioRef.current = null
    }
  }, [])

  async function playTrack(nextTrack: MusicPreviewTrack, queue = queueRef.current) {
    const audio = audioRef.current
    if (!audio) return
    if (track?.id === nextTrack.id && audio.src) {
      if (audio.paused) {
        setLoading(true)
        await audio.play().finally(() => setLoading(false))
      } else {
        audio.pause()
      }
      return
    }
    audio.pause()
    queueRef.current = queue.length ? queue : [nextTrack]
    setTrack(nextTrack)
    setElapsed(0)
    setDuration(Math.max(1, Math.min(60, nextTrack.previewDuration || 60)))
    setLoading(true)
    audio.src = nextTrack.previewUrl
    audio.currentTime = 0
    audio.load()
    try {
      await audio.play()
    } catch {
      setPlaying(false)
    } finally {
      setLoading(false)
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
    elapsed,
    duration,
    playTrack,
    pause: () => audioRef.current?.pause(),
    previous: () => move(-1),
    next: () => move(1),
  }

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      {track ? (
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
