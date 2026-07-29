'use client'

import Link from 'next/link'
import { useMusicPlayer, type MusicPreviewTrack } from '@/components/music/MusicPlayerProvider'

type AlbumTrack = MusicPreviewTrack & {
  trackNumber: number
  lyricist?: string | null
  composer?: string | null
  arranger?: string | null
}

export function MusicAlbumTrackList({ songs }: Readonly<{ songs: AlbumTrack[] }>) {
  const player = useMusicPlayer()
  const playable = songs.filter((song) => Boolean(song.previewUrl))

  return (
    <>
      <div className="mt-7 grid gap-3">
        {songs.map((song) => {
          const active = player.track?.id === song.id
          return (
            <article key={song.id} className="group grid grid-cols-[44px_minmax(0,1fr)_auto] gap-x-3 rounded-[22px] border border-white/10 bg-white/[0.055] px-4 py-4 backdrop-blur-md transition duration-300 hover:border-sky-300/25 hover:bg-white/[0.1] sm:grid-cols-[50px_minmax(0,1fr)_minmax(110px,160px)_minmax(110px,160px)_minmax(110px,160px)_auto] sm:items-center sm:px-6">
              <span className="text-sm font-black text-sky-300/65">{String(song.trackNumber).padStart(2, '0')}</span>
              <Link href={`/music/song/${song.id}`} className="truncate text-base font-black text-white group-hover:text-sky-200">{song.title}</Link>
              <span className="col-start-2 mt-2 truncate text-xs font-bold text-slate-300/55 sm:col-start-auto sm:mt-0">作词：{song.lyricist || '待补充'}</span>
              <span className="col-start-2 truncate text-xs font-bold text-slate-300/55 sm:col-start-auto">作曲：{song.composer || '待补充'}</span>
              <span className="col-start-2 truncate text-xs font-bold text-slate-300/55 sm:col-start-auto">编曲：{song.arranger || '待补充'}</span>
              <button
                type="button"
                disabled={!song.previewUrl}
                className="col-start-3 row-span-2 min-h-11 min-w-20 border border-white/15 px-3 text-xs font-black text-white disabled:opacity-45 sm:col-start-auto sm:row-span-1"
                onClick={() => song.previewUrl && void player.playTrack(song, playable)}
              >
                {!song.previewUrl ? '暂无试听' : active && player.playing ? '暂停' : '播放'}
              </button>
            </article>
          )
        })}
      </div>
      <p className="mt-4 text-xs font-bold text-slate-300/55">
        本站仅提供最长 60 秒试听片段。若需收听完整版，请前往各大音乐平台。
      </p>
    </>
  )
}
