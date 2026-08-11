'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
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

export function MusicMiniPlayer(props: Readonly<MusicMiniPlayerProps>) {
  const playerRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const { collapsed, expanded, position, onPositionChange } = props

  const clampPosition = useCallback((next: MiniPlayerPosition): MiniPlayerPosition => {
    const rect = playerRef.current?.getBoundingClientRect()
    const width = rect?.width || Math.min(420, window.innerWidth - PLAYER_EDGE_GAP * 2)
    const height = rect?.height || (collapsed ? 72 : 150)
    return {
      x: Math.min(Math.max(PLAYER_EDGE_GAP, next.x), Math.max(PLAYER_EDGE_GAP, window.innerWidth - width - PLAYER_EDGE_GAP)),
      y: Math.min(Math.max(PLAYER_EDGE_GAP, next.y), Math.max(PLAYER_EDGE_GAP, window.innerHeight - height - PLAYER_EDGE_GAP)),
    }
  }, [collapsed])

  useEffect(() => {
    if (!position) return
    const clamp = () => {
      const next = clampPosition(position)
      if (next.x !== position.x || next.y !== position.y) onPositionChange(next)
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [clampPosition, expanded, onPositionChange, position])

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    const rect = playerRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setDragging(true)
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    props.onPositionChange(clampPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    }))
  }

  function finishPointer(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
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
            <button type="button" className="h-11 w-11 text-slate-300" onClick={props.onClose} aria-label="关闭播放器">×</button>
          </div>
        </>
      )}
      <div className="h-1 bg-white/10"><div className="h-full bg-sky-300" style={{ width: `${props.progress}%` }} /></div>
    </aside>
  )
}
