'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { HeroBackground } from '@/components/HeroBackground'
import { usePageVisibility } from '@/hooks/usePageVisibility'
import { hasHeroMediaAsset } from '@/lib/hero-visuals'
import { resolveHeroSlideVisual, type SiteHeroSlide, type SiteHeroStyle } from '@/lib/site-config'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'

const defaultHeroTitle = '\u542c\u89c1 Eason\uff0c\u4e5f\u542c\u89c1\u81ea\u5df1'

type HomeHeroCopyInput = Pick<SiteHeroSlide, 'title' | 'subtitle' | 'buttonText' | 'href' | 'showTitle' | 'showSubtitle' | 'showButton'>

export type HomeHeroCopy = Readonly<{
  title: string
  subtitle: string
  buttonText: string
  showTitle: boolean
  showSubtitle: boolean
  showButton: boolean
}>

/** Resolve every slide's copy independently; empty fields never receive a CTA fallback. */
export function resolveHomeHeroCopy(
  active: HomeHeroCopyInput | null | undefined,
  defaultTitle = defaultHeroTitle,
  defaultSubtitle = 'NOW IS THE ONLY REALITY.',
): HomeHeroCopy {
  const hasActiveSlide = Boolean(active)
  const title = (hasActiveSlide ? active?.title : defaultTitle)?.trim() || ''
  const subtitle = (hasActiveSlide ? active?.subtitle : defaultSubtitle)?.trim() || ''
  const buttonText = active?.buttonText?.trim() || ''
  const buttonHref = active?.href?.trim() || ''
  return {
    title,
    subtitle,
    buttonText,
    showTitle: (active?.showTitle !== false) && Boolean(title),
    showSubtitle: (active?.showSubtitle !== false) && Boolean(subtitle),
    showButton: Boolean(active) && active?.showButton !== false && Boolean(buttonText) && Boolean(buttonHref),
  }
}

export function HomeHero({
  slides,
  siteName,
  buttonColor,
  styleConfig,
  visual,
  defaultTitle = defaultHeroTitle,
  defaultSubtitle = 'NOW IS THE ONLY REALITY.',
}: {
  slides: SiteHeroSlide[]
  siteName: string
  buttonColor: string
  styleConfig: SiteHeroStyle
  visual?: SiteHeroVisualConfig | null
  defaultTitle?: string
  defaultSubtitle?: string
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

  const { title, subtitle, buttonText, showTitle, showSubtitle, showButton } = resolveHomeHeroCopy(active, defaultTitle, defaultSubtitle)

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
  const hasHeroCopy = showTitle || showSubtitle || showButton
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
        {showButton ? <div className="community-hero-copy-actions">
          <Link
            href={active?.href || '#community-content'}
            className="hero-primary-button"
            style={{ backgroundColor: buttonColor }}
          >
            {buttonText} <span aria-hidden="true">{String.fromCharCode(0x203a)}</span>
          </Link>
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
