'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { SiteHeroSlide } from '@/lib/site-config'

export function HomeHero({
  slides,
  siteName,
  buttonColor,
}: {
  slides: SiteHeroSlide[]
  siteName: string
  buttonColor: string
}) {
  const visibleSlides = useMemo(
    () => slides.filter((item) => item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder),
    [slides],
  )
  const [index, setIndex] = useState(0)
  const active = visibleSlides[index] || visibleSlides[0]

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
    <section className="relative min-h-[620px] overflow-hidden rounded-[36px] bg-gradient-to-br from-sky-100 via-white to-cyan-50 shadow-2xl shadow-sky-900/10">
      {active.imageUrl ? (
        <img src={active.imageUrl} alt={active.title} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(56,189,248,0.32),transparent_34%),linear-gradient(135deg,#eff9ff,#ffffff_48%,#dff5ff)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/62 to-white/10" />
      <div className="relative z-10 flex min-h-[620px] max-w-3xl flex-col justify-center px-8 py-20 md:px-14">
        <p className="text-sm font-black uppercase tracking-[0.28em] text-sky-700">{siteName}</p>
        <h1 className="mt-5 text-5xl font-black leading-tight text-slate-950 md:text-7xl">{active.title}</h1>
        <p className="mt-6 max-w-xl text-xl font-bold leading-9 text-slate-600">{active.subtitle}</p>
        <div className="mt-9">
          <Link
            href={active.href || '/checkin'}
            className="rounded-full px-7 py-4 text-sm font-black text-white shadow-xl shadow-sky-900/10 transition hover:-translate-y-0.5"
            style={{ backgroundColor: buttonColor }}
          >
            {active.buttonText || '进入'}
          </Link>
        </div>
      </div>
      {visibleSlides.length > 1 ? (
        <div className="absolute bottom-8 right-8 z-20 flex gap-3">
          <button onClick={previous} className="grid h-12 w-12 place-items-center rounded-full bg-white/75 text-2xl font-black text-brand-950 shadow-sm backdrop-blur">
            ‹
          </button>
          <button onClick={next} className="grid h-12 w-12 place-items-center rounded-full bg-white/75 text-2xl font-black text-brand-950 shadow-sm backdrop-blur">
            ›
          </button>
        </div>
      ) : null}
    </section>
  )
}
