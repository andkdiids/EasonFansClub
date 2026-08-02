'use client'

import Image from 'next/image'
import { useState } from 'react'

type ConcertCoverProps = {
  src?: string | null
  alt: string
  sizes: string
  className?: string
  fallbackLabel?: string
}

/**
 * Keeps concert artwork in a square frame without stretching the source
 * poster. The foreground fills the card and crops only the overflow, while
 * the blurred copy remains available as a visual fallback layer.
 */
export function ConcertCover({ src, alt, sizes, className = '', fallbackLabel = '海报暂缺' }: Readonly<ConcertCoverProps>) {
  const [failed, setFailed] = useState(false)
  const imageSrc = src?.trim() || null

  return <span className={`concert-cover ${className}`.trim()}>
    {imageSrc && !failed ? <>
      <span className="concert-cover-backdrop" aria-hidden="true">
        <Image src={imageSrc} alt="" fill sizes={sizes} className="concert-cover-backdrop-image" onError={() => setFailed(true)} />
      </span>
      <span className="concert-cover-backdrop-shade" aria-hidden="true" />
      <Image src={imageSrc} alt={alt} fill sizes={sizes} className="concert-cover-foreground" style={{ objectFit: 'cover', objectPosition: 'center center' }} onError={() => setFailed(true)} />
    </> : <span className="concert-cover-fallback" role="img" aria-label={alt}>{fallbackLabel}</span>}
  </span>
}
