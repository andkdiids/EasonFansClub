'use client'

import type { CSSProperties, PointerEventHandler } from 'react'
import { MusicCover } from '@/components/music/MusicCover'
import type { CassetteSong } from '@/types/music-cassette'

type CassetteTapeProps = {
  song: CassetteSong
  index: number
  selected: boolean
  muted: boolean
  rotate: number
  offsetX: number
  offsetY: number
  onSelect: () => void
  onPointerDown?: PointerEventHandler<HTMLButtonElement>
  onPointerMove?: PointerEventHandler<HTMLButtonElement>
  onPointerUp?: PointerEventHandler<HTMLButtonElement>
  onPointerCancel?: PointerEventHandler<HTMLButtonElement>
}

export function CassetteTapeVisual({ song, index }: Readonly<{ song: CassetteSong; index: number }>) {
  return (
    <>
      <span className="easmusic-tape-shell" aria-hidden="true">
        <MusicCover src={song.coverUrl} alt="" sizes="48px" className="easmusic-tape-sticker" />
        <i className="easmusic-tape-reel is-left" />
        <i className="easmusic-tape-reel is-right" />
        <b>{String(index + 1).padStart(2, '0')}</b>
      </span>
      <span className="easmusic-tape-copy">
        <strong>{song.title}</strong>
        <small>{song.albumTitle}</small>
      </span>
    </>
  )
}

export function CassetteTape({
  song,
  index,
  selected,
  muted,
  rotate,
  offsetX,
  offsetY,
  onSelect,
  ...pointerHandlers
}: Readonly<CassetteTapeProps>) {
  const style = {
    '--cassette-rotate': `${rotate}deg`,
    '--cassette-offset-x': `${offsetX}px`,
    '--cassette-offset-y': `${offsetY}px`,
  } as CSSProperties

  return (
    <button
      type="button"
      className="easmusic-tape"
      data-cassette-index={index}
      data-selected={selected ? 'true' : 'false'}
      data-muted={muted ? 'true' : 'false'}
      style={style}
      aria-pressed={selected}
      aria-label={`选择磁带：${song.title}，专辑 ${song.albumTitle}`}
      onClick={onSelect}
      {...pointerHandlers}
    >
      <CassetteTapeVisual song={song} index={index} />
    </button>
  )
}
