'use client'

import { MusicCover } from '@/components/music/MusicCover'
import {
  type MusicPreviewTrack,
  useMusicPlayer,
} from '@/components/music/MusicPlayerProvider'

type MusicPlayerProps = {
  id: string
  title: string
  artist: string
  albumName?: string | null
  coverUrl?: string | null
  sourceType?: string | null
  previewUrl?: string | null
  previewDuration?: number | null
  isFullPlayback?: boolean
  queue?: MusicPreviewTrack[]
}

export function MusicPlayer({
  id,
  title,
  artist,
  albumName,
  coverUrl,
  sourceType,
  previewUrl,
  previewDuration = 60,
  isFullPlayback = false,
  queue,
}: Readonly<MusicPlayerProps>) {
  const player = useMusicPlayer()
  const duration = isFullPlayback
    ? Math.max(1, previewDuration || 60)
    : Math.max(1, Math.min(60, previewDuration || 60))
  const active = player.track?.id === id
  const elapsed = active ? player.elapsed : 0
  const playing = active && player.playing

  async function togglePlayback() {
    if (!previewUrl) return
    await player.playTrack({
      id,
      songId: id,
      title,
      artist,
      albumName,
      coverUrl,
      previewUrl,
      previewDuration: duration,
      isFullPlayback,
    }, queue)
  }

  return (
    <section aria-label="歌曲试听" className="rounded-[30px] border border-white/10 bg-white/[0.06] p-5 shadow-[0_24px_70px_rgba(2,12,27,.2)] backdrop-blur-xl sm:p-6">
      <div className="flex items-center gap-4">
        <MusicCover src={coverUrl} alt={`${title}封面`} className="h-20 w-20 shrink-0 rounded-2xl sm:h-24 sm:w-24" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black tracking-[0.16em] text-sky-300/65">最长 60 秒试听</p>
          <h2 className="mt-1 truncate text-xl font-black text-white sm:text-2xl">{title}</h2>
          <p className="mt-1 truncate text-sm font-bold text-slate-300/60">{albumName || artist}</p>
        </div>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-sky-300 transition-[width]" style={{ width: `${Math.min(100, elapsed / duration * 100)}%` }} />
      </div>
      <div className="mt-4 flex items-center justify-center">
        <button
          type="button"
          disabled={!previewUrl || (active && player.loading)}
          onClick={() => void togglePlayback()}
          aria-label={previewUrl ? playing ? '暂停试听' : '播放 60 秒试听' : '暂无试听片段'}
          className="easmusic-preview-button grid h-12 min-w-28 place-items-center rounded-full bg-white px-5 text-sm font-black text-brand-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previewUrl ? active && player.loading ? '加载中…' : playing ? '暂停' : '播放试听' : '暂无试听'}
        </button>
      </div>
      <p className="mt-4 text-center text-xs font-bold leading-5 text-slate-300/50">
        {previewUrl
          ? '本站仅提供最长 60 秒试听片段。若需收听完整版，请前往各大音乐平台。'
          : `尚未上传试听片段${sourceType ? `；当前来源类型：${sourceType}` : ''}。`}
      </p>
    </section>
  )
}
