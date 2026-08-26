'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type TouchEvent, type WheelEvent } from 'react'
import { publicImageOriginalUrl, publicImageVariantUrl } from '@/lib/image-variants'
import { publicImageUrl } from '@/lib/images'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const SWIPE_COMMIT_THRESHOLD_PX = 48

export type ImageViewerItem = {
  src: string
  alt?: string
  previewSrc?: string
}

type ViewerImageState = 'loading' | 'loaded' | 'error'

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

function clampIndex(value: number | undefined, length: number) {
  if (!length || value === undefined || !Number.isFinite(value)) return 0
  return Math.min(length - 1, Math.max(0, Math.trunc(value)))
}

export function ImageViewer({
  src,
  alt,
  previewSrc,
  gallery,
  initialIndex = 0,
  imageClassName = 'h-auto max-h-[32rem] w-full object-contain',
  buttonClassName = 'block w-full cursor-zoom-in overflow-hidden bg-slate-100 text-left',
  loading = 'lazy',
  fetchPriority = 'auto',
  onError,
}: Readonly<{
  src: string
  alt: string
  previewSrc?: string
  gallery?: readonly ImageViewerItem[]
  initialIndex?: number
  imageClassName?: string
  buttonClassName?: string
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
  onError?: () => void
}>) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [currentIndex, setCurrentIndex] = useState(() => clampIndex(initialIndex, gallery?.length || 1))
  const [imageState, setImageState] = useState<ViewerImageState>('loading')
  const pinchDistanceRef = useRef<number | null>(null)
  const pinchZoomRef = useRef(1)
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
  const viewerItems: readonly ImageViewerItem[] = gallery?.length ? gallery : [{ src, alt, previewSrc }]
  const safeCurrentIndex = clampIndex(currentIndex, viewerItems.length)
  const activeItem = viewerItems[safeCurrentIndex] ?? viewerItems[0] ?? { src, alt, previewSrc }
  const activeAlt = activeItem.alt || alt
  const publicSrc = publicImageUrl(activeItem.src) || activeItem.src
  const requestedPreviewSrc = activeItem.previewSrc ? publicImageUrl(activeItem.previewSrc) || activeItem.previewSrc : null
  const renderPreviewSrc = requestedPreviewSrc || publicImageVariantUrl(publicSrc, 'card') || publicSrc
  const renderOriginalSrc = publicImageOriginalUrl(publicSrc) || publicSrc
  const isGallery = viewerItems.length > 1

  function openViewer() {
    setCurrentIndex(clampIndex(initialIndex, viewerItems.length))
    setZoom(1)
    setImageState('loading')
    pinchDistanceRef.current = null
    swipeStartRef.current = null
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function close() {
    setOpen(false)
    setZoom(1)
    pinchDistanceRef.current = null
    swipeStartRef.current = null
  }

  function goTo(nextIndex: number) {
    const nextSafeIndex = clampIndex(nextIndex, viewerItems.length)
    if (nextSafeIndex === safeCurrentIndex) return
    setCurrentIndex(nextSafeIndex)
    setZoom(1)
    setImageState('loading')
    pinchDistanceRef.current = null
    swipeStartRef.current = null
  }

  function getTouchDistance(event: TouchEvent) {
    const [first, second] = Array.from(event.touches)
    if (!first || !second) return null
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
  }

  function onTouchStart(event: TouchEvent) {
    const distance = getTouchDistance(event)
    if (distance) {
      pinchDistanceRef.current = distance
      pinchZoomRef.current = zoom
      swipeStartRef.current = null
      return
    }
    const touch = event.touches[0]
    if (touch) swipeStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function onTouchMove(event: TouchEvent) {
    const distance = getTouchDistance(event)
    if (!distance || !pinchDistanceRef.current) return
    event.preventDefault()
    setZoom(clampZoom(pinchZoomRef.current * distance / pinchDistanceRef.current))
  }

  function onTouchEnd(event: TouchEvent) {
    if (pinchDistanceRef.current !== null) {
      pinchDistanceRef.current = null
      return
    }
    const start = swipeStartRef.current
    const touch = event.changedTouches[0]
    swipeStartRef.current = null
    if (!start || !touch || !isGallery || zoom !== 1) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < SWIPE_COMMIT_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) return
    goTo(safeCurrentIndex + (deltaX < 0 ? 1 : -1))
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault()
    setZoom((current) => clampZoom(current + (event.deltaY < 0 ? 0.15 : -0.15)))
  }

  function handleOriginalLoad() {
    setImageState('loaded')
  }

  function handleOriginalError() {
    setImageState('error')
    onError?.()
  }

  const viewer = open ? createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${activeAlt}图片查看器`}
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
          <button type="button" onClick={() => setZoom((value) => clampZoom(value - 0.25))} aria-label="缩小图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">−</button>
          <button type="button" onClick={() => setZoom(1)} aria-label="恢复原始缩放" className="min-w-16 border border-white/20 px-3 py-2 text-xs font-black">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => setZoom((value) => clampZoom(value + 0.25))} aria-label="放大图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">+</button>
          <button type="button" onClick={close} aria-label="关闭图片查看器" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">×</button>
        </div>
      </div>
      {isGallery ? <>
        <button type="button" disabled={safeCurrentIndex === 0} onClick={(event) => { event.stopPropagation(); goTo(safeCurrentIndex - 1) }} aria-label="上一张图片" className="absolute left-2 top-1/2 z-20 grid h-12 w-10 -translate-y-1/2 place-items-center border border-white/20 bg-black/40 text-3xl disabled:opacity-30 sm:left-5">‹</button>
        <button type="button" disabled={safeCurrentIndex === viewerItems.length - 1} onClick={(event) => { event.stopPropagation(); goTo(safeCurrentIndex + 1) }} aria-label="下一张图片" className="absolute right-2 top-1/2 z-20 grid h-12 w-10 -translate-y-1/2 place-items-center border border-white/20 bg-black/40 text-3xl disabled:opacity-30 sm:right-5">›</button>
      </> : null}
      <div
        className="h-full w-full overflow-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))] touch-pan-y sm:px-6"
        onClick={(event) => { if (event.currentTarget === event.target) close() }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="relative flex min-h-full min-w-full items-center justify-center py-4" onClick={(event) => { if (event.currentTarget === event.target) close() }}>
          {imageState === 'loading' ? <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status"><span className="rounded-full bg-black/60 px-4 py-3 text-sm font-bold text-white/90">图片加载中…</span></div> : null}
          {imageState === 'error' ? <div className="pointer-events-none absolute inset-0 grid place-items-center" role="alert"><span className="rounded-full bg-black/70 px-4 py-3 text-sm font-bold text-white">图片加载失败</span></div> : null}
          {/* The original URL is rendered directly so the viewer never downgrades image quality. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${safeCurrentIndex}:${renderOriginalSrc}`}
            src={renderOriginalSrc}
            alt={activeAlt}
            draggable={false}
            onLoad={handleOriginalLoad}
            onError={handleOriginalError}
            onDoubleClick={() => setZoom((value) => value === 1 ? 2 : 1)}
            className={`h-auto max-h-[90dvh] max-w-[90vw] select-none object-contain${imageState === 'error' ? ' opacity-0' : ''}`}
            style={zoom === 1 ? { maxWidth: '90vw', maxHeight: '90dvh' } : { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: '90dvh' }}
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
          onError={onError}
          className={imageClassName}
        />
      </button>
      {viewer}
    </>
  )
}
