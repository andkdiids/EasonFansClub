import { MusicCover } from '@/components/music/MusicCover'

type MusicPlayerProps = {
  title: string
  artist: string
  coverUrl?: string | null
  sourceType?: string | null
}

export function MusicPlayer({ title, artist, coverUrl, sourceType }: Readonly<MusicPlayerProps>) {
  return (
    <section aria-label="播放入口（框架）" className="rounded-[30px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-4">
        <MusicCover src={coverUrl} alt={`${title}封面`} className="h-20 w-20 shrink-0 rounded-2xl sm:h-24 sm:w-24" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black tracking-[0.16em] text-brand-700">播放入口（框架）</p>
          <h2 className="mt-1 truncate text-xl font-black text-brand-950 sm:text-2xl">{title}</h2>
          <p className="mt-1 truncate text-sm font-bold text-slate-500">{artist}</p>
        </div>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-sky-100"><div className="h-full w-0 rounded-full bg-brand-500" /></div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button type="button" disabled aria-label="上一首，暂不可用" className="grid h-10 w-10 place-items-center rounded-full bg-sky-50 font-black text-slate-400 disabled:cursor-not-allowed">‹</button>
        <button type="button" disabled aria-label="播放，暂不可用" className="grid h-12 w-12 place-items-center rounded-full bg-brand-950 text-lg text-white opacity-65 disabled:cursor-not-allowed">▶</button>
        <button type="button" disabled aria-label="下一首，暂不可用" className="grid h-10 w-10 place-items-center rounded-full bg-sky-50 font-black text-slate-400 disabled:cursor-not-allowed">›</button>
      </div>
      <p className="mt-4 text-center text-xs font-bold leading-5 text-slate-500">
        本阶段不连接音频。未来可接入 netease、qq、apple 或 custom 来源{sourceType ? `；当前预留类型：${sourceType}` : ''}。
      </p>
    </section>
  )
}
