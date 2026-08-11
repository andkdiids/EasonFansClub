'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type TouchEvent, type WheelEvent } from 'react'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

export function ImageViewer({
  src,
  alt,
  imageClassName = 'h-auto max-h-[32rem] w-full object-contain',
  buttonClassName = 'block w-full cursor-zoom-in overflow-hidden bg-slate-100 text-left',
}: Readonly<{
  src: string
  alt: string
  imageClassName?: string
  buttonClassName?: string
}>) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const pinchDistanceRef = useRef<number | null>(null)
  const pinchZoomRef = useRef(1)

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
  }

  function getTouchDistance(event: TouchEvent) {
    const [first, second] = Array.from(event.touches)
    if (!first || !second) return null
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
  }

  function onTouchStart(event: TouchEvent) {
    const distance = getTouchDistance(event)
    if (!distance) return
    pinchDistanceRef.current = distance
    pinchZoomRef.current = zoom
  }

  function onTouchMove(event: TouchEvent) {
    const distance = getTouchDistance(event)
    if (!distance || !pinchDistanceRef.current) return
    event.preventDefault()
    setZoom(clampZoom(pinchZoomRef.current * distance / pinchDistanceRef.current))
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault()
    setZoom((current) => clampZoom(current + (event.deltaY < 0 ? 0.15 : -0.15)))
  }

  const viewer = open ? createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt}图片查看器`}
      className="fixed inset-0 z-[var(--layer-image-viewer)] bg-black/95 text-white"
    >
      <div className="absolute inset-x-0 top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-white/10 bg-black/70 px-3 backdrop-blur sm:px-5">
        <span className="truncate text-xs font-bold text-white/70">{alt}</span>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setZoom((value) => clampZoom(value - 0.25))} aria-label="缩小图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">−</button>
          <button type="button" onClick={() => setZoom(1)} aria-label="恢复原始缩放" className="min-w-16 border border-white/20 px-3 py-2 text-xs font-black">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => setZoom((value) => clampZoom(value + 0.25))} aria-label="放大图片" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">+</button>
          <button type="button" onClick={close} aria-label="关闭图片查看器" className="grid h-10 w-10 place-items-center border border-white/20 text-xl">×</button>
        </div>
      </div>
      <div
        className="h-full w-full overflow-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-16 sm:px-6"
        onClick={(event) => { if (event.currentTarget === event.target) close() }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => { pinchDistanceRef.current = null }}
      >
        <div className="flex min-h-full min-w-full items-start justify-center py-4">
          {/* The original URL is rendered directly so the viewer never downgrades image quality. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            onDoubleClick={() => setZoom((value) => value === 1 ? 2 : 1)}
            className="h-auto select-none object-contain"
            style={zoom === 1 ? { maxWidth: '100%' } : { width: `${zoom * 100}%`, maxWidth: 'none' }}
          />
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClassName} aria-label={`查看大图：${alt}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} draggable={false} className={imageClassName} />
      </button>
      {viewer}
    </>
  )
}
