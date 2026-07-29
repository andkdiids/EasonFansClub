'use client'

import { useRef, useState } from 'react'
import { MusicCover } from '@/components/music/MusicCover'

type MusicPlayerProps = {
  title: string
  artist: string
  coverUrl?: string | null
  sourceType?: string | null
  previewUrl?: string | null
  previewDuration?: number | null
}

export function MusicPlayer({
  title,
  artist,
  coverUrl,
  sourceType,
  previewUrl,
  previewDuration = 7,
}: Readonly<MusicPlayerProps>) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const duration = Math.max(1, Math.min(7, previewDuration || 7))

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio || !previewUrl) return
    if (!audio.paused) {
      audio.pause()
      setPlaying(false)
      return
    }
    if (audio.currentTime >= duration) audio.currentTime = 0
    try {
      await audio.play()
      setPlaying(true)
    } catch {
      setPlaying(false)
    }
  }

  function stopAtPreviewEnd() {
    const audio = audioRef.current
    if (!audio) return
    const next = Math.min(audio.currentTime, duration)
    setElapsed(next)
    if (audio.currentTime < duration) return
    audio.pause()
    audio.currentTime = 0
    setElapsed(0)
    setPlaying(false)
  }

  return (
    <section aria-label="歌曲试听" className="rounded-[30px] border border-white/10 bg-white/[0.06] p-5 shadow-[0_24px_70px_rgba(2,12,27,.2)] backdrop-blur-xl sm:p-6">
      <div className="flex items-center gap-4">
        <MusicCover src={coverUrl} alt={`${title}封面`} className="h-20 w-20 shrink-0 rounded-2xl sm:h-24 sm:w-24" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black tracking-[0.16em] text-sky-300/65">7 秒试听</p>
          <h2 className="mt-1 truncate text-xl font-black text-white sm:text-2xl">{title}</h2>
          <p className="mt-1 truncate text-sm font-bold text-slate-300/60">{artist}</p>
        </div>
      </div>
      {previewUrl ? (
        <audio
          ref={audioRef}
          src={previewUrl}
          preload="none"
          loop={false}
          onTimeUpdate={stopAtPreviewEnd}
          onEnded={() => { setElapsed(0); setPlaying(false) }}
        />
      ) : null}
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-sky-300 transition-[width]" style={{ width: `${Math.min(100, elapsed / duration * 100)}%` }} />
      </div>
      <div className="mt-4 flex items-center justify-center">
        <button
          type="button"
          disabled={!previewUrl}
          onClick={() => void togglePlayback()}
          aria-label={previewUrl ? playing ? '暂停试听' : '播放 7 秒试听' : '暂无试听片段'}
          className="grid h-12 min-w-28 place-items-center rounded-full bg-white px-5 text-sm font-black text-[#07182d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previewUrl ? playing ? '暂停' : '播放试听' : '暂无试听'}
        </button>
      </div>
      <p className="mt-4 text-center text-xs font-bold leading-5 text-slate-300/50">
        {previewUrl ? `试听将在 ${duration} 秒后自动停止，不会循环播放。` : `尚未上传试听片段${sourceType ? `；当前来源类型：${sourceType}` : ''}。`}
      </p>
    </section>
  )
}
