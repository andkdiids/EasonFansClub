'use client'

import Image from 'next/image'
import { memo, type CSSProperties, type PointerEventHandler } from 'react'
import { CassetteCover } from '@/components/music/cassette/CassetteCover'
import { LedMarqueeText } from '@/components/music/cassette/LedMarqueeText'
import type { CassetteSong } from '@/types/music-cassette'

const CASSETTE_IMAGE_SRC = '/images/cassette/cassette-transparent.webp?v=20260810'
const CASSETTE_IMAGE_SIZES = '(max-width: 767px) 42vw, 240px'

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

export const CassetteTapeVisual = memo(function CassetteTapeVisual({ song, index, priority = index === 0 }: Readonly<{ song: CassetteSong; index: number; priority?: boolean }>) {
  const albumCover = song.coverUrl || null

  return (
    <>
    <span className="easmusic-tape-shell">

  <Image
    src={CASSETTE_IMAGE_SRC}
    alt=""
    fill
    priority={priority}
    sizes={CASSETTE_IMAGE_SIZES}
    className="easmusic-tape-image"
    draggable={false}
  />

  <span className="easmusic-tape-cover">
    <CassetteCover
      src={albumCover}
      alt={`${song.title}专辑封面`}
      sizes="(max-width: 767px) 20px, 32px"
      className="easmusic-tape-cover-image"
      priority={priority}
    />
  </span>

<span className="easmusic-tape-copy">
  <strong><LedMarqueeText text={song.title} /></strong>
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
})


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
