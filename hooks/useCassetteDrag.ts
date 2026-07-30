'use client'

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { CassetteSong } from '@/types/music-cassette'

type DragPoint = { x: number; y: number }

type DragOptions = {
  deckRef: RefObject<HTMLElement | null>
  disabled: boolean
  onDrop: (song: CassetteSong) => void
  onDragState: (songId: string | null, overDeck: boolean) => void
  onDragPoint: (point: DragPoint | null) => void
}

type DragSession = {
  pointerId: number
  song: CassetteSong
  element: HTMLElement
  startX: number
  startY: number
  started: boolean
  overDeck: boolean
}

export function useCassetteDrag({ deckRef, disabled, onDrop, onDragState, onDragPoint }: DragOptions) {
  const sessionRef = useRef<DragSession | null>(null)
  const frameRef = useRef(0)

  const reset = useCallback(() => {
    const session = sessionRef.current
    window.cancelAnimationFrame(frameRef.current)
    if (session) {
      session.element.style.removeProperty('--cassette-drag-x')
      session.element.style.removeProperty('--cassette-drag-y')
      session.element.removeAttribute('data-dragging')
    }
    sessionRef.current = null
    onDragPoint(null)
    onDragState(null, false)
  }, [onDragPoint, onDragState])

  useEffect(() => reset, [reset])

  const bind = useCallback((song: CassetteSong) => ({
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
      const element = event.currentTarget
      element.setPointerCapture(event.pointerId)
      sessionRef.current = {
        pointerId: event.pointerId,
        song,
        element,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        overDeck: false,
      }
    },
    onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const session = sessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      const deltaX = event.clientX - session.startX
      const deltaY = event.clientY - session.startY
      if (!session.started && Math.hypot(deltaX, deltaY) < 5) return
      event.preventDefault()
      if (!session.started) {
        session.started = true
        session.element.dataset.dragging = 'true'
        onDragState(song.id, false)
      }
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        onDragPoint({ x: event.clientX, y: event.clientY })
      })
      const rect = deckRef.current?.getBoundingClientRect()
      const overDeck = Boolean(
        rect
        && event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom,
      )
      if (overDeck !== session.overDeck) {
        session.overDeck = overDeck
        onDragState(song.id, overDeck)
      }
    },
    onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
      const session = sessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      const shouldInsert = session.started && session.overDeck
      reset()
      if (shouldInsert) onDrop(song)
    },
    onPointerCancel() {
      reset()
    },
  }), [deckRef, disabled, onDragPoint, onDragState, onDrop, reset])

  return { bind, cancelDrag: reset }
}
