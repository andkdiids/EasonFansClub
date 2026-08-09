'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { HeroBackground } from '@/components/HeroBackground'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'
import type { SiteHeroSlide, SiteHeroStyle } from '@/lib/site-config'

const defaultHeroTitle = '\u542c\u89c1 Eason\uff0c\u4e5f\u542c\u89c1\u81ea\u5df1'
const defaultHeroButton = '\u6d4f\u89c8\u4eca\u65e5\u5185\u5bb9'

export function HomeHero({
  slides,
  siteName,
  buttonColor,
  styleConfig,
  fallbackImageUrl,
  visual,
  defaultTitle = defaultHeroTitle,
  defaultSubtitle = 'NOW IS THE ONLY REALITY.',
}: {
  slides: SiteHeroSlide[]
  siteName: string
  buttonColor: string
  styleConfig: SiteHeroStyle
  fallbackImageUrl?: string | null
  visual?: SiteHeroVisualConfig | null
  defaultTitle?: string
  defaultSubtitle?: string
}) {
  const visibleSlides = useMemo(
    () => slides.filter((item) => item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder),
    [slides],
  )
  const [index, setIndex] = useState(0)
  const pointerStartX = useRef<number | null>(null)
  const active = visibleSlides[index] || visibleSlides[0] || null

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(visibleSlides.length - 1, 0)))
  }, [visibleSlides.length])

  useEffect(() => {
    if (visibleSlides.length <= 1) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % visibleSlides.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [visibleSlides.length])

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

  const activeMediaType = active?.mediaType || 'IMAGE'
  const activeMediaUrl = active?.mediaUrl || (activeMediaType === 'IMAGE' ? active?.imageUrl || '' : '')
  const backgroundVisual = activeMediaUrl
    ? ({
        ...visual,
        key: 'home',
        title: visual?.title || 'Home Hero',
        imageUrl: activeMediaType === 'IMAGE' ? activeMediaUrl : active?.imageUrl || visual?.imageUrl || '',
        mediaType: activeMediaType,
        mediaUrl: activeMediaUrl,
        posterUrl: active?.posterUrl || (activeMediaType === 'VIDEO' ? active?.imageUrl : '') || visual?.posterUrl || '',
        desktopPositionX: visual?.desktopPositionX ?? 50,
        desktopPositionY: visual?.desktopPositionY ?? 50,
        mobilePositionX: visual?.mobilePositionX ?? 50,
        mobilePositionY: visual?.mobilePositionY ?? 50,
        desktopScale: visual?.desktopScale ?? 100,
        mobileScale: visual?.mobileScale ?? 100,
        desktopFitMode: visual?.desktopFitMode ?? 'COVER',
        mobileFitMode: visual?.mobileFitMode ?? 'COVER',
        sourceUrl: visual?.sourceUrl || '',
        posterSourceUrl: visual?.posterSourceUrl || '',
        enabled: true,
        focusPoint: visual?.focusPoint ?? null,
        updatedAt: visual?.updatedAt || '',
      } satisfies SiteHeroVisualConfig)
    : visual
  const hasBackground = Boolean(
    (backgroundVisual?.enabled ?? true)
    && (backgroundVisual?.mediaUrl || backgroundVisual?.imageUrl || backgroundVisual?.posterUrl || fallbackImageUrl),
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
      <HeroBackground visual={backgroundVisual} fallbackImageUrl={fallbackImageUrl} priority />
      {!hasBackground ? <div className="community-hero-fallback" /> : null}
      <div className="community-hero-overlay" />
      <div aria-live="polite" className="community-hero-copy">
        <p>WELCOME HOME</p>
        <h1>{siteName}</h1>
        <h2>{title}</h2>
        <p className="hero-slogan">{subtitle}</p>
        <em>C{String.fromCharCode(0x2019)}mon in~</em>
        <Link
          href={active?.href || '#community-content'}
          className="hero-primary-button"
          style={{ backgroundColor: buttonColor }}
        >
          {buttonText} <span aria-hidden="true">{String.fromCharCode(0x203a)}</span>
        </Link>
      </div>
      {visibleSlides.length > 1 ? (
        <div className="absolute bottom-5 right-5 z-10 flex gap-2 sm:bottom-8 sm:right-8" aria-label="Hero controls">
          <button type="button" aria-label="Previous Hero" onClick={previous} className="hero-icon-button">{String.fromCharCode(0x2039)}</button>
          <button type="button" aria-label="Next Hero" onClick={next} className="hero-icon-button">{String.fromCharCode(0x203a)}</button>
        </div>
      ) : null}
    </section>
  )
}
