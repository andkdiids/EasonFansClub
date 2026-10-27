'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react'
import { HeroBackground } from '@/components/HeroBackground'
import { usePageVisibility } from '@/hooks/usePageVisibility'
import { sortHeroSlides } from '@/lib/hero-order'
import { hasHeroMediaAsset } from '@/lib/hero-visuals'
import { resolveHeroSlideVisual, type SiteHeroSlide, type SiteHeroStyle } from '@/lib/site-config'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'
import type { HomepageFeaturedConcert } from '@/lib/homepage-featured-concert'
import { createHomepageHeroCarouselSlides, getAdjacentHomepageHeroIndex, getHomepageHeroSwipeDirection } from '@/lib/homepage-hero-carousel'

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
  const carouselSlides = useMemo(
    () => createHomepageHeroCarouselSlides(visibleSlides, featuredConcert),
    [featuredConcert, visibleSlides],
  )
  const isPageVisible = usePageVisibility()
  const [index, setIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isPointerDragging, setIsPointerDragging] = useState(false)
  const [failedConcertImageUrl, setFailedConcertImageUrl] = useState<string | null>(null)
  const pointerStartX = useRef<number | null>(null)
  const swipedRef = useRef(false)
  const active = carouselSlides[index] || carouselSlides[0] || null
  const activeSiteSlide = active?.type === 'site' ? active.slide : null
  const activeConcert = active?.type === 'concert' ? active.concert : null

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(carouselSlides.length - 1, 0)))
  }, [carouselSlides.length])

  useEffect(() => {
    if (carouselSlides.length <= 1 || !isPageVisible || isHovered || isFocused || isPointerDragging) return
    const timer = window.setInterval(() => {
      setIndex((current) => getAdjacentHomepageHeroIndex(current, carouselSlides.length, 1))
    }, 6000)
    return () => window.clearInterval(timer)
  }, [carouselSlides.length, index, isFocused, isHovered, isPageVisible, isPointerDragging])

  const { title, subtitle, buttonText, showTitle, showSubtitle, showButton } = resolveHomeHeroCopy(activeSiteSlide, defaultTitle, defaultSubtitle)

  function previous() {
    setIndex((current) => getAdjacentHomepageHeroIndex(current, carouselSlides.length, -1))
  }

  function next() {
    setIndex((current) => getAdjacentHomepageHeroIndex(current, carouselSlides.length, 1))
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest('button')) return
    pointerStartX.current = event.clientX
    setIsPointerDragging(true)
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    const startX = pointerStartX.current
    pointerStartX.current = null
    setIsPointerDragging(false)
    if (startX === null || carouselSlides.length <= 1) return
    const direction = getHomepageHeroSwipeDirection(event.clientX - startX)
    if (direction === null) return
    swipedRef.current = true
    window.setTimeout(() => { swipedRef.current = false }, 0)
    setIndex((current) => getAdjacentHomepageHeroIndex(current, carouselSlides.length, direction))
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!swipedRef.current) return
    event.preventDefault()
    event.stopPropagation()
    swipedRef.current = false
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFocused(false)
  }

  const backgroundVisual = resolveHeroSlideVisual(visual, activeSiteSlide)
  const hasHeroCopy = showTitle || showSubtitle || showButton
  const hasBackground = activeConcert
    ? Boolean(activeConcert.backgroundImageUrl && failedConcertImageUrl !== activeConcert.backgroundImageUrl)
    : Boolean((backgroundVisual?.enabled ?? true)
      && (hasHeroMediaAsset(backgroundVisual?.desktopHeroMedia) || hasHeroMediaAsset(backgroundVisual?.mobileHeroMedia)))

  return (
    <section
      data-hero-height={styleConfig.height}
      data-hero-title-size={styleConfig.titleSize}
      aria-roledescription="carousel"
      aria-label="首页主视觉轮播"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStartX.current = null; swipedRef.current = false; setIsPointerDragging(false) }}
      onClickCapture={handleClickCapture}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setIsHovered(true) }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setIsHovered(false) }}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={handleBlur}
      className="community-hero"
      style={{ touchAction: 'pan-y' }}
    >
      {activeConcert ? <Link href={activeConcert.href} className="community-concert-hero-link" aria-label={`进入限时演唱会：${activeConcert.title}`}>
        {activeConcert.backgroundImageUrl ? <Image
          src={activeConcert.backgroundImageUrl}
          alt=""
          fill
          sizes="100vw"
          priority={index === 0}
          unoptimized
          className="community-concert-hero-image"
          onError={() => setFailedConcertImageUrl(activeConcert.backgroundImageUrl)}
        /> : null}
        {!hasBackground ? <span aria-hidden="true" className="community-hero-fallback" /> : null}
        <span aria-hidden="true" className="community-concert-hero-overlay" />
        <span className="community-concert-hero-copy">
          <span className="community-concert-hero-kicker">限时演唱会 · Recording Sessions</span>
          <span className="community-concert-hero-title">{activeConcert.title}</span>
          {activeConcert.subtitle ? <span className="community-concert-hero-subtitle">{activeConcert.subtitle}</span> : null}
          <span className="community-concert-hero-date">演出日期　{activeConcert.dateRangeLabel}</span>
          <span className="hero-primary-button community-concert-hero-cta" style={{ backgroundColor: buttonColor }}>
            进入专题 <span aria-hidden="true">{String.fromCharCode(0x203a)}</span>
          </span>
        </span>
      </Link> : <>
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
              href={activeSiteSlide?.href || '#community-content'}
              className="hero-primary-button"
              style={{ backgroundColor: buttonColor }}
            >
              {buttonText} <span aria-hidden="true">{String.fromCharCode(0x203a)}</span>
            </Link>
          </div> : null}
        </div> : null}
      </>}
      {carouselSlides.length > 1 ? (
        <div className="absolute bottom-5 right-5 z-10 flex items-center gap-2 sm:bottom-8 sm:right-8" aria-label="首页主视觉轮播控件">
          <div className="flex items-center gap-1.5" aria-label="选择主视觉">
            {carouselSlides.map((slide, slideIndex) => <button
              key={slide.type === 'concert' ? 'recording-sessions' : `site-${slideIndex}`}
              type="button"
              aria-label={`转到第 ${slideIndex + 1} 张主视觉${slide.type === 'concert' ? '：Recording Sessions' : ''}`}
              aria-current={slideIndex === index ? 'true' : 'false'}
              onClick={() => setIndex(slideIndex)}
              className="homepage-hero-indicator"
            />)}
          </div>
          <button type="button" aria-label="上一张主视觉" onClick={previous} className="hero-icon-button">{String.fromCharCode(0x2039)}</button>
          <button type="button" aria-label="下一张主视觉" onClick={next} className="hero-icon-button">{String.fromCharCode(0x203a)}</button>
        </div>
      ) : null}
    </section>
  )
}
