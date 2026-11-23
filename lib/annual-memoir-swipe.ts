import { useRef } from 'react'
import type { TouchEvent } from 'react'

export function memoirSwipeDirection(dx: number, dy: number, elapsed: number): -1 | 0 | 1 {
  if (elapsed >= 500 || Math.abs(dx) < 48 || Math.abs(dx) <= 1.5 * Math.abs(dy)) return 0
  return dx < 0 ? 1 : -1
}

export function useMemoirSwipe(move: (direction: -1 | 1) => void) {
  const touch = useRef<{ x: number; y: number; id: number; time: number } | null>(null)
  return {
    onTouchStart(event: TouchEvent) {
      const point = event.touches[0]
      touch.current = event.touches.length === 1 && point && point.clientX > 24 && point.clientX < innerWidth - 24
        ? { x: point.clientX, y: point.clientY, id: point.identifier, time: event.timeStamp }
        : null
    },
    onTouchCancel() { touch.current = null },
    onTouchEnd(event: TouchEvent) {
      const start = touch.current
      touch.current = null
      const end = start && Array.from(event.changedTouches).find(({ identifier }) => identifier === start.id)
      if (!start || !end || event.touches.length) return
      const direction = memoirSwipeDirection(end.clientX - start.x, end.clientY - start.y, event.timeStamp - start.time)
      if (direction) move(direction)
    },
  }
}
