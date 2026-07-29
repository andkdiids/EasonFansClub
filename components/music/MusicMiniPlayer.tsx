'use client'

import { MusicCover } from '@/components/music/MusicCover'

type MusicMiniPlayerProps = {
  title: string
  artist: string
  coverUrl?: string | null
  playing: boolean
  loading: boolean
  expanded: boolean
  progress: number
  onToggleExpanded: () => void
  onTogglePlayback: () => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

export function MusicMiniPlayer(props: Readonly<MusicMiniPlayerProps>) {
  return (
    <aside className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 z-[65] w-[min(420px,calc(100vw-1.5rem))] border border-sky-200/20 bg-[#07182d]/95 text-white shadow-2xl backdrop-blur-xl md:bottom-5 md:left-5" aria-label="EasMusic 迷你播放器">
      {props.expanded ? (
        <div className="border-b border-white/10 p-3 text-xs text-slate-300">
          60 秒试听 · 完整版请前往各大音乐平台
        </div>
      ) : null}
      <div className="flex min-h-16 items-center gap-3 p-2.5">
        <button type="button" className="min-w-0 flex flex-1 items-center gap-3 text-left" onClick={props.onToggleExpanded}>
          <MusicCover src={props.coverUrl} alt="" className="h-11 w-11 shrink-0" />
          <span className="min-w-0"><strong className="block truncate text-sm">{props.title}</strong><small className="block truncate text-slate-300/65">{props.artist}</small></span>
        </button>
        {props.expanded ? <button type="button" className="h-11 w-11" onClick={props.onPrevious} aria-label="上一首">⏮</button> : null}
        <button type="button" className="h-11 min-w-11" onClick={props.onTogglePlayback} aria-label={props.playing ? '暂停' : '播放'}>{props.loading ? '…' : props.playing ? '⏸' : '▶'}</button>
        {props.expanded ? <button type="button" className="h-11 w-11" onClick={props.onNext} aria-label="下一首">⏭</button> : null}
        <button type="button" className="h-11 w-11 text-slate-300" onClick={props.onClose} aria-label="关闭播放器">×</button>
      </div>
      <div className="h-1 bg-white/10"><div className="h-full bg-sky-300" style={{ width: `${props.progress}%` }} /></div>
    </aside>
  )
}
