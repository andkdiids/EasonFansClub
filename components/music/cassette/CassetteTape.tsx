'use client'

import type { CSSProperties, PointerEventHandler } from 'react'
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
    <span className="easmusic-tape-shell">

  <img
    src="/images/cassette/cassette-transparent.png"
    alt=""
    className="easmusic-tape-image"
  />

<span className="easmusic-tape-copy">
  <strong>{song.title}</strong>
</span>


<b className="easmusic-tape-side">
  A
</b>

<b className="easmusic-tape-number">
  {String(index + 1).padStart(2, '0')}
</b>

<span className="easmusic-tape-brand">
  ECFC · EASMUSIC ARCHIVE
</span>

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
