'use client'

import { useState } from 'react'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl, type ImageVariant } from '@/lib/image-variants'

export function SafeAvatar({
  src,
  name,
  uid,
  className = 'h-full w-full',
  textClassName = 'text-sm',
  variant = 'avatar-md',
}: {
  src?: string | null
  name: string
  uid?: number | null
  className?: string
  textClassName?: string
  variant?: ImageVariant
}) {
  const [failed, setFailed] = useState(false)
  const originalUrl = profileImageUrl(src)
  const url = failed ? null : publicImageVariantUrl(originalUrl, variant)
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
