import type { CSSProperties } from 'react'
import { publicImageUrl } from '@/lib/images'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'

type HeroBackgroundProps = {
  visual?: SiteHeroVisualConfig | null
  fallbackImageUrl?: string | null
  className?: string
  priority?: boolean
  positionMode?: 'responsive' | 'desktop' | 'mobile'
}

type HeroBackgroundStyle = CSSProperties & {
  '--hero-position-desktop': string
  '--hero-position-mobile': string
}

export function HeroBackground({ visual, fallbackImageUrl, className = '', priority = false, positionMode = 'responsive' }: Readonly<HeroBackgroundProps>) {
  if (visual && !visual.enabled) return null
  const imageUrl = publicImageUrl(visual?.imageUrl)
  if (!imageUrl) return null
  const desktopPosition = `${visual?.desktopPositionX ?? 50}% ${visual?.desktopPositionY ?? 50}%`
  const mobilePosition = `${visual?.mobilePositionX ?? 50}% ${visual?.mobilePositionY ?? 50}%`
  const style: HeroBackgroundStyle = {
    backgroundImage: `url("${imageUrl.replaceAll('"', '%22')}")`,
    '--hero-position-desktop': desktopPosition,
    '--hero-position-mobile': mobilePosition,
  }

  return <div
    aria-hidden="true"
    data-hero-background={visual?.key || 'fallback'}
    data-desktop-position={desktopPosition}
    data-mobile-position={mobilePosition}
    data-priority={priority ? 'true' : undefined}
    className={`hero-background ${positionMode === 'desktop' ? 'hero-background-force-desktop' : ''} ${positionMode === 'mobile' ? 'hero-background-force-mobile' : ''} ${className}`}
    style={style}
  />
}
