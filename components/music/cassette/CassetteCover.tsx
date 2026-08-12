'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { toPublicMediaUrl } from '@/lib/media-url'

const CASSETTE_COVER_PLACEHOLDER_SRC = '/easmusic/album-cover-placeholder.svg'

type CassetteCoverProps = Readonly<{
  src?: string | null
  alt: string
  sizes: string
  className?: string
  priority?: boolean
}>

export function CassetteCover({ src, alt, sizes, className, priority = false }: CassetteCoverProps) {
  const normalizedSrc = toPublicMediaUrl(src)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  useEffect(() => {
    setFailedSrc(null)
  }, [normalizedSrc])

  const showingOriginal = normalizedSrc !== null && failedSrc !== normalizedSrc
  const imageSrc = showingOriginal ? normalizedSrc : CASSETTE_COVER_PLACEHOLDER_SRC

  return (
    <Image
      src={imageSrc}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      className={className}
      onError={showingOriginal ? () => setFailedSrc(normalizedSrc) : undefined}
    />
  )
}
