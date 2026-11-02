'use client'

import { useState } from 'react'
import type { SocialPostMediaView } from '@/lib/social-posts'
import { buildHomeAnywhereDoorMediaPreview } from '@/lib/home-anywhere-door-preview'

function HomeAnywhereDoorMediaTile({ media, label, overflowCount = 0, aspectClass }: Readonly<{
  media: SocialPostMediaView
  label: string
  overflowCount?: number
  aspectClass: 'aspect-video' | 'aspect-square'
}>) {
  const [failed, setFailed] = useState(false)
  const isVideo = media.type === 'VIDEO'
  const imageUrl = isVideo ? media.thumbnailUrl : media.url

  return (
    <span className={`relative block ${aspectClass} min-w-0 overflow-hidden bg-slate-100 dark:bg-slate-800`}>
      {!failed && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={isVideo ? `${label} 视频封面` : label} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : !failed && isVideo ? (
        <video
          src={media.url}
          muted
          playsInline
          preload="metadata"
          aria-label={`${label} 视频预览`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center px-2 text-center text-xs font-semibold text-slate-500">媒体预览暂不可用</span>
      )}
      {isVideo ? <span aria-hidden="true" className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-black/70 text-sm text-white shadow">▶</span> : null}
      {overflowCount > 0 ? <span className="absolute inset-0 grid place-items-center bg-black/60 text-xl font-extrabold text-white" aria-label={`还有 ${overflowCount} 项媒体`}>+{overflowCount}</span> : null}
    </span>
  )
}

export function HomeAnywhereDoorMediaPreview({ media, mediaCount, title }: Readonly<{
  media: readonly SocialPostMediaView[]
  mediaCount: number
  title: string
}>) {
  const { items, overflowCount } = buildHomeAnywhereDoorMediaPreview(media, mediaCount)
  if (!items.length) return null
  const gridColumns = items.length === 1 ? 'grid-cols-1' : 'grid-cols-2'

  return (
    <span className={`grid ${gridColumns} gap-1 overflow-hidden`} aria-label={`动态媒体预览，共 ${mediaCount} 项`}>
      {items.map((item, index) => (
        <HomeAnywhereDoorMediaTile
          key={item.id}
          media={item}
          label={`${title} ${item.type === 'VIDEO' ? '视频' : '图片'} ${index + 1}`}
          overflowCount={index === items.length - 1 ? overflowCount : 0}
          aspectClass={items.length === 1 ? 'aspect-video' : 'aspect-square'}
        />
      ))}
    </span>
  )
}
