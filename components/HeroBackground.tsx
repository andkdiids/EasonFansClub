'use client'

import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react'
import { publicImageUrl } from '@/lib/images'
import { usePageVisibility } from '@/hooks/usePageVisibility'
import {
  resolveHeroMediaLayout,
  resolveHeroMediaSettings,
  resolveHeroMediaAsset,
  type HeroMediaDimensions,
  type HeroFitMode,
  type HeroMediaType,
  type HeroPositionMode,
  type SiteHeroVisualConfig,
} from '@/lib/hero-visuals'

type HeroBackgroundProps = {
  visual?: SiteHeroVisualConfig | null
  fallbackImageUrl?: string | null
  className?: string
  priority?: boolean
  positionMode?: HeroPositionMode
  cacheBust?: string
}

type HeroBackgroundStyle = CSSProperties & {
  '--hero-position-desktop': string
  '--hero-position-mobile': string
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(mediaQuery.matches)
    update()
    mediaQuery.addEventListener?.('change', update)
    return () => mediaQuery.removeEventListener?.('change', update)
  }, [])

  return reducedMotion
}

function useHeroDevice(positionMode: HeroPositionMode) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>(positionMode === 'mobile' ? 'mobile' : 'desktop')

  useEffect(() => {
    if (positionMode !== 'responsive') {
      setDevice(positionMode)
      return
    }
    const mediaQuery = window.matchMedia('(max-width:767px)')
    const update = () => setDevice(mediaQuery.matches ? 'mobile' : 'desktop')
    update()
    mediaQuery.addEventListener?.('change', update)
    return () => mediaQuery.removeEventListener?.('change', update)
  }, [positionMode])

  return device
}

function cacheBustedUrl(url: string | null | undefined, cacheBust?: string) {
  const normalizedUrl = url || ''
  if (!normalizedUrl || !cacheBust) return normalizedUrl
  return `${normalizedUrl}${normalizedUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(cacheBust)}`
}

function getImageDimensions(event: SyntheticEvent<HTMLImageElement>): HeroMediaDimensions | null {
  const image = event.currentTarget
  return image.naturalWidth > 0 && image.naturalHeight > 0
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : null
}

function layerStyle(
  frame: HeroMediaDimensions,
  dimensions: HeroMediaDimensions | null,
  settings: { positionX: number; positionY: number; scale: number; fitMode?: HeroFitMode },
): CSSProperties {
  const layout = dimensions ? resolveHeroMediaLayout(frame, dimensions, settings) : null
  return {
    left: layout ? `${layout.left}px` : 0,
    top: layout ? `${layout.top}px` : 0,
    width: layout ? `${layout.width}px` : '100%',
    height: layout ? `${layout.height}px` : '100%',
    objectFit: 'cover',
    objectPosition: `${settings.positionX}% ${settings.positionY}%`,
  }
}

