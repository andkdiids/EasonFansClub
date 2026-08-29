'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { HeroBackground } from '@/components/HeroBackground'
import { usePageVisibility } from '@/hooks/usePageVisibility'
import { hasHeroMediaAsset } from '@/lib/hero-visuals'
import { resolveHeroSlideVisual, type SiteHeroSlide, type SiteHeroStyle } from '@/lib/site-config'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'

const defaultHeroTitle = '\u542c\u89c1 Eason\uff0c\u4e5f\u542c\u89c1\u81ea\u5df1'
const defaultHeroButton = '\u6d4f\u89c8\u4eca\u65e5\u5185\u5bb9'

export function HomeHero({
  slides,
  siteName,
  buttonColor,
  styleConfig,
  visual,
  defaultTitle = defaultHeroTitle,
  defaultSubtitle = 'NOW IS THE ONLY REALITY.',
  shareAction,
}: {
  slides: SiteHeroSlide[]
  siteName: string
  buttonColor: string
  styleConfig: SiteHeroStyle
  visual?: SiteHeroVisualConfig | null
  defaultTitle?: string
  defaultSubtitle?: string
  shareAction?: ReactNode
}) {
  const visibleSlides = useMemo(
    () => slides.filter((item) => item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder),
    [slides],
  )
  const isPageVisible = usePageVisibility()
  const [index, setIndex] = useState(0)
  const pointerStartX = useRef<number | null>(null)
  const active = visibleSlides[index] || visibleSlides[0] || null

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(visibleSlides.length - 1, 0)))
  }, [visibleSlides.length])

  useEffect(() => {
    if (visibleSlides.length <= 1 || !isPageVisible) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % visibleSlides.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [isPageVisible, visibleSlides.length])

  const title = active?.title || defaultTitle
  const subtitle = active?.subtitle || defaultSubtitle
  const buttonText = active?.buttonText || defaultHeroButton

  function previous() {
    setIndex((current) => (current - 1 + visibleSlides.length) % visibleSlides.length)
  }

  function next() {
    setIndex((current) => (current + 1) % visibleSlides.length)
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    pointerStartX.current = event.clientX
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    const startX = pointerStartX.current
    pointerStartX.current = null
    if (startX === null || visibleSlides.length <= 1) return
    const distance = event.clientX - startX
    if (Math.abs(distance) < 42) return
    if (distance < 0) next()
    else previous()
  }

  const backgroundVisual = resolveHeroSlideVisual(visual, active)
  const showTitle = active?.showTitle !== false
  const showSubtitle = active?.showSubtitle !== false
  const showButton = active?.showButton !== false
  const hasHeroCopy = showTitle || showSubtitle || showButton || Boolean(shareAction)
  const hasBackground = Boolean(
    (backgroundVisual?.enabled ?? true)
    && (hasHeroMediaAsset(backgroundVisual?.desktopHeroMedia) || hasHeroMediaAsset(backgroundVisual?.mobileHeroMedia)),
  )

  return (
    <section
      data-hero-height={styleConfig.height}
      data-hero-title-size={styleConfig.titleSize}
      aria-roledescription="carousel"
      aria-label="Home Hero carousel"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStartX.current = null }}
      className="community-hero"
      style={{ touchAction: 'pan-y' }}
    >
      <HeroBackground visual={backgroundVisual} priority />
      {!hasBackground ? <div className="community-hero-fallback" /> : null}
      <div className="community-hero-overlay" />
      {hasHeroCopy ? <div aria-live="polite" className="community-hero-copy">
        {showTitle ? <>
          <h1>{siteName}</h1>
          <h2>{title}</h2>
        </> : null}
        {showSubtitle ? <>
          <p className="hero-slogan">{subtitle}</p>
          <em>C{String.fromCharCode(0x2019)}mon in~</em>
        </> : null}
        {showButton || shareAction ? <div className="community-hero-copy-actions">
          {showButton ? <Link
            href={active?.href || '#community-content'}
            className="hero-primary-button"
            style={{ backgroundColor: buttonColor }}
          >
            {buttonText} <span aria-hidden="true">{String.fromCharCode(0x203a)}</span>
          </Link> : null}
          {shareAction}
        </div> : null}
      </div> : null}
      {visibleSlides.length > 1 ? (
        <div className="absolute bottom-5 right-5 z-10 flex gap-2 sm:bottom-8 sm:right-8" aria-label="Hero controls">
          <button type="button" aria-label="Previous Hero" onClick={previous} className="hero-icon-button">{String.fromCharCode(0x2039)}</button>
          <button type="button" aria-label="Next Hero" onClick={next} className="hero-icon-button">{String.fromCharCode(0x203a)}</button>
        </div>
      ) : null}
    </section>
  )
}
