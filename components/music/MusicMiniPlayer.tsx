'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { MusicCover } from '@/components/music/MusicCover'

type MiniPlayerPosition = { x: number; y: number }

type MusicMiniPlayerProps = {
  title: string
  artist: string
  coverUrl?: string | null
  playing: boolean
  loading: boolean
  expanded: boolean
  collapsed: boolean
  position: MiniPlayerPosition | null
  progress: number
  onToggleExpanded: () => void
  onToggleCollapsed: () => void
  onPositionChange: (position: MiniPlayerPosition) => void
  onTogglePlayback: () => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

const PLAYER_EDGE_GAP = 12
const DRAG_THRESHOLD = 5

type DragState = {
  pointerId: number
  pointerStartX: number
  pointerStartY: number
  offsetX: number
  offsetY: number
  startX: number
  startY: number
  width: number
  height: number
  position: MiniPlayerPosition
  moved: boolean
}

export function MusicMiniPlayer(props: Readonly<MusicMiniPlayerProps>) {
  const playerRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pendingTransformRef = useRef<{ x: number; y: number } | null>(null)
  const frameRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const { collapsed, expanded, position, onPositionChange } = props

  const clampPosition = useCallback((next: MiniPlayerPosition, size?: { width: number; height: number }): MiniPlayerPosition => {
    const rect = size ? null : playerRef.current?.getBoundingClientRect()
    const width = size?.width || rect?.width || Math.min(420, window.innerWidth - PLAYER_EDGE_GAP * 2)
    const height = size?.height || rect?.height || (collapsed ? 72 : 150)
    return {
      x: Math.min(Math.max(PLAYER_EDGE_GAP, next.x), Math.max(PLAYER_EDGE_GAP, window.innerWidth - width - PLAYER_EDGE_GAP)),
      y: Math.min(Math.max(PLAYER_EDGE_GAP, next.y), Math.max(PLAYER_EDGE_GAP, window.innerHeight - height - PLAYER_EDGE_GAP)),
    }
  }, [collapsed])

  useEffect(() => {
    if (!position) return
    const clamp = () => {
      if (dragRef.current) return
      const next = clampPosition(position)
      if (next.x !== position.x || next.y !== position.y) onPositionChange(next)
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [clampPosition, expanded, onPositionChange, position])

  const applyPendingTransform = useCallback(() => {
    frameRef.current = null
    const offset = pendingTransformRef.current
    const element = playerRef.current
    if (!offset || !element) return
    element.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`
  }, [])

  const scheduleTransform = useCallback((offset: { x: number; y: number }) => {
    pendingTransformRef.current = offset
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(applyPendingTransform)
  }, [applyPendingTransform])

  const flushTransform = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    applyPendingTransform()
  }, [applyPendingTransform])

  useLayoutEffect(() => {
    if (!dragRef.current && !dragging) playerRef.current?.style.removeProperty('transform')
  }, [dragging, position])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    const playerElement = playerRef.current
    if (!playerElement) return
    const rect = playerElement.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: rect.left,
      startY: rect.top,
      width: rect.width,
      height: rect.height,
      position: { x: rect.left, y: rect.top },
      moved: false,
    }
    pendingTransformRef.current = { x: 0, y: 0 }
    playerElement.style.removeProperty('transform')
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.pointerStartX
    const deltaY = event.clientY - drag.pointerStartY
    if (!drag.moved && Math.hypot(deltaX, deltaY) <= DRAG_THRESHOLD) return
    const justStarted = !drag.moved
    drag.moved = true
    const next = clampPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    }, drag)
    drag.position = next
    scheduleTransform({ x: next.x - drag.startX, y: next.y - drag.startY })
    if (justStarted) setDragging(true)
    event.preventDefault()
  }

  function finishPointer(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      const next = event.type === 'pointercancel'
        ? drag.position
        : clampPosition({
            x: event.clientX - drag.offsetX,
            y: event.clientY - drag.offsetY,
          }, drag)
      drag.position = next
      pendingTransformRef.current = { x: next.x - drag.startX, y: next.y - drag.startY }
      flushTransform()
      onPositionChange(next)
    } else {
      pendingTransformRef.current = null
    }
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const positionStyle = props.position
    ? { left: `${props.position.x}px`, top: `${props.position.y}px`, right: 'auto', bottom: 'auto' }
    : undefined

  return (
    <aside
      ref={playerRef}
      style={positionStyle}
      className={`easmusic-mini-player fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 z-[65] w-[min(420px,calc(100vw-1.5rem))] border border-sky-200/20 bg-[#07182d]/95 text-white shadow-2xl backdrop-blur-xl md:bottom-5 md:left-5 ${dragging ? 'is-dragging' : ''}`}
      aria-label="EasMusic 迷你播放器"
    >
      {props.collapsed ? (
        <div className="flex min-h-14 items-center gap-2 p-2">
          <button
            type="button"
            className="easmusic-player-drag-handle grid h-10 w-7 shrink-0 place-items-center text-slate-300/70"
            aria-label="拖动播放器"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
          >
            <span aria-hidden>⋮⋮</span>
          </button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={props.onToggleCollapsed}>
            <MusicCover src={props.coverUrl} alt="" className="h-9 w-9 shrink-0" />
            <span className="min-w-0"><strong className="block truncate text-xs">{props.title}</strong><small className="block truncate text-slate-300/65">{props.artist}</small></span>
          </button>
          <button type="button" className="h-10 min-w-10" onClick={props.onTogglePlayback} aria-label={props.playing ? '暂停' : '播放'}>
            {props.loading ? '…' : props.playing ? 'Ⅱ' : '▶'}
          </button>
          <button type="button" className="easmusic-player-close-button h-10 min-w-10 shrink-0 text-slate-300" onPointerDown={(event) => event.stopPropagation()} onClick={props.onClose} aria-label="关闭播放器">×</button>
        </div>
      ) : (
        <>
          <div className="flex min-h-8 items-center gap-2 border-b border-white/10 px-2">
            <button
              type="button"
              className="easmusic-player-drag-handle grid h-7 w-8 place-items-center text-slate-300/70"
              aria-label="拖动播放器"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
            >
              <span aria-hidden>⋮⋮</span>
            </button>
            <span className="min-w-0 flex-1 truncate text-[10px] font-black tracking-[0.16em] text-slate-300/65">EasMusic</span>
            <button type="button" className="h-8 px-2 text-[11px] font-black text-slate-300" onClick={props.onToggleCollapsed}>收起</button>
          </div>
          {props.expanded ? (
            <div className="border-b border-white/10 p-3 text-xs text-slate-300">
              60 秒试听 · 完整版请前往各大音乐平台
            </div>
          ) : null}
          <div className="flex min-h-16 items-center gap-3 p-2.5">
            <button type="button" className="min-w-0 flex flex-1 items-center gap-3 text-left" onClick={props.onToggleExpanded}>
              <MusicCover src={props.coverUrl} alt="" className="h-11 w-11 shrink-0" />
              <span className="min-w-0"><strong className="block truncate text-sm">{props.title}</strong><small className="block truncate text-slate-300/65">{props.artist}</small></span>
            </button>
            {props.expanded ? <button type="button" className="h-11 w-11" onClick={props.onPrevious} aria-label="上一首">‹</button> : null}
            <button type="button" className="h-11 min-w-11" onClick={props.onTogglePlayback} aria-label={props.playing ? '暂停' : '播放'}>{props.loading ? '…' : props.playing ? 'Ⅱ' : '▶'}</button>
            {props.expanded ? <button type="button" className="h-11 w-11" onClick={props.onNext} aria-label="下一首">›</button> : null}
            <button type="button" className="easmusic-player-close-button h-11 w-11 text-slate-300" onPointerDown={(event) => event.stopPropagation()} onClick={props.onClose} aria-label="关闭播放器">×</button>
          </div>
        </>
      )}
      <div className="h-1 bg-white/10"><div className="h-full bg-sky-300" style={{ width: `${props.progress}%` }} /></div>
    </aside>
  )
}
