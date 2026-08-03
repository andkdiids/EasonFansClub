'use client'

import type { ComponentProps } from 'react'
import { CassetteTape } from '@/components/music/cassette/CassetteTape'
import { cassetteLayoutFor } from '@/lib/music-cassette'
import type { CassetteSong } from '@/types/music-cassette'

type TapePointerBindings = Pick<
  ComponentProps<'button'>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
>

export function CassetteField({
  songs,
  selectedId,
  draggingId,
  onSelect,
  bindDrag,
}: Readonly<{
  songs: CassetteSong[]
  selectedId: string | null
  draggingId: string | null
  onSelect: (song: CassetteSong) => void
  bindDrag: (song: CassetteSong) => TapePointerBindings
}>) {
  return (
    <div className="easmusic-cassette-field" aria-label="随机歌曲磁带">
      {songs.map((song, index) => {
        const layout = cassetteLayoutFor(song.id, index)
        return (
          <CassetteTape
            key={`cassette-slot-${index}`}
            song={song}
            index={index}
            selected={selectedId === song.id}
            muted={Boolean(draggingId && draggingId !== song.id)}
            onSelect={() => onSelect(song)}
            {...layout}
            {...bindDrag(song)}
          />
        )
      })}
    </div>
  )
}
