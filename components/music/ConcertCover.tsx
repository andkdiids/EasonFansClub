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
 * Keeps concert artwork in a square frame without stretching or cropping the
 * source poster. The blurred copy fills the frame while the foreground copy
 * preserves the complete original artwork.
 */
export function ConcertCover({ src, alt, sizes, className = '', fallbackLabel = 'LIVE' }: Readonly<ConcertCoverProps>) {
  const [failed, setFailed] = useState(false)
  const imageSrc = src?.trim() || null

  return <span className={`concert-cover ${className}`.trim()}>
    {imageSrc && !failed ? <>
      <span className="concert-cover-backdrop" aria-hidden="true">
        <Image src={imageSrc} alt="" fill sizes={sizes} className="concert-cover-backdrop-image" onError={() => setFailed(true)} />
      </span>
      <span className="concert-cover-backdrop-shade" aria-hidden="true" />
      <Image src={imageSrc} alt={alt} fill sizes={sizes} className="concert-cover-foreground" onError={() => setFailed(true)} />
    </> : <span className="concert-cover-fallback" role="img" aria-label={alt}>{fallbackLabel}</span>}
  </span>
}
