'use client'

import { useState } from 'react'
import { publicImageUrl } from '@/lib/images'

export function SafeAvatar({
  src,
  name,
  className = 'h-full w-full',
  textClassName = 'text-sm',
}: {
  src?: string | null
  name: string
  className?: string
  textClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  const url = failed ? null : publicImageUrl(src)
  const fallback = name.trim().slice(0, 1).toUpperCase() || 'E'

  if (!url) {
    return <span className={`grid place-items-center bg-brand-950 font-black text-white ${className} ${textClassName}`}>{fallback}</span>
  }

  return (
    <img
      src={url}
      alt={name}
      className={`object-cover ${className}`}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}
