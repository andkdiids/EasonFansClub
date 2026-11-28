'use client'

import type { MouseEvent as ReactMouseEvent } from 'react'

/**
 * The concentric-ring mark that Apple uses for a Live Photo. The camera glyph
 * it replaces read as "video" and was mistaken for a play button.
 */
export function LivePhotoIcon({ className = '' }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      {/* Outer ring is dotted so the mark stays legible at 12–14px. */}
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.4 2.2" strokeLinecap="round" opacity="0.85" />
      <circle cx="12" cy="12" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export type LivePhotoBadgeProps = Readonly<{
  playing?: boolean
  onToggle?: () => void
  className?: string
  /** Rendered only when the badge is interactive. */
  label?: string
  as?: 'button' | 'span'
}>

/**
 * Single source of truth for the LIVE marker. Playable badges are buttons;
 * covers that cannot play (no clip, or a viewer that does not support it yet)
 * still get the same visual, just non-interactive.
 */
export function LivePhotoBadge({
  playing = false,
  onToggle,
  className = '',
  label = '播放实况照片',
  as = 'button',
}: LivePhotoBadgeProps) {
  const content = (
    <>
      <LivePhotoIcon />
      <span>LIVE</span>
    </>
  )
  const classes = `live-photo-badge${playing ? ' is-playing' : ''}${className ? ` ${className}` : ''}`

  if (as === 'span' || !onToggle) {
    return <span className={classes} aria-hidden="true">{content}</span>
  }

  return (
    <button
      type="button"
      className={classes}
      aria-label={playing ? '停止播放实况照片' : label}
      aria-pressed={playing}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        // The badge is often rendered inside a card link. Without
        // preventDefault the anchor still navigates even though React's
        // synthetic bubbling was stopped.
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
    >
      {content}
    </button>
  )
}
