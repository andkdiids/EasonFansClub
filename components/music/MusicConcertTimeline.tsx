'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { ConcertCover } from '@/components/music/ConcertCover'
import { usePageVisibility } from '@/hooks/usePageVisibility'
import { generateArchiveSlug } from '@/lib/music-slug'
import type { ConcertCategoryConfig } from '@/lib/music-concert-category'
import { CONCERT_CATEGORY_ENUM_TO_SLUG } from '@/lib/music-concert-category'

export type ConcertTimelineTour = {
  id: string
  name: string
  category: 'MAIN' | 'SMALL' | 'GUEST'
  categoryId?: string | null
  status?: string
  subtitle?: string | null
  description?: string | null
  posterUrl?: string | null
  resolvedPosterUrl?: string | null
  startDate?: Date | string | null
  endDate?: Date | string | null
  concertCount: number
  cities?: string[]
}

export type ConcertArchiveMyLive = {
  attendedShowCount: number
  attendedTourCount: number
  attendedCityCount: number
  latestAttendedShow: {
    showId: string
    tourId: string
    tourName: string
    city: string
    date: string
  } | null
}

type MyLiveStatus = 'loading' | 'ready' | 'anonymous' | 'error'

type ConcertCategorySlug = string

const FALLBACK_CATEGORY_LABELS: Record<string, { label: string }> = {
  main: { label: '大型演唱会' },
  small: { label: '小型企划' },
  guest: { label: '嘉宾现场' },
}

function formatYear(value: Date | string | null | undefined) {
  if (!value) return 'ARCHIVE'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'ARCHIVE' : String(date.getUTCFullYear())
}

function archiveHref(tour: ConcertTimelineTour, isAdmin = false) {
  const base = `/music/live/tours/${generateArchiveSlug(tour.name)}`
  return isAdmin ? `${base}?preview=1` : base
}

function ArchivePoster({ tour, sizes, square = true, priority = false }: Readonly<{ tour: ConcertTimelineTour; sizes: string; square?: boolean; priority?: boolean }>) {
  return <ConcertCover
    resolvedPosterUrl={tour.resolvedPosterUrl}
    alt={`${tour.name}演唱会海报`}
    sizes={sizes}
    className={`music-concert-gallery-image${square ? ' is-square' : ''}`}
    priority={priority}
  />
}

function OrbitPoster({ tour, hidden, onOpen, cardRef, priority = false }: Readonly<{ tour: ConcertTimelineTour; hidden?: boolean; onOpen: (tour: ConcertTimelineTour) => void; cardRef: (element: HTMLElement | null) => void; priority?: boolean }>) {
  const year = formatYear(tour.startDate)
  const draft = tour.status && tour.status !== 'PUBLISHED'
  return <article ref={cardRef} className="music-concert-gallery-poster" aria-hidden={hidden || undefined}>
    <button data-testid="concert-orbit-card" type="button" tabIndex={hidden ? -1 : undefined} className="music-concert-gallery-poster-button" aria-label={`展开《${tour.name}》演唱会档案`} onClick={() => onOpen(tour)}>
      <ArchivePoster tour={tour} sizes="(max-width: 767px) 104px, 220px" square priority={priority} />
      <span className="music-concert-gallery-year">{year}</span>
      <span className="music-concert-gallery-caption">
        <span>{year}{draft ? <em className="music-concert-gallery-draft">草稿</em> : null}</span>
        <strong>{tour.name}</strong>
        <small>{tour.concertCount} 场</small>
        <b>进入详情 <span aria-hidden="true">→</span></b>
      </span>
    </button>
  </article>
}

