'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { SiteHeroSlide, SiteHeroStyle } from '@/lib/site-config'

const titleClasses: Record<SiteHeroStyle['titleSize'], string> = {
  small: 'text-3xl sm:text-4xl', medium: 'text-4xl sm:text-5xl', large: 'text-4xl sm:text-5xl md:text-6xl', 'extra-large': 'text-5xl sm:text-6xl md:text-7xl',
}
const descriptionClasses: Record<SiteHeroStyle['descriptionSize'], string> = {
  small: 'text-sm leading-6', medium: 'text-base leading-7 sm:text-lg sm:leading-8', large: 'text-lg leading-8 sm:text-xl sm:leading-9',
}
const buttonClasses: Record<SiteHeroStyle['buttonSize'], string> = {
  small: 'px-5 py-2.5 text-xs', medium: 'px-6 py-3 text-sm sm:px-7 sm:py-3.5', large: 'px-8 py-4 text-base',
}
const heightClasses: Record<SiteHeroStyle['height'], string> = {
  compact: 'home-hero-compact px-6 py-8 sm:px-10', standard: 'home-hero-standard px-7 py-11 sm:px-12 sm:py-14', spacious: 'home-hero-spacious px-7 py-14 sm:px-14 sm:py-20',
}
const radiusClasses: Record<SiteHeroStyle['radius'], string> = {
  small: 'rounded-[20px]', medium: 'rounded-[28px]', large: 'rounded-[36px]',
}

export function HomeHero({
  slides,
  siteName,
  buttonColor,
  styleConfig,
}: {
  slides: SiteHeroSlide[]
  siteName: string
  buttonColor: string
  styleConfig: SiteHeroStyle
}) {
  const visibleSlides = useMemo(
    () => slides.filter((item) => item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder),
    [slides],
  )
  const [index, setIndex] = useState(0)
  const active = visibleSlides[index] || visibleSlides[0]
  const title = active?.title || '听见 Eason，也听见自己。'
  const subtitle = active?.subtitle || '帖子、留言、音乐，慢慢说。'
  const buttonText = active?.buttonText || '开始挂号'

  useEffect(() => {
    if (visibleSlides.length <= 1) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % visibleSlides.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [visibleSlides.length])

  if (!active) return null
  function previous() {
    setIndex((current) => (current - 1 + visibleSlides.length) % visibleSlides.length)
  }

  function next() {
    setIndex((current) => (current + 1) % visibleSlides.length)
  }

  return (
    <section data-hero-height={styleConfig.height} className={`home-hero ${radiusClasses[styleConfig.radius]} relative overflow-hidden bg-gradient-to-br from-sky-100 via-white to-cyan-50 shadow-2xl shadow-sky-900/10`}>
      {active.imageUrl ? (
        <img src={active.imageUrl} alt={title} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(56,189,248,0.32),transparent_34%),linear-gradient(135deg,#eff9ff,#ffffff_48%,#dff5ff)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/62 to-white/10" />
      <div className={`${heightClasses[styleConfig.height]} relative z-10 flex h-full max-w-3xl flex-col justify-center pr-20 sm:pr-28`}>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 sm:text-sm sm:tracking-[0.28em]">{siteName}</p>
        <h1 className={`${titleClasses[styleConfig.titleSize]} mt-3 text-balance font-black leading-tight text-slate-950 sm:mt-4`}>
          {title}
        </h1>
        <p className={`${descriptionClasses[styleConfig.descriptionSize]} mt-3 max-w-xl text-balance font-bold text-slate-600 sm:mt-4`}>{subtitle}</p>
        <div className="mt-6 sm:mt-7">
          <Link
            href={active.href || '/checkin'}
            className={`${buttonClasses[styleConfig.buttonSize]} inline-flex rounded-full font-black text-white shadow-xl shadow-sky-900/10 transition hover:-translate-y-0.5`}
            style={{ backgroundColor: buttonColor }}
          >
            {buttonText}
          </Link>
        </div>
      </div>
      {visibleSlides.length > 1 ? (
        <div className="absolute bottom-5 right-5 z-20 flex gap-2 sm:bottom-8 sm:right-8 sm:gap-3">
          <button type="button" aria-label="上一张" onClick={previous} className="grid h-10 w-10 place-items-center rounded-full bg-white/80 text-xl font-black text-brand-950 shadow-sm backdrop-blur sm:h-12 sm:w-12 sm:text-2xl">
            &lt;
          </button>
          <button type="button" aria-label="下一张" onClick={next} className="grid h-10 w-10 place-items-center rounded-full bg-white/80 text-xl font-black text-brand-950 shadow-sm backdrop-blur sm:h-12 sm:w-12 sm:text-2xl">
            &gt;
          </button>
        </div>
      ) : null}
    </section>
  )
}
