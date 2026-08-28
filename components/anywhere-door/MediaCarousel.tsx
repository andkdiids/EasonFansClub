'use client'

import { useEffect, useState } from 'react'
import type { SocialPostMediaView } from '@/lib/social-posts'

export function MediaCarousel({ media, title, priority = false }: Readonly<{ media: SocialPostMediaView[]; title: string; priority?: boolean }>) {
  const [index, setIndex] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)
  const current = media[index] || media[0]
  useEffect(() => setVideoFailed(false), [current?.id])
  if (!current) return <div className="grid aspect-square place-items-center bg-slate-100 text-sm font-bold text-slate-400">暂无媒体</div>

  function move(offset: number) {
    setIndex((value) => (value + offset + media.length) % media.length)
  }

  return (
    <div className="relative overflow-hidden rounded-[24px] bg-slate-100" aria-label="动态媒体轮播">
      <div className="flex aspect-square items-center justify-center sm:aspect-[4/3]">
        {current.type === 'VIDEO' && !videoFailed ? (
          <video
            key={current.id}
            src={current.url}
            poster={current.thumbnailUrl || undefined}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
            aria-label={`${title} 视频`}
            onError={() => setVideoFailed(true)}
          />
        ) : current.type === 'VIDEO' && current.thumbnailUrl ? (
          // A Mock fixture may intentionally omit a binary video; keep its
          // verified poster visible instead of showing a broken media box.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.thumbnailUrl} alt={`${title} 视频封面`} className="h-full w-full object-contain" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt={`${title} 图片 ${index + 1}`} className="h-full w-full object-contain" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" />
        )}
      </div>
      {media.length > 1 ? (
        <>
          <button type="button" onClick={() => move(-1)} aria-label="上一项" className="absolute left-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl font-black text-white backdrop-blur">‹</button>
          <button type="button" onClick={() => move(1)} aria-label="下一项" className="absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-xl font-black text-white backdrop-blur">›</button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/35 px-2.5 py-1.5 backdrop-blur" aria-label={`${index + 1}/${media.length}`}>
            {media.map((item, itemIndex) => <button key={item.id} type="button" onClick={() => setIndex(itemIndex)} aria-label={`第 ${itemIndex + 1} 项`} className={`size-1.5 rounded-full ${itemIndex === index ? 'bg-white' : 'bg-white/45'}`} />)}
          </div>
        </>
      ) : null}
      <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white backdrop-blur">{current.type}</span>
    </div>
  )
}
