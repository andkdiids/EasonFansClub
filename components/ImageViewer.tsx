'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent, type WheelEvent } from 'react'
import { publicImageOriginalUrl, publicImageVariantUrl } from '@/lib/image-variants'
import { publicImageUrl } from '@/lib/images'

export const IMAGE_VIEWER_MIN_ZOOM = 0.5
export const IMAGE_VIEWER_MAX_ZOOM = 4
export const IMAGE_VIEWER_ZOOM_STEP = 0.25
export const IMAGE_VIEWER_AUTO_PLAY_INTERVAL_MS = 3_000

const SWIPE_COMMIT_THRESHOLD_PX = 48
const ZERO_POINT = { x: 0, y: 0 }
const ZERO_SIZE = { width: 0, height: 0 }

export type ImageViewerItem = {
  id?: string
  src: string
  alt?: string
  previewSrc?: string
  /** Explicitly control whether a protected/original route is available. */
  originalUrl?: string | null
  downloadUrl?: string
}

type ViewerImageState = 'loading' | 'loaded' | 'error'
type Point = { x: number; y: number }
type Size = { width: number; height: number }
type TrackedPointer = Point & { pointerType: string }
type DragState = {
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  startPan: Point
  moved: boolean
}
type PinchState = {
  startDistance: number
  startZoom: number
  startCenter: Point
  startPan: Point
}

export function clampImageViewerZoom(value: number) {
  return Math.min(IMAGE_VIEWER_MAX_ZOOM, Math.max(IMAGE_VIEWER_MIN_ZOOM, Math.round(value * 100) / 100))
}

export function calculateImageViewerFit(naturalSize: Size, viewportSize: Size): Size {
  if (naturalSize.width <= 0 || naturalSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) return ZERO_SIZE
  const fitScale = Math.min(viewportSize.width / naturalSize.width, viewportSize.height / naturalSize.height)
  return {
    width: naturalSize.width * fitScale,
    height: naturalSize.height * fitScale,
  }
}

export function clampImageViewerPan(point: Point, zoom: number, fitSize: Size, viewportSize: Size): Point {
  if (fitSize.width <= 0 || fitSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) return ZERO_POINT
  const maxX = Math.max(0, (fitSize.width * zoom - viewportSize.width) / 2)
  const maxY = Math.max(0, (fitSize.height * zoom - viewportSize.height) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, point.x)),
    y: Math.min(maxY, Math.max(-maxY, point.y)),
  }
}

function samePoint(first: Point, second: Point) {
  return first.x === second.x && first.y === second.y
}

function sameSize(first: Size, second: Size) {
  return first.width === second.width && first.height === second.height
}

