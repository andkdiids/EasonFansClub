'use client'

import { useState } from 'react'
import { profileImageUrl } from '@/lib/images'

export function SafeAvatar({
  src,
  name,
  uid,
  className = 'h-full w-full',
  textClassName = 'text-sm',
}: {
  src?: string | null
  name: string
  uid?: number | null
  className?: string
  textClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  const url = failed ? null : profileImageUrl(src)
  const fallback = uid !== undefined && uid !== null
    ? String(uid).padStart(5, '0').slice(0, 1)
    : 'E'

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
