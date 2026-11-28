'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/** Only one live photo may play and make sound anywhere on the page. */
let activePlayback: { token: number; stop: () => void } | null = null

export function useLivePhotoPlayback(videoUrl?: string | null) {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const tokenRef = useRef(0)

  const stop = useCallback(() => {
    if (activePlayback?.token === tokenRef.current) activePlayback = null
    setPlaying(false)
  }, [])

  const play = useCallback(() => {
    if (!videoUrl) return
    activePlayback?.stop()
    tokenRef.current += 1
    activePlayback = { token: tokenRef.current, stop }
    setPlaying(true)
  }, [stop, videoUrl])

  const toggle = useCallback(() => {
    if (playing) stop()
    else play()
  }, [play, playing, stop])

  useEffect(() => () => {
    if (activePlayback?.token === tokenRef.current) activePlayback = null
  }, [])

  return { playing, muted, play, stop, toggle, setMuted }
}

function LiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2.5" y="6.5" width="14" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M18.5 10.2l3-2.1v7.8l-3-2.1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function LivePhotoPlayback({
  videoUrl, playing, muted, onToggle, onStop, onMuteToggle, className = '', variant = 'inline',
}: Readonly<{
  videoUrl: string | null
  playing: boolean
  muted: boolean
  onToggle: () => void
  onStop: () => void
  onMuteToggle: () => void
  className?: string
  variant?: 'inline' | 'viewer'
}>) {
  if (!videoUrl) return null
  return (
    <>
      <button
        type="button"
        className={`live-photo-badge ${className}`}
        aria-label={playing ? '停止播放实况照片' : '播放实况照片'}
        onClick={(event) => { event.stopPropagation(); onToggle() }}
      >
        <LiveIcon />
        <span>LIVE</span>
      </button>
      {playing ? (
        <div className={`live-photo-video-layer${variant === 'viewer' ? ' is-viewer' : ''}`} onClick={(event) => event.stopPropagation()}>
          {/* The video element is created only after an explicit user action. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={videoUrl}
            autoPlay
            muted={muted}
            playsInline
            preload="none"
            onEnded={onStop}
            onError={onStop}
          />
          <button
            type="button"
            className="live-photo-sound"
            aria-label={muted ? '开启实况照片声音' : '关闭实况照片声音'}
            onClick={(event) => { event.stopPropagation(); onMuteToggle() }}
          >
            {muted ? '🔇 开启声音' : '🔊 关闭声音'}
          </button>
        </div>
      ) : null}
    </>
  )
}

export type LivePhotoSurfaceProps = Readonly<{
  coverUrl: string
  videoUrl?: string | null
  alt: string
  imageClassName?: string
  buttonClassName?: string
  className?: string
  onOpen?: () => void
  loading?: 'lazy' | 'eager'
  fetchPriority?: 'high' | 'low' | 'auto'
  onError?: () => void
}>

/** Grid/cover surface: static cover first, LIVE badge, optional long press. */
export function LivePhotoSurface({
  coverUrl, videoUrl, alt, imageClassName = '', buttonClassName = '', className = '',
  onOpen, loading = 'lazy', fetchPriority = 'auto', onError,
}: LivePhotoSurfaceProps) {
  const playback = useLivePhotoPlayback(videoUrl)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const longPressRef = useRef(false)
  // Click fires after pointerup, so a finished long press must swallow it once.
  const suppressClickRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    clearTimer()
    playback.stop()
  }, [clearTimer, playback.stop])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!videoUrl || event.pointerType === 'mouse') return
    startRef.current = { x: event.clientX, y: event.clientY }
    longPressRef.current = false
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      longPressRef.current = true
      playback.play()
    }, 350)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = startRef.current
    if (!start) return
    if (Math.abs(event.clientX - start.x) > 12 || Math.abs(event.clientY - start.y) > 12) {
      clearTimer()
      if (longPressRef.current) {
        playback.stop()
        longPressRef.current = false
      }
    }
  }

  function onPointerUp() {
    clearTimer()
    startRef.current = null
    if (longPressRef.current) {
      playback.stop()
      longPressRef.current = false
      suppressClickRef.current = true
    }
  }

  return (
    <div
      className={`live-photo-surface ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Only the long-press playback gesture suppresses the native menu; a plain
      // long press on an ordinary image keeps the browser menu.
      onContextMenu={(event) => { if (longPressRef.current) event.preventDefault() }}
    >
      <button
        type="button"
        className={buttonClassName}
        aria-label={alt}
        onClick={(event) => {
          event.stopPropagation()
          if (suppressClickRef.current) { suppressClickRef.current = false; return }
          onOpen?.()
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverUrl} alt={alt} draggable={false} loading={loading} fetchPriority={fetchPriority} decoding="async" className={imageClassName} onError={onError} />
      </button>
      <LivePhotoPlayback
        videoUrl={videoUrl ?? null}
        playing={playback.playing}
        muted={playback.muted}
        onToggle={playback.toggle}
        onStop={playback.stop}
        onMuteToggle={() => playback.setMuted((value) => !value)}
      />
    </div>
  )
}
