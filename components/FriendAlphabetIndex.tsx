'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  FRIEND_DIRECTORY_LETTERS,
  type FriendDirectoryLetter,
} from '@/lib/friend-directory'

export function FriendAlphabetIndex({
  activeLetter,
  onSelect,
}: {
  activeLetter: FriendDirectoryLetter | null
  onSelect: (letter: FriendDirectoryLetter) => void
}) {
  const indexRef = useRef<HTMLElement>(null)
  const [dragging, setDragging] = useState(false)

  function selectAtPointer(clientY: number) {
    const index = indexRef.current
    if (!index) return
    const rect = index.getBoundingClientRect()
    const relativeY = Math.max(0, Math.min(rect.height - 1, clientY - rect.top))
    const indexPosition = Math.min(
      FRIEND_DIRECTORY_LETTERS.length - 1,
      Math.floor((relativeY / Math.max(rect.height, 1)) * FRIEND_DIRECTORY_LETTERS.length),
    )
    onSelect(FRIEND_DIRECTORY_LETTERS[indexPosition])
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    selectAtPointer(event.clientY)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!dragging) return
    event.preventDefault()
    event.stopPropagation()
    selectAtPointer(event.clientY)
  }

  function stopDragging(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }

  return (
    <aside
      ref={indexRef}
      className="friend-alphabet-index"
      aria-label="好友字母索引"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      {FRIEND_DIRECTORY_LETTERS.map((letter) => (
        <button
          key={letter}
          type="button"
          aria-label={`跳转到 ${letter}`}
          aria-current={activeLetter === letter ? 'true' : undefined}
          onClick={() => onSelect(letter)}
        >
          {letter}
        </button>
      ))}
      {dragging ? <span className="friend-alphabet-index-tip" aria-live="polite">{activeLetter || 'A'}</span> : null}
    </aside>
  )
}