function MuseumWheel({ tours, paused, onOpen }: Readonly<{ tours: ConcertTimelineTour[]; paused: boolean; onOpen: (tour: ConcertTimelineTour) => void }>) {
  const stageRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef(new Map<number, HTMLElement>())
  const layoutRef = useRef({ width: 0, height: 0, cardSize: 0, mobile: false })
  const rotationRef = useRef(0)
  const frameRef = useRef(0)
  const manualPauseUntilRef = useRef(0)
  const dragRef = useRef<{ pointerId: number; startAngle: number; startRotation: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const isPageVisible = usePageVisibility()
  const displayedTours = tours

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || displayedTours.length === 0 || !isPageVisible) return undefined
    const syncLayout = () => {
      const mobile = window.innerWidth < 768
      layoutRef.current = {
        width: stage.clientWidth,
        height: stage.clientHeight,
        cardSize: cardsRef.current.get(0)?.offsetWidth || (mobile ? 112 : 220),
        mobile,
      }
    }
    syncLayout()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncLayout)
    resizeObserver?.observe(stage)
    let previousTime = performance.now()

    const paint = (now: number) => {
      const { width, height, cardSize, mobile } = layoutRef.current
      const orbitCount = displayedTours.length
      const centerX = (width - cardSize) / 2
      const centerY = (height - cardSize) / 2
      const radius = Math.max(0, (Math.min(width, height) - cardSize) / 2 - (mobile ? 4 : 10) + (mobile ? 18 : 0))
      const crowdScale = mobile && orbitCount > 6 ? Math.max(.68, 6.5 / orbitCount) : 1
      const delta = Math.min(48, now - previousTime)
      previousTime = now
      if (!paused && !dragRef.current && now > manualPauseUntilRef.current) {
        rotationRef.current = (rotationRef.current + delta * .003) % 360
      }

      cardsRef.current.forEach((element, index) => {
        if (index >= orbitCount) {
          element.style.opacity = '0'
          element.style.pointerEvents = 'none'
          return
        }
        const angleDegrees = rotationRef.current - 90 + index * (360 / orbitCount)
        const angle = angleDegrees * Math.PI / 180
        const cosine = Math.cos(angle)
        const sine = Math.sin(angle)
        const x = centerX + cosine * radius
        const y = centerY + sine * radius
        element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${crowdScale})`
        element.style.opacity = '1'
        element.style.zIndex = '20'
        element.style.pointerEvents = ''
      })
      frameRef.current = window.requestAnimationFrame(paint)
    }

    frameRef.current = window.requestAnimationFrame(paint)
    return () => {
      resizeObserver?.disconnect()
      window.cancelAnimationFrame(frameRef.current)
    }
  }, [displayedTours.length, isPageVisible, paused])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      rotationRef.current += event.deltaY * .08
      manualPauseUntilRef.current = performance.now() + 900
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const startAngle = Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)) * 180 / Math.PI
    dragRef.current = { pointerId: event.pointerId, startAngle, startRotation: rotationRef.current, moved: false }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const pointerAngle = Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)) * 180 / Math.PI
    let angleDelta = pointerAngle - drag.startAngle
    if (angleDelta > 180) angleDelta -= 360
    if (angleDelta < -180) angleDelta += 360
    if (Math.abs(angleDelta) > 2 && !drag.moved) {
      drag.moved = true
      stageRef.current?.setPointerCapture(event.pointerId)
    }
    rotationRef.current = drag.startRotation + angleDelta
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      suppressClickRef.current = true
      window.requestAnimationFrame(() => { suppressClickRef.current = false })
    }
    dragRef.current = null
    manualPauseUntilRef.current = performance.now() + 700
  }

  return <div ref={stageRef} className="music-concert-gallery-wheel" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onClickCapture={(event) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }}>
    <div className="music-concert-gallery-ring" aria-hidden="true" />
    <div className="music-concert-gallery-orbit">
       {displayedTours.map((tour, index) => <OrbitPoster key={tour.id} tour={tour} hidden={false} onOpen={onOpen} priority={index === 0} cardRef={(element) => {
        if (element) cardsRef.current.set(index, element)
        else cardsRef.current.delete(index)
      }} />)}
    </div>
    {!displayedTours.length ? <p className="music-concert-gallery-empty">暂未收录</p> : null}
  </div>
}

function MyLiveCenter({ data, status, onRetry, loginHref }: Readonly<{ data: ConcertArchiveMyLive | null; status: MyLiveStatus; onRetry: () => void; loginHref: string }>) {
  const isReady = status === 'ready' && data
  const isAnonymous = status === 'anonymous'
  const value = (number: number | undefined) => isReady ? number : isAnonymous ? '登录' : status === 'error' ? '失败' : '…'
  const latest = isReady && data.latestAttendedShow
    ? `${data.latestAttendedShow.tourName} · ${data.latestAttendedShow.city}`
    : isReady
      ? '暂无观看记录'
      : isAnonymous
        ? '登录后查看'
        : status === 'error'
          ? '加载失败'
          : '加载中'
  const actionHref = isAnonymous ? loginHref : '/music/live/me'

  return <section data-testid="my-live-card" className={`music-concert-gallery-my-live${status === 'error' ? ' is-error' : ''}`} aria-labelledby="concert-gallery-my-live-title">
    <span className="music-concert-gallery-corner is-top" aria-hidden="true" />
    <span className="music-concert-gallery-corner is-bottom" aria-hidden="true" />

    <strong id="concert-gallery-my-live-title">我的现场收藏</strong>
    <div className="music-concert-gallery-live-stats">
      <div><b>{value(data?.attendedShowCount)}</b><span>观看现场数</span></div>
      <div><b>{value(data?.attendedTourCount)}</b><span>观看巡演数</span></div>
    </div>
    <div className="music-concert-gallery-live-records">
      <div><span>最近现场</span><b title={latest}>{latest}</b></div>
      <div><span>看过城市数</span><b>{value(data?.attendedCityCount)}</b></div>
    </div>
    {status === 'error' ? <button type="button" className="music-concert-gallery-live-retry" onClick={onRetry}>加载失败 · 重试</button> : null}
    <Link href={actionHref}>进入我的现场 <span aria-hidden="true">→</span></Link>
  </section>
}

function ExpandedConcert({ tour, onClose, isAdmin }: Readonly<{ tour: ConcertTimelineTour; onClose: () => void; isAdmin: boolean }>) {
  const content = <div data-testid="concert-detail-modal" className="music-concert-gallery-modal-root" role="presentation" onClick={onClose}>
    <div className="music-concert-gallery-modal-backdrop" aria-hidden="true" />
    <div className="music-concert-gallery-modal-scroll">
      <div className="music-concert-gallery-modal-card" role="dialog" aria-modal="true" aria-labelledby="concert-gallery-modal-title" onClick={(event) => event.stopPropagation()}>
        <button data-testid="concert-detail-close" type="button" className="music-concert-gallery-modal-close" aria-label="关闭演唱会档案" onClick={onClose}>×</button>
         <ArchivePoster tour={tour} sizes="(max-width: 767px) 160px, 240px" priority />
        <div className="music-concert-gallery-modal-copy">
          <time>{formatYear(tour.startDate)}</time>
          <h2 id="concert-gallery-modal-title">{tour.name}</h2>
          <p className="music-concert-gallery-modal-count">{tour.concertCount} 场</p>
          <p className="music-concert-gallery-modal-description">{tour.description?.trim() || '简介暂未整理。'}</p>
          <Link href={archiveHref(tour, isAdmin)}>查看完整巡演详情 <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </div>
  </div>
  return typeof document === 'undefined' ? null : createPortal(content, document.body)
}

export function MusicConcertTimeline({ tours, compact = false, myLive, isAdmin = false, categories }: Readonly<{ tours: ConcertTimelineTour[]; compact?: boolean; myLive?: ConcertArchiveMyLive; isAdmin?: boolean; categories?: ConcertCategoryConfig[] }>) {
  const [activeCategory, setActiveCategory] = useState<ConcertCategorySlug>('main')
  const [interactionPaused, setInteractionPaused] = useState(false)
  const [expandedTour, setExpandedTour] = useState<ConcertTimelineTour | null>(null)
  const initialMyLiveData = myLive || null
  const [myLiveData, setMyLiveData] = useState<ConcertArchiveMyLive | null>(initialMyLiveData)
  const [myLiveStatus, setMyLiveStatus] = useState<MyLiveStatus>('loading')
  const myLiveDataRef = useRef<ConcertArchiveMyLive | null>(initialMyLiveData)
  const myLiveRequestRef = useRef<AbortController | null>(null)
  const myLiveInFlightRef = useRef(false)
  const pathname = usePathname()

  // 分类来源：优先后台配置（enabled=true，按 sortOrder 升序），无配置时回退到三大核心分类。
  const fallbackCategories: ConcertCategoryConfig[] = [
    { id: 'main', name: '大型演唱会', slug: 'main', sortOrder: 1, enabled: true },
    { id: 'small', name: '小型企划', slug: 'small', sortOrder: 2, enabled: true },
    { id: 'guest', name: '嘉宾现场', slug: 'guest', sortOrder: 3, enabled: true },
  ]
  const dbCategories = (categories && categories.length ? categories : fallbackCategories).filter((category) => category.enabled)
  const categoryById = new Map(dbCategories.map((category) => [category.id, category]))
  // 以 slug 为索引：Tab 标签需要按 slug 解析分类 name（categoryId 是 CUID，slug 才是展示键）。
  const categoryBySlug = new Map(dbCategories.map((category) => [category.slug, category]))
  // 每个巡演的有效分类 slug：优先 categoryId -> 关联分类 slug；回退到枚举映射；再回退 main。
  function tourSlug(tour: ConcertTimelineTour): string {
    const byId = tour.categoryId ? categoryById.get(tour.categoryId) : undefined
    if (byId) return byId.slug
    return CONCERT_CATEGORY_ENUM_TO_SLUG[tour.category] ?? 'main'
  }

  const grouped: Record<string, ConcertTimelineTour[]> = {}
  for (const tour of tours) {
    const slug = tourSlug(tour)
    if (!grouped[slug]) grouped[slug] = []
    grouped[slug].push(tour)
  }

  // Tab 顺序：enabled 分类按 sortOrder；补充数据中出现但不在 enabled 列表中的 slug（避免遗漏）。
  const orderedSlugs = [...dbCategories].sort((left, right) => left.sortOrder - right.sortOrder).map((category) => category.slug)
  const slugSet = new Set(orderedSlugs)
  for (const tour of tours) {
    const slug = tourSlug(tour)
    if (!slugSet.has(slug)) {
      slugSet.add(slug)
      orderedSlugs.push(slug)
    }
  }
  // Tab 必须显示分类 name（如「Live拉阔音乐会」「专辑签售会」），绝不允许回退显示 slug 文本。
  const tabLabel = (slug: string) => (categoryBySlug.get(slug)?.name) || FALLBACK_CATEGORY_LABELS[slug]?.label || slug

  function selectCategory(nextCategory: ConcertCategorySlug) {
    if (nextCategory === activeCategory) return
    setActiveCategory(nextCategory)
  }

  const loadMyLive = useCallback(async (showLoading = false) => {
    if (myLiveInFlightRef.current) return
    myLiveInFlightRef.current = true
    if (showLoading || !myLiveDataRef.current) setMyLiveStatus('loading')
    myLiveRequestRef.current?.abort()
    const controller = new AbortController()
    myLiveRequestRef.current = controller
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 10000)

    try {
      const response = await fetch('/api/music/live/me', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (response.status === 401) {
        myLiveDataRef.current = null
        setMyLiveData(null)
        setMyLiveStatus('anonymous')
        return
      }
      if (!response.ok) throw new Error(`My Live summary failed: ${response.status}`)
      const payload = await response.json() as {
        stats?: {
          concertCount?: number
          tourCount?: number
          cityCount?: number
          latestAttendedShow?: ConcertArchiveMyLive['latestAttendedShow'] | null
        }
      }
      const stats = payload.stats
      if (!stats || typeof stats.concertCount !== 'number' || typeof stats.tourCount !== 'number' || typeof stats.cityCount !== 'number') {
        throw new Error('My Live overview response is invalid')
      }
      const nextData: ConcertArchiveMyLive = {
        attendedShowCount: stats.concertCount,
        attendedTourCount: stats.tourCount,
        attendedCityCount: stats.cityCount,
        latestAttendedShow: stats.latestAttendedShow || null,
      }
      myLiveDataRef.current = nextData
      setMyLiveData(nextData)
      setMyLiveStatus('ready')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && !timedOut) return
      console.error('[music.live.summary]', error)
      setMyLiveStatus('error')
    } finally {
      window.clearTimeout(timeoutId)
      if (myLiveRequestRef.current === controller) myLiveRequestRef.current = null
      myLiveInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    void loadMyLive(true)
    const refresh = () => void loadMyLive(false)
    window.addEventListener('music-live:attendance-updated', refresh)
    return () => {
      window.removeEventListener('music-live:attendance-updated', refresh)
      myLiveRequestRef.current?.abort()
    }
  }, [loadMyLive])

  useEffect(() => {
    if (!expandedTour) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedTour(null)
    }
    const root = document.documentElement
    const body = document.body
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPosition = body.style.position
    const previousBodyTop = body.style.top
    const previousBodyLeft = body.style.left
    const previousBodyWidth = body.style.width
    root.dataset.easonConcertModalOpen = 'true'
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = `-${scrollX}px`
    body.style.width = '100%'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
      body.style.position = previousBodyPosition
      body.style.top = previousBodyTop
      body.style.left = previousBodyLeft
      body.style.width = previousBodyWidth
      delete root.dataset.easonConcertModalOpen
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' })
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [expandedTour])

  return <section className={`music-concert-gallery${compact ? ' is-compact' : ''}`} aria-label="Eason in Concert 互动式演唱会展厅">
    <header className="music-concert-gallery-switcher">

      <div role="tablist" aria-label="演唱会分类">
        {orderedSlugs.map((category) => <button key={category} type="button" role="tab" aria-selected={category === activeCategory} onClick={() => selectCategory(category)}>{tabLabel(category)}</button>)}
      </div>
    </header>
    <div className="music-concert-gallery-stage" onMouseEnter={() => setInteractionPaused(true)} onMouseLeave={() => setInteractionPaused(false)} onFocusCapture={() => setInteractionPaused(true)} onBlurCapture={() => setInteractionPaused(false)}>
      <MuseumWheel tours={grouped[activeCategory] || []} paused={Boolean(expandedTour) || interactionPaused} onOpen={setExpandedTour} />
      <MyLiveCenter data={myLiveData} status={myLiveStatus} onRetry={() => void loadMyLive(true)} loginHref={`/login?redirect=${encodeURIComponent(pathname || '/music/concerts')}`} />
    </div>
    {expandedTour ? <ExpandedConcert tour={expandedTour} onClose={() => setExpandedTour(null)} isAdmin={Boolean(isAdmin)} /> : null}
  </section>
}
