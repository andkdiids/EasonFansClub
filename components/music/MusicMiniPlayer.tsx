import { MusicCover } from '@/components/music/MusicCover'

type MusicMiniPlayerProps = {
  title?: string
  artist?: string
  coverUrl?: string | null
}

export function MusicMiniPlayer({ title = '等待选择歌曲', artist = 'EasMusic', coverUrl }: Readonly<MusicMiniPlayerProps>) {
  return (
    <aside aria-label="迷你播放器框架" className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white/92 p-3 shadow-lg shadow-sky-950/5">
      <MusicCover src={coverUrl} alt={`${title}封面`} className="h-12 w-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-brand-950">{title}</p>
        <p className="truncate text-xs font-bold text-slate-500">{artist} · 播放框架</p>
      </div>
      <button type="button" disabled aria-label="播放，暂不可用" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-950 text-xs text-white opacity-65 disabled:cursor-not-allowed">▶</button>
    </aside>
  )
}
