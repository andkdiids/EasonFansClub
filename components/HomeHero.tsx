'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { HeroBackground } from '@/components/HeroBackground'
import { usePageVisibility } from '@/hooks/usePageVisibility'
import { sortHeroSlides } from '@/lib/hero-order'
import { hasHeroMediaAsset } from '@/lib/hero-visuals'
import { resolveHeroSlideVisual, type SiteHeroSlide, type SiteHeroStyle } from '@/lib/site-config'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'
import type { HomepageFeaturedConcert } from '@/lib/homepage-featured-concert'

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
  featuredConcert,
}: {
  slides: SiteHeroSlide[]
  siteName: string
  buttonColor: string
  styleConfig: SiteHeroStyle
  visual?: SiteHeroVisualConfig | null
  defaultTitle?: string
  defaultSubtitle?: string
  featuredConcert?: HomepageFeaturedConcert | null
}) {
  const visibleSlides = useMemo(
    () => sortHeroSlides(slides.filter((item) => item.isVisible)),
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
    if (featuredConcert || visibleSlides.length <= 1 || !isPageVisible) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % visibleSlides.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [featuredConcert, isPageVisible, visibleSlides.length])

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

  if (featuredConcert) {
    return (
      <section className="community-hero community-concert-hero" aria-label="限时演唱会 Recording Sessions 首页专题">
        <Link href={featuredConcert.href} className="community-concert-hero-link" aria-label={`进入限时演唱会：${featuredConcert.title}`}>
          {featuredConcert.backgroundImageUrl ? <Image
            src={featuredConcert.backgroundImageUrl}
            alt=""
            fill
            sizes="100vw"
            priority
            unoptimized
            className="community-concert-hero-image"
          /> : null}
          <span aria-hidden="true" className="community-concert-hero-overlay" />
          <span className="community-concert-hero-copy">
            <span className="community-concert-hero-kicker">限时演唱会 · Recording Sessions</span>
            <span className="community-concert-hero-title">{featuredConcert.title}</span>
            {featuredConcert.subtitle ? <span className="community-concert-hero-subtitle">{featuredConcert.subtitle}</span> : null}
            <span className="community-concert-hero-date">演出日期　{featuredConcert.dateRangeLabel}</span>
            <span className="hero-primary-button community-concert-hero-cta" style={{ backgroundColor: buttonColor }}>
              进入专题 <span aria-hidden="true">{String.fromCharCode(0x203a)}</span>
            </span>
          </span>
        </Link>
      </section>
    )
  }

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
