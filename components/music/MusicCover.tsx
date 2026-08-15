'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { publicImageVariantUrl, type ImageVariant } from '@/lib/image-variants'

const MUSIC_COVER_PLACEHOLDER_SRC = '/easmusic/album-cover-placeholder.svg'

type MusicCoverProps = {
  src?: string | null
  fallbackSrc?: string | null
  alt: string
  className?: string
  sizes?: string
  variant?: ImageVariant
  priority?: boolean
}

export function MusicCover({ src, fallbackSrc, alt, className = '', sizes = '(max-width: 640px) 100vw, 400px', variant = 'thumb-md', priority = false }: Readonly<MusicCoverProps>) {
  const imageSrc = publicImageVariantUrl(src, variant)
  const normalizedFallbackSrc = publicImageVariantUrl(fallbackSrc, variant)
  const sourceUrls = Array.from(new Set([imageSrc, normalizedFallbackSrc].filter((value): value is string => Boolean(value))))
  const [failedSources, setFailedSources] = useState<string[]>([])

  useEffect(() => {
    setFailedSources([])
  }, [imageSrc, normalizedFallbackSrc])

  const renderSrc = sourceUrls.find((value) => !failedSources.includes(value)) || MUSIC_COVER_PLACEHOLDER_SRC
  const showingPlaceholder = renderSrc === MUSIC_COVER_PLACEHOLDER_SRC

  return <div className={'relative overflow-hidden bg-gradient-to-br from-sky-100 via-white to-brand-100 ' + className} aria-label={showingPlaceholder ? alt + '暂无封面' : undefined}>
    <Image
      src={renderSrc}
      alt={showingPlaceholder ? '' : alt}
      fill
      sizes={sizes}
      priority={priority}
      loading={priority ? undefined : 'lazy'}
      className="object-cover"
      onError={showingPlaceholder ? undefined : () => setFailedSources((current) => current.includes(renderSrc) ? current : [...current, renderSrc])}
    />
  </div>
}