function pointerDistance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function pointerCenter(first: Point, second: Point): Point {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

export function ImageViewer({
  src,
  alt,
  previewSrc,
  originalUrl,
  downloadUrl,
  gallery,
  initialIndex = 0,
  autoPlay = false,
  imageClassName = 'h-auto max-h-[32rem] w-full object-contain',
  buttonClassName = 'block w-full cursor-zoom-in overflow-hidden bg-slate-100 text-left',
  loading = 'lazy',
  fetchPriority = 'auto',
  onError,
  onOpenChange,
  onIndexChange,
}: Readonly<{
  src: string
  alt: string
  previewSrc?: string
  originalUrl?: string | null
  downloadUrl?: string
  gallery?: readonly ImageViewerItem[]
  initialIndex?: number
  autoPlay?: boolean
  imageClassName?: string
  buttonClassName?: string
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
  onError?: () => void
  onOpenChange?: (open: boolean) => void
  onIndexChange?: (index: number) => void
}>) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>(ZERO_POINT)
  const [fitSize, setFitSize] = useState<Size>(ZERO_SIZE)
  const [currentIndex, setCurrentIndex] = useState(() => clampIndex(initialIndex, gallery?.length || 1))
  const [imageState, setImageState] = useState<ViewerImageState>('loading')
  const [isAutoPlaying, setIsAutoPlaying] = useState(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [autoPlayResetKey, setAutoPlayResetKey] = useState(0)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const naturalSizeRef = useRef<Size>(ZERO_SIZE)
  const viewportSizeRef = useRef<Size>(ZERO_SIZE)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  const pointersRef = useRef(new Map<number, TrackedPointer>())
  const dragRef = useRef<DragState | null>(null)
  const pinchRef = useRef<PinchState | null>(null)
  const didDragRef = useRef(false)
  const autoPlayTimeoutRef = useRef<number | null>(null)
  const isInteractingRef = useRef(false)
  zoomRef.current = zoom
  panRef.current = pan

  const viewerItems: readonly ImageViewerItem[] = gallery?.length ? gallery : [{ src, alt, previewSrc, originalUrl, downloadUrl }]
  const safeCurrentIndex = clampIndex(currentIndex, viewerItems.length)
  const activeItem = viewerItems[safeCurrentIndex] ?? viewerItems[0] ?? { src, alt, previewSrc }
  const activeAlt = activeItem.alt || alt
  const publicSrc = publicImageUrl(activeItem.src) || activeItem.src
  const requestedPreviewSrc = activeItem.previewSrc ? publicImageUrl(activeItem.previewSrc) || activeItem.previewSrc : null
  const renderPreviewSrc = requestedPreviewSrc || publicImageVariantUrl(publicSrc, 'card') || publicSrc
  const hasExplicitOriginal = Object.prototype.hasOwnProperty.call(activeItem, 'originalUrl')
  const renderOriginalSrc = hasExplicitOriginal
    ? publicImageUrl(activeItem.originalUrl) || activeItem.originalUrl || publicSrc
    : publicImageOriginalUrl(publicSrc) || publicSrc
  const isGallery = viewerItems.length > 1

  const clearAutoPlayTimeout = useCallback(() => {
    if (autoPlayTimeoutRef.current !== null) {
      window.clearTimeout(autoPlayTimeoutRef.current)
      autoPlayTimeoutRef.current = null
    }
  }, [])

  const beginInteraction = useCallback(() => {
    clearAutoPlayTimeout()
    if (isInteractingRef.current) return
    isInteractingRef.current = true
    setIsInteracting(true)
  }, [clearAutoPlayTimeout])

  const endInteraction = useCallback(() => {
    if (!isInteractingRef.current) return
    isInteractingRef.current = false
    setIsInteracting(false)
    setAutoPlayResetKey((value) => value + 1)
  }, [])

  const restartAutoPlayTimer = useCallback(() => {
    clearAutoPlayTimeout()
    setAutoPlayResetKey((value) => value + 1)
  }, [clearAutoPlayTimeout])

  function resetTransform() {
    zoomRef.current = 1
    panRef.current = ZERO_POINT
    setZoom(1)
    setPan(ZERO_POINT)
  }

  function resetGestureState() {
    pointersRef.current.clear()
    dragRef.current = null
    pinchRef.current = null
    didDragRef.current = false
  }

  function applyTransform(nextZoom: number, requestedPan = panRef.current) {
    const safeZoom = clampImageViewerZoom(nextZoom)
    const safePan = safeZoom === 1
      ? ZERO_POINT
      : clampImageViewerPan(requestedPan, safeZoom, fitSize, viewportSizeRef.current)
    zoomRef.current = safeZoom
    panRef.current = safePan
    setZoom(safeZoom)
    setPan(safePan)
  }

  function syncImageFit() {
    const viewport = viewportRef.current
    if (!viewport) return
    const nextViewportSize = { width: viewport.clientWidth, height: viewport.clientHeight }
    const nextFitSize = calculateImageViewerFit(naturalSizeRef.current, nextViewportSize)
    viewportSizeRef.current = nextViewportSize
    setFitSize((current) => sameSize(current, nextFitSize) ? current : nextFitSize)
    const nextPan = zoomRef.current === 1
      ? ZERO_POINT
      : clampImageViewerPan(panRef.current, zoomRef.current, nextFitSize, nextViewportSize)
    if (!samePoint(panRef.current, nextPan)) {
      panRef.current = nextPan
      setPan(nextPan)
    }
  }

  function openViewer() {
    clearAutoPlayTimeout()
    const nextIndex = clampIndex(initialIndex, viewerItems.length)
    isInteractingRef.current = false
    setCurrentIndex(nextIndex)
    onIndexChange?.(nextIndex)
    setIsInteracting(false)
    setIsAutoPlaying(autoPlay && viewerItems.length > 1)
    setAutoPlayResetKey((value) => value + 1)
    resetTransform()
    resetGestureState()
    naturalSizeRef.current = ZERO_SIZE
    viewportSizeRef.current = ZERO_SIZE
    setFitSize(ZERO_SIZE)
    setImageState('loading')
    setOpen(true)
    onOpenChange?.(true)
  }

  function close() {
    clearAutoPlayTimeout()
    isInteractingRef.current = false
    setOpen(false)
    setIsInteracting(false)
    setIsAutoPlaying(false)
    resetTransform()
    resetGestureState()
    naturalSizeRef.current = ZERO_SIZE
    viewportSizeRef.current = ZERO_SIZE
    setFitSize(ZERO_SIZE)
    onOpenChange?.(false)
  }

  useEffect(() => {
    if (!open) return
    const documentElement = document.documentElement
    const previousDocumentOverflow = documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      documentElement.style.overflow = previousDocumentOverflow
      document.body.style.overflow = previousBodyOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    const syncVisibility = () => setIsPageVisible(document.visibilityState === 'visible')
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => document.removeEventListener('visibilitychange', syncVisibility)
  }, [])

  useEffect(() => {
    clearAutoPlayTimeout()
    if (!open || !autoPlay || !isGallery || !isAutoPlaying || isInteracting || !isPageVisible) return
    autoPlayTimeoutRef.current = window.setTimeout(() => {
      autoPlayTimeoutRef.current = null
      if (isInteractingRef.current || document.visibilityState !== 'visible') return
      const nextIndex = (safeCurrentIndex + 1) % viewerItems.length
      setCurrentIndex(nextIndex)
      onIndexChange?.(nextIndex)
      resetTransform()
      resetGestureState()
      naturalSizeRef.current = ZERO_SIZE
      viewportSizeRef.current = ZERO_SIZE
      setFitSize(ZERO_SIZE)
      setImageState('loading')
    }, IMAGE_VIEWER_AUTO_PLAY_INTERVAL_MS)
    return clearAutoPlayTimeout
  }, [autoPlay, autoPlayResetKey, clearAutoPlayTimeout, isAutoPlaying, isGallery, isInteracting, isPageVisible, onIndexChange, open, safeCurrentIndex, viewerItems.length])

  useEffect(() => () => clearAutoPlayTimeout(), [clearAutoPlayTimeout])

  useEffect(() => {
    if (!open) return
    const viewport = viewportRef.current
    if (!viewport) return
    syncImageFit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncImageFit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [open, safeCurrentIndex, renderOriginalSrc])

  function goTo(nextIndex: number, reason: 'manual' | 'auto' = 'manual') {
    if (reason === 'manual') restartAutoPlayTimer()
    const nextSafeIndex = reason === 'auto'
      ? (nextIndex % viewerItems.length + viewerItems.length) % viewerItems.length
      : clampIndex(nextIndex, viewerItems.length)
    if (nextSafeIndex === safeCurrentIndex) return
    setCurrentIndex(nextSafeIndex)
    onIndexChange?.(nextSafeIndex)
    resetTransform()
    resetGestureState()
    naturalSizeRef.current = ZERO_SIZE
    viewportSizeRef.current = ZERO_SIZE
    setFitSize(ZERO_SIZE)
    setImageState('loading')
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    beginInteraction()
    event.preventDefault()
    if (pointersRef.current.size === 0) didDragRef.current = false
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is not available in a few embedded WebKit surfaces.
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType })
    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values())
      pinchRef.current = {
        startDistance: pointerDistance(first, second),
        startZoom: zoomRef.current,
        startCenter: pointerCenter(first, second),
        startPan: panRef.current,
      }
      dragRef.current = null
      return
    }
    dragRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startPan: panRef.current,
      moved: false,
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const tracked = pointersRef.current.get(event.pointerId)
    if (!tracked) return
    beginInteraction()
    tracked.x = event.clientX
    tracked.y = event.clientY
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [first, second] = Array.from(pointersRef.current.values())
      const currentDistance = pointerDistance(first, second)
      if (pinchRef.current.startDistance > 0 && currentDistance > 0) {
        const nextZoom = clampImageViewerZoom(pinchRef.current.startZoom * currentDistance / pinchRef.current.startDistance)
        const currentCenter = pointerCenter(first, second)
        applyTransform(nextZoom, {
          x: pinchRef.current.startPan.x + currentCenter.x - pinchRef.current.startCenter.x,
          y: pinchRef.current.startPan.y + currentCenter.y - pinchRef.current.startCenter.y,
        })
        didDragRef.current = true
        event.preventDefault()
      }
      return
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (deltaX !== 0 || deltaY !== 0) drag.moved = true
    if (drag.moved) didDragRef.current = true
    const nextPan = clampImageViewerPan({ x: drag.startPan.x + deltaX, y: drag.startPan.y + deltaY }, zoomRef.current, fitSize, viewportSizeRef.current)
    if (!samePoint(panRef.current, nextPan)) {
      panRef.current = nextPan
      setPan(nextPan)
    }
    event.preventDefault()
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const endedPointer = pointersRef.current.get(event.pointerId)
    const drag = dragRef.current
    const wasPinching = pinchRef.current !== null
    pointersRef.current.delete(event.pointerId)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The pointer may already have been released by the browser.
    }

    if (drag?.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY
      const isTouchSwipe = !wasPinching && isGallery && zoomRef.current === 1 && drag.pointerType !== 'mouse'
      if (isTouchSwipe && Math.abs(deltaX) >= SWIPE_COMMIT_THRESHOLD_PX && Math.abs(deltaX) > Math.abs(deltaY)) {
        didDragRef.current = true
        goTo(safeCurrentIndex + (deltaX < 0 ? 1 : -1))
      } else if (drag.moved) {
        didDragRef.current = true
      }
    } else if (endedPointer && wasPinching) {
      didDragRef.current = true
    }

    pinchRef.current = null
    if (pointersRef.current.size === 1) {
      const [remainingId, remaining] = Array.from(pointersRef.current.entries())[0]
      dragRef.current = {
        pointerId: remainingId,
        pointerType: remaining.pointerType,
        startX: remaining.x,
        startY: remaining.y,
        startPan: panRef.current,
        moved: true,
      }
    } else {
      dragRef.current = null
      pointersRef.current.clear()
      if (endedPointer) endInteraction()
    }
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    beginInteraction()
    event.preventDefault()
    applyTransform(zoomRef.current + (event.deltaY < 0 ? IMAGE_VIEWER_ZOOM_STEP : -IMAGE_VIEWER_ZOOM_STEP))
    endInteraction()
  }

  function handleViewportClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    if (event.currentTarget === event.target) close()
  }

  function handleOriginalLoad(event: SyntheticEvent<HTMLImageElement>) {
    naturalSizeRef.current = {
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    }
    setImageState('loaded')
    syncImageFit()
  }

  function handleOriginalError() {
    setImageState('error')
    onError?.()
  }

  const imageStyle: CSSProperties = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
    transformOrigin: 'center center',
    willChange: 'transform',
    ...(fitSize.width > 0 && fitSize.height > 0
      ? {
          width: `${fitSize.width}px`,
          height: `${fitSize.height}px`,
          maxWidth: 'none',
          maxHeight: 'none',
        }
      : {
          maxWidth: '90vw',
          maxHeight: '90dvh',
        }),
  }

  const viewer = open ? createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${activeAlt}图片查看器`}
      data-auto-playing={isAutoPlaying && !isInteracting && isPageVisible ? 'true' : 'false'}
      className="fixed inset-0 z-[var(--layer-image-viewer)] h-[100dvh] w-[100vw] bg-black/95 text-white"
    >
      <div className="absolute inset-x-0 top-0 z-20 flex min-h-14 items-start justify-between gap-3 border-b border-white/10 bg-black/70 px-3 pb-2 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-3 pt-2">
          <span className="truncate text-xs font-bold text-white/70">{activeAlt}</span>
          {isGallery ? <span className="shrink-0 text-xs font-black text-white/80" aria-live="polite">{safeCurrentIndex + 1} / {viewerItems.length}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isGallery ? <>
            <button type="button" disabled={safeCurrentIndex === 0} onClick={(event) => { event.stopPropagation(); goTo(safeCurrentIndex - 1) }} aria-label="上一张图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl disabled:opacity-40">‹</button>
            <button type="button" disabled={safeCurrentIndex === viewerItems.length - 1} onClick={(event) => { event.stopPropagation(); goTo(safeCurrentIndex + 1) }} aria-label="下一张图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl disabled:opacity-40">›</button>
          </> : null}
          {activeItem.originalUrl ? <a href={activeItem.originalUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center border border-white/20 px-3 text-xs font-black text-white no-underline" onClick={(event) => event.stopPropagation()}>查看原图</a> : null}
          {activeItem.downloadUrl ? <a href={activeItem.downloadUrl} download className="inline-flex min-h-10 items-center border border-white/20 px-3 text-xs font-black text-white no-underline" onClick={(event) => event.stopPropagation()}>下载原图</a> : null}
          <button type="button" onClick={() => { applyTransform(zoomRef.current - IMAGE_VIEWER_ZOOM_STEP); restartAutoPlayTimer() }} aria-label="缩小图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">−</button>
          <button type="button" onClick={() => { applyTransform(1); restartAutoPlayTimer() }} aria-label="恢复适配缩放" className="min-w-16 border border-white/20 px-3 py-2 text-xs font-black" aria-live="polite">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => { applyTransform(zoomRef.current + IMAGE_VIEWER_ZOOM_STEP); restartAutoPlayTimer() }} aria-label="放大图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">+</button>
          <button type="button" onClick={close} aria-label="关闭图片查看器" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">×</button>
        </div>
      </div>
      {isGallery ? <>
        <button type="button" disabled={safeCurrentIndex === 0} onClick={(event) => { event.stopPropagation(); goTo(safeCurrentIndex - 1) }} aria-label="上一张图片" className="absolute left-2 top-1/2 z-20 grid h-12 w-10 -translate-y-1/2 place-items-center border border-white/20 bg-black/40 text-3xl disabled:opacity-30 sm:left-5">‹</button>
        <button type="button" disabled={safeCurrentIndex === viewerItems.length - 1} onClick={(event) => { event.stopPropagation(); goTo(safeCurrentIndex + 1) }} aria-label="下一张图片" className="absolute right-2 top-1/2 z-20 grid h-12 w-10 -translate-y-1/2 place-items-center border border-white/20 bg-black/40 text-3xl disabled:opacity-30 sm:right-5">›</button>
      </> : null}
      <div
        ref={viewportRef}
        data-image-viewer-viewport="true"
        className="absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] top-[calc(4rem+env(safe-area-inset-top))] overflow-hidden overscroll-contain touch-none select-none sm:bottom-4"
        onClick={handleViewportClick}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div className="flex h-full w-full items-center justify-center" onClick={handleViewportClick}>
          {imageState === 'loading' ? <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status"><span className="rounded-full bg-black/60 px-4 py-3 text-sm font-bold text-white/90">图片加载中…</span></div> : null}
          {imageState === 'error' ? <div className="pointer-events-none absolute inset-0 grid place-items-center" role="alert"><span className="rounded-full bg-black/70 px-4 py-3 text-sm font-bold text-white">图片加载失败</span></div> : null}
          {/* The original URL is rendered directly so the viewer never downgrades image quality. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${safeCurrentIndex}:${renderOriginalSrc}`}
            data-image-viewer-image="true"
            data-zoom={zoom}
            src={renderOriginalSrc}
            alt={activeAlt}
            draggable={false}
            decoding="async"
            onLoad={handleOriginalLoad}
            onError={handleOriginalError}
            onDoubleClick={(event) => { event.stopPropagation(); applyTransform(zoomRef.current === 1 ? 2 : 1); restartAutoPlayTimer() }}
            className={`block flex-none select-none object-contain${imageState === 'error' ? ' opacity-0' : ''}`}
            style={imageStyle}
          />
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button type="button" onClick={(event) => { event.stopPropagation(); openViewer() }} className={buttonClassName} aria-label={`查看大图：${alt}`} aria-haspopup="dialog">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={renderPreviewSrc}
          alt={alt}
          draggable={false}
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          onError={onError}
          className={imageClassName}
        />
      </button>
      {viewer}
    </>
  )
}

function clampIndex(value: number | undefined, length: number) {
  if (!length || value === undefined || !Number.isFinite(value)) return 0
  return Math.min(length - 1, Math.max(0, Math.trunc(value)))
}
