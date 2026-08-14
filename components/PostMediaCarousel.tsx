'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import { publicImageVariantUrl } from '@/lib/image-variants'

const CONTROL_HIDE_DELAY_MS = 2_200

export type PostMediaCarouselItem = {
  id: string
  url: string
  broken?: boolean
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  startScrollLeft: number
  horizontal: boolean
  moved: boolean
}

function MediaFallback({ position }: Readonly<{ position: number }>) {
  return (
    <div className="post-media-carousel-fallback" role="img" aria-label={`第 ${position} 张图片加载失败`}>
      <span>图片加载失败</span>
      <small>仍可继续浏览下一张</small>
    </div>
  )
}

export function PostMediaCarousel({ items }: Readonly<{ items: PostMediaCarouselItem[] }>) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(items.length > 1)
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set())
  const viewportRef = useRef<HTMLDivElement>(null)
  const hideControlsTimerRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const itemsKey = items.map((item) => `${item.id}:${item.url}:${item.broken ? 'broken' : 'ok'}`).join('|')

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current)
      hideControlsTimerRef.current = null
    }
  }, [])

  const showControls = useCallback(() => {
    if (items.length <= 1) return
    setControlsVisible(true)
    clearHideControlsTimer()
    hideControlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
      hideControlsTimerRef.current = null
    }, CONTROL_HIDE_DELAY_MS)
  }, [clearHideControlsTimer, items.length])

  const updateCurrentIndex = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !viewport.clientWidth || items.length <= 1) return
    const nextIndex = Math.min(items.length - 1, Math.max(0, Math.round(viewport.scrollLeft / viewport.clientWidth)))
    setCurrentIndex((current) => current === nextIndex ? current : nextIndex)
  }, [items.length])

  useEffect(() => {
    setCurrentIndex(0)
    setFailedImageIds(new Set())
    viewportRef.current?.scrollTo({ left: 0, behavior: 'auto' })
  }, [itemsKey])

  useEffect(() => {
    if (items.length <= 1) return undefined
    showControls()
    return () => clearHideControlsTimer()
  }, [clearHideControlsTimer, items.length, itemsKey, showControls])

  useEffect(() => () => {
    clearHideControlsTimer()
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current)
  }, [clearHideControlsTimer])

  const handleScroll = useCallback(() => {
    showControls()
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      updateCurrentIndex()
    })
  }, [showControls, updateCurrentIndex])

  function scrollToIndex(nextIndex: number, event?: React.MouseEvent<HTMLButtonElement>) {
    event?.preventDefault()
    event?.stopPropagation()
    const safeIndex = Math.min(items.length - 1, Math.max(0, nextIndex))
    if (safeIndex === currentIndex && !viewportRef.current?.scrollLeft) {
      showControls()
      return
    }
    showControls()
    setCurrentIndex(safeIndex)
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTo({ left: safeIndex * viewport.clientWidth, behavior: 'smooth' })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (items.length <= 1 || (event.pointerType === 'mouse' && event.button !== 0)) return
    showControls()
    suppressClickRef.current = false
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: event.currentTarget.scrollLeft,
      horizontal: false,
      moved: false,
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.horizontal) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        dragRef.current = null
        return
      }
      drag.horizontal = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
    drag.moved = true
    suppressClickRef.current = true
    event.currentTarget.scrollLeft = drag.startScrollLeft - deltaX
    showControls()
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.horizontal && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      updateCurrentIndex()
    }
    dragRef.current = null
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    suppressClickRef.current = false
  }

  function handleClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    showControls()
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }

  function markImageFailed(id: string) {
    setFailedImageIds((current) => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      return next
    })
    showControls()
  }

  if (!items.length) return null

  const isMultiImage = items.length > 1
  const controlsClassName = `post-media-carousel-controls${controlsVisible ? ' is-visible' : ''}`
  const counterClassName = `post-media-carousel-counter${controlsVisible ? ' is-visible' : ''}`

  return (
    <div
      className={`post-media-carousel${isMultiImage ? ' post-media-carousel-multiple' : ' post-media-carousel-single'}`}
      role={isMultiImage ? 'region' : undefined}
      aria-roledescription={isMultiImage ? 'carousel' : undefined}
      aria-label={isMultiImage ? `帖子图片，共 ${items.length} 张` : undefined}
      onMouseEnter={isMultiImage ? showControls : undefined}
    >
      <div
        ref={viewportRef}
        className="post-media-carousel-viewport"
        onScroll={isMultiImage ? handleScroll : undefined}
        onPointerDown={isMultiImage ? handlePointerDown : undefined}
        onPointerMove={isMultiImage ? handlePointerMove : undefined}
        onPointerUp={isMultiImage ? finishPointerDrag : undefined}
        onPointerCancel={isMultiImage ? handlePointerCancel : undefined}
        onClickCapture={isMultiImage ? handleClickCapture : undefined}
        onWheel={isMultiImage ? showControls : undefined}
      >
        <div className="post-media-carousel-track">
          {items.map((item, index) => {
            const failed = item.broken || failedImageIds.has(item.id)
            const previewSrc = publicImageVariantUrl(item.url, index === currentIndex ? 'large' : 'card') || item.url
            return (
              <div key={item.id} className="post-media-carousel-slide" aria-hidden={isMultiImage && index !== currentIndex}>
                {failed ? (
                  <MediaFallback position={index + 1} />
                ) : (
                  <ImageViewer
                    src={item.url}
                    previewSrc={previewSrc}
                    alt={`帖子图片 ${index + 1}`}
                    loading={index <= currentIndex + 1 ? 'eager' : 'lazy'}
                    fetchPriority={index === currentIndex ? 'high' : 'low'}
                    onError={() => markImageFailed(item.id)}
                    buttonClassName="post-media-carousel-image-button"
                    imageClassName="post-media-carousel-image"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      {isMultiImage ? (
        <span className={counterClassName} aria-live="polite" aria-hidden={!controlsVisible}>
          {currentIndex + 1}/{items.length}
        </span>
      ) : null}
      {isMultiImage ? (
        <div className={controlsClassName} aria-hidden={!controlsVisible}>
          {currentIndex > 0 ? (
            <button
              type="button"
              className="post-media-carousel-arrow post-media-carousel-arrow-previous"
              onClick={(event) => scrollToIndex(currentIndex - 1, event)}
              aria-label="上一张图片"
              tabIndex={controlsVisible ? 0 : -1}
            >
              ‹
            </button>
          ) : null}
          {currentIndex < items.length - 1 ? (
            <button
              type="button"
              className="post-media-carousel-arrow post-media-carousel-arrow-next"
              onClick={(event) => scrollToIndex(currentIndex + 1, event)}
              aria-label="下一张图片"
              tabIndex={controlsVisible ? 0 : -1}
            >
              ›
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
