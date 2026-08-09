'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { publicImageUrl } from '@/lib/images'

type ConcertCoverProps = {
  src?: string | null
  resolvedPosterUrl?: string | null
  alt: string
  sizes: string
  className?: string
  fallbackLabel?: string
  priority?: boolean
}

/**
 * Keeps concert artwork in a square frame without stretching the source
 * poster. The foreground fills the card and crops only the overflow, while
 * the blurred copy remains available as a visual fallback layer.
 */
export function ConcertCover({ src, resolvedPosterUrl, alt, sizes, className = '', fallbackLabel = '海报暂缺', priority = false }: Readonly<ConcertCoverProps>) {
  const frameRef = useRef<HTMLSpanElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [shouldLoad, setShouldLoad] = useState(priority)
  const imageSrc = getRenderableImageSource(resolvedPosterUrl !== undefined ? resolvedPosterUrl : src)

  useEffect(() => {
    setShouldLoad(priority)
    if (priority) return
    const frame = frameRef.current
    if (!frame || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setShouldLoad(true)
      observer.disconnect()
    }, { rootMargin: '240px 0px' })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [priority, imageSrc])

  const loadedImageSrc = shouldLoad ? imageSrc : null

  return <span ref={frameRef} className={`concert-cover ${className}`.trim()} data-concert-cover-loaded={loadedImageSrc && !failed ? 'true' : 'false'}>
    {loadedImageSrc && !failed ? <>
      <span className="concert-cover-backdrop" aria-hidden="true">
        <Image src={loadedImageSrc} alt="" fill sizes={sizes} loading="lazy" className="concert-cover-backdrop-image" onError={() => setFailed(true)} />
      </span>
      <span className="concert-cover-backdrop-shade" aria-hidden="true" />
      <Image src={loadedImageSrc} alt={alt} fill priority={priority} loading={priority ? undefined : 'lazy'} sizes={sizes} className="concert-cover-foreground" style={{ objectFit: 'cover', objectPosition: 'center center' }} onError={() => setFailed(true)} />
    </> : <span className="concert-cover-fallback" role="img" aria-label={alt}>{fallbackLabel}</span>}
  </span>
}

function getRenderableImageSource(value?: string | null) {
  const url = publicImageUrl(value)
  if (!url) return null
  if (url.startsWith('/')) return url

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    if (!parsed.hostname.endsWith('.supabase.co') && !parsed.hostname.endsWith('.myqcloud.com')) return null
    return url
  } catch {
    return null
  }
}