export function HeroBackground({ visual, fallbackImageUrl, className = '', priority = false, positionMode = 'responsive', cacheBust }: Readonly<HeroBackgroundProps>) {
  const reducedMotion = usePrefersReducedMotion()
  const isPageVisible = usePageVisibility()
  const device = useHeroDevice(positionMode)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [frameSize, setFrameSize] = useState<HeroMediaDimensions>({ width: 0, height: 0 })
  const [mediaDimensions, setMediaDimensions] = useState<HeroMediaDimensions | null>(null)
  const [fallbackDimensions, setFallbackDimensions] = useState<HeroMediaDimensions | null>(null)
  const [videoReady, setVideoReady] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const [isInViewport, setIsInViewport] = useState(true)
  const mediaAsset = resolveHeroMediaAsset(visual, device, fallbackImageUrl || '')
  const mediaType: HeroMediaType = mediaAsset?.mediaType || 'IMAGE'
  const imageUrl = publicImageUrl(cacheBustedUrl(mediaAsset?.imageUrl || '', cacheBust))
  const mediaUrl = publicImageUrl(cacheBustedUrl(mediaAsset?.mediaUrl || (mediaType === 'IMAGE' ? mediaAsset?.imageUrl : ''), cacheBust))
  const fallbackUrl = publicImageUrl(cacheBustedUrl(
    mediaAsset?.posterUrl
      || (mediaType === 'VIDEO' ? mediaAsset?.imageUrl : '')
      || fallbackImageUrl
      || (mediaType !== 'IMAGE' ? mediaAsset?.imageUrl : ''),
    cacheBust,
  ))
  const staticUrl = mediaType === 'IMAGE' ? mediaUrl || imageUrl : fallbackUrl
  const shouldAnimate = isPageVisible && isInViewport && !reducedMotion && !videoFailed
  const hasAnimatedImagePoster = Boolean(mediaType === 'ANIMATED_IMAGE' && fallbackUrl && fallbackUrl !== mediaUrl)
  const settings = resolveHeroMediaSettings({
    desktopPositionX: visual?.desktopPositionX ?? 50,
    desktopPositionY: visual?.desktopPositionY ?? 50,
    desktopScale: visual?.desktopScale ?? 100,
    mobilePositionX: visual?.mobilePositionX ?? 50,
    mobilePositionY: visual?.mobilePositionY ?? 50,
    mobileScale: visual?.mobileScale ?? 100,
    desktopFitMode: visual?.desktopFitMode ?? 'COVER',
    mobileFitMode: visual?.mobileFitMode ?? 'COVER',
  }, device)
  const desktopPosition = `${visual?.desktopPositionX ?? 50}% ${visual?.desktopPositionY ?? 50}%`
  const mobilePosition = `${visual?.mobilePositionX ?? 50}% ${visual?.mobilePositionY ?? 50}%`
  const wrapperStyle: HeroBackgroundStyle = {
    '--hero-position-desktop': desktopPosition,
    '--hero-position-mobile': mobilePosition,
    backgroundColor: '#071523',
  }
  const forceClass = positionMode === 'desktop' ? 'hero-background-force-desktop' : positionMode === 'mobile' ? 'hero-background-force-mobile' : ''
  const sharedClass = `hero-background ${forceClass} ${className}`
  const frame = frameSize
  const mediaStyle = layerStyle(frame, mediaDimensions, settings)
  const posterStyle = layerStyle(frame, fallbackDimensions, settings)

  useEffect(() => {
    const frameElement = frameRef.current
    if (!frameElement) return
    const update = () => setFrameSize({ width: frameElement.clientWidth, height: frameElement.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(frameElement)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const frameElement = frameRef.current
    if (!frameElement || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      setIsInViewport(entry?.isIntersecting ?? true)
    }, { rootMargin: '160px 0px' })
    observer.observe(frameElement)
    return () => observer.disconnect()
  }, [mediaType, mediaUrl, fallbackUrl])

  useEffect(() => {
    setMediaDimensions(null)
    setFallbackDimensions(null)
    setVideoReady(false)
    setVideoFailed(false)
    const video = videoRef.current
    if (video && mediaType === 'VIDEO') {
      video.setAttribute('webkit-playsinline', 'true')
      video.setAttribute('x5-playsinline', 'true')
      video.setAttribute('x5-video-player-type', 'h5-page')
    }
  }, [mediaType, mediaUrl, fallbackUrl])

  useEffect(() => {
    const video = videoRef.current
    if (!video || mediaType !== 'VIDEO' || reducedMotion) return
    if (!shouldAnimate) {
      video.pause()
      return
    }
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setMediaDimensions({ width: video.videoWidth, height: video.videoHeight })
    }
    video.muted = true
    const playPromise = video.play()
    if (playPromise) {
      void playPromise.then(() => setVideoReady(true)).catch(() => {
        setVideoFailed(true)
        setVideoReady(false)
      })
    } else {
      setVideoReady(true)
    }
  }, [isPageVisible, isInViewport, reducedMotion, mediaType, mediaUrl, fallbackUrl, shouldAnimate])

  if (visual && !visual.enabled) return null

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>, fallback = false) {
    const dimensions = getImageDimensions(event)
    if (dimensions) {
      if (fallback) setFallbackDimensions(dimensions)
      else setMediaDimensions(dimensions)
    }
  }

  function handleVideoMetadata() {
    const video = videoRef.current
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setMediaDimensions({ width: video.videoWidth, height: video.videoHeight })
    }
  }

  function playVideoIfAllowed() {
    const video = videoRef.current
    if (!video || !shouldAnimate) return
    handleVideoMetadata()
    video.muted = true
    const playPromise = video.play()
    if (playPromise) {
      void playPromise.then(() => setVideoReady(true)).catch(() => {
        setVideoFailed(true)
        setVideoReady(false)
      })
    } else {
      setVideoReady(true)
    }
  }

  function markVideoReady() {
    handleVideoMetadata()
    if (!shouldAnimate) {
      videoRef.current?.pause()
      return
    }
    playVideoIfAllowed()
  }

  if (mediaType === 'VIDEO' && mediaUrl && !reducedMotion) {
    return <div
      ref={frameRef}
      aria-hidden="true"
      data-hero-background={visual?.key || 'fallback'}
      data-hero-media-type="VIDEO"
      data-hero-media-state={shouldAnimate ? 'playing' : 'paused'}
      data-hero-document-visibility={isPageVisible ? 'visible' : 'hidden'}
      className={sharedClass}
      style={wrapperStyle}
    >
      {fallbackUrl ? <img
        key={`poster:${fallbackUrl}`}
        data-hero-media-fallback="true"
        className="hero-background-layer hero-background-poster"
        src={fallbackUrl}
        alt=""
        style={posterStyle}
        onLoad={(event) => handleImageLoad(event, true)}
      /> : null}
      {!videoFailed ? <video
        ref={videoRef}
        key={mediaUrl}
        data-hero-media-type="VIDEO"
        data-priority={priority ? 'true' : undefined}
        className={`hero-background-layer hero-background-video${videoReady ? ' is-ready' : ''}`}
        style={mediaStyle}
        src={mediaUrl}
        poster={fallbackUrl || undefined}
        autoPlay={shouldAnimate}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={handleVideoMetadata}
        onCanPlay={markVideoReady}
        onLoadedData={markVideoReady}
        onError={() => {
          setVideoFailed(true)
          setVideoReady(false)
        }}
      /> : null}
    </div>
  }

  if (mediaType === 'ANIMATED_IMAGE' && mediaUrl && !reducedMotion) {
    return <div ref={frameRef} aria-hidden="true" data-hero-background={visual?.key || 'fallback'} data-hero-media-type="ANIMATED_IMAGE" data-hero-media-state={shouldAnimate ? 'playing' : 'paused'} data-hero-document-visibility={isPageVisible ? 'visible' : 'hidden'} className={sharedClass} style={wrapperStyle}>
      {hasAnimatedImagePoster && !shouldAnimate ? <img
        key={`poster:${fallbackUrl}`}
        data-hero-media-fallback="true"
        className="hero-background-layer hero-background-poster"
        src={fallbackUrl || undefined}
        alt=""
        style={posterStyle}
        onLoad={(event) => handleImageLoad(event, true)}
      /> : null}
      <img
        data-priority={priority ? 'true' : undefined}
        className={`hero-background-layer hero-background-media${shouldAnimate ? '' : ' is-paused'}`}
        style={mediaStyle}
        src={mediaUrl}
        alt=""
        draggable={false}
        onLoad={handleImageLoad}
      />
    </div>
  }

  if (!staticUrl) return null
  return <div ref={frameRef} aria-hidden="true" data-hero-background={visual?.key || 'fallback'} data-hero-media-type="IMAGE" data-hero-media-state="static" className={sharedClass} style={wrapperStyle}>
    <img
      data-priority={priority ? 'true' : undefined}
      className="hero-background-layer hero-background-media"
      style={mediaStyle}
      src={staticUrl}
      alt=""
      draggable={false}
      onLoad={handleImageLoad}
    />
  </div>
}
