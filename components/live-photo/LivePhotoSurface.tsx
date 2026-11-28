'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { LivePhotoBadge } from '@/components/live-photo/LivePhotoBadge'

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

  // A backgrounded tab must not keep a clip (or its sound) running.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onHidden = () => {
      if (document.visibilityState === 'hidden') stop()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', stop)
    }
  }, [stop])

  return { playing, muted, play, stop, toggle, setMuted }
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
      <LivePhotoBadge playing={playing} onToggle={onToggle} className={className} />
      {playing ? (
        <div className={`live-photo-video-layer${variant === 'viewer' ? ' is-viewer' : ''}`} onClick={(event) => event.stopPropagation()}>
          {/* The video element is created only after an explicit user action. */}
          <video
            src={videoUrl}
            autoPlay
            muted={muted}
            playsInline
            preload="none"
            onEnded={onStop}
            // A failed clip falls back to the still cover, and the badge stays
            // tappable, so the user can try again.
            onError={onStop}
          />
          <button
            type="button"
            className="live-photo-sound"
            aria-label={muted ? '开启实况照片声音' : '关闭实况照片声音'}
            onClick={(event) => { event.stopPropagation(); onMuteToggle() }}
          >
            {muted ? '开启声音' : '关闭声音'}
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
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const longPressRef = useRef(false)
  // Click fires after pointerup, so a finished long press must swallow it once.
  const suppressClickRef = useRef(false)
  const { stop: stopPlayback } = playback

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    clearTimer()
    stopPlayback()
  }, [clearTimer, stopPlayback])

  // Scrolling a playing clip out of view stops it instead of leaving audio
  // running from an invisible card in the feed.
  useEffect(() => {
    const element = surfaceRef.current
    if (!element || !videoUrl || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) stopPlayback()
      }
    }, { threshold: 0.15 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [stopPlayback, videoUrl])

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
      ref={surfaceRef}
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
          // Without preventDefault the surrounding card link would still do a
          // full-page navigation after the handler was stopped.
          event.preventDefault()
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
