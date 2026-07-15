'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
import type { SiteHeroSlide } from '@/lib/site-config'

export function HomeHero({
  slides,
  siteName,
  buttonColor,
  density = 'normal',
}: {
  slides: SiteHeroSlide[]
  siteName: string
  buttonColor: string
  density?: PageLayoutModuleDensity
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
  const isCompact = density !== 'normal'
  const isMinimal = density === 'minimal'

  function previous() {
    setIndex((current) => (current - 1 + visibleSlides.length) % visibleSlides.length)
  }

  function next() {
    setIndex((current) => (current + 1) % visibleSlides.length)
  }

  return (
    <section className={`${isMinimal ? 'rounded-[20px]' : isCompact ? 'rounded-[28px]' : 'rounded-[36px]'} relative h-full min-h-0 overflow-hidden bg-gradient-to-br from-sky-100 via-white to-cyan-50 shadow-2xl shadow-sky-900/10`}>
      {active.imageUrl ? (
        <img src={active.imageUrl} alt={title} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(56,189,248,0.32),transparent_34%),linear-gradient(135deg,#eff9ff,#ffffff_48%,#dff5ff)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/62 to-white/10" />
      <div className={`${isMinimal ? 'px-4 py-3' : isCompact ? 'px-4 py-3 md:px-6' : 'px-8 py-8 md:px-14'} relative z-10 flex h-full min-h-0 max-w-3xl flex-col justify-center`}>
        <p className={`${isMinimal ? 'text-[9px] tracking-[0.1em]' : isCompact ? 'text-[10px] tracking-[0.14em]' : 'text-sm tracking-[0.28em]'} font-black uppercase text-sky-700`}>{siteName}</p>
        <h1 className={`${isMinimal ? 'mt-1 text-lg leading-tight sm:text-2xl' : isCompact ? 'mt-1 text-xl leading-tight sm:text-2xl md:text-3xl' : 'mt-4 text-4xl leading-tight sm:text-5xl md:text-6xl'} text-balance font-black text-slate-950`}>
          {title}
        </h1>
        <p className={`${isMinimal ? 'mt-1 max-w-md text-[11px] leading-4' : isCompact ? 'mt-1 max-w-lg text-xs leading-4' : 'mt-4 max-w-xl text-lg leading-8'} text-balance font-bold text-slate-600`}>{subtitle}</p>
        <div className={isMinimal ? 'mt-2' : isCompact ? 'mt-2' : 'mt-7'}>
          <Link
            href={active.href || '/checkin'}
            className={`${isMinimal ? 'px-3 py-1.5 text-[11px]' : isCompact ? 'px-3 py-1.5 text-xs' : 'px-7 py-4 text-sm'} rounded-full font-black text-white shadow-xl shadow-sky-900/10 transition hover:-translate-y-0.5`}
            style={{ backgroundColor: buttonColor }}
          >
            {buttonText}
          </Link>
        </div>
      </div>
      {visibleSlides.length > 1 ? (
        <div className={`${isMinimal ? 'bottom-3 right-3 gap-1.5' : isCompact ? 'bottom-4 right-4 gap-2' : 'bottom-8 right-8 gap-3'} absolute z-20 flex`}>
          <button type="button" onClick={previous} className={`${isMinimal ? 'h-8 w-8 text-base' : isCompact ? 'h-9 w-9 text-xl' : 'h-12 w-12 text-2xl'} grid place-items-center rounded-full bg-white/75 font-black text-brand-950 shadow-sm backdrop-blur`}>
            &lt;
          </button>
          <button type="button" onClick={next} className={`${isMinimal ? 'h-8 w-8 text-base' : isCompact ? 'h-9 w-9 text-xl' : 'h-12 w-12 text-2xl'} grid place-items-center rounded-full bg-white/75 font-black text-brand-950 shadow-sm backdrop-blur`}>
            &gt;
          </button>
        </div>
      ) : null}
    </section>
  )
}
