'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { usePathname } from 'next/navigation'
import { ConcertCover } from '@/components/music/ConcertCover'
import { generateArchiveSlug } from '@/lib/music-slug'

export type ConcertTimelineTour = {
  id: string
  name: string
  category: 'MAIN' | 'SMALL' | 'GUEST'
  subtitle?: string | null
  description?: string | null
  posterUrl?: string | null
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

type ConcertCategory = 'main' | 'special' | 'guest'

const CATEGORY_LABELS: Record<ConcertCategory, { eyebrow: string; label: string }> = {
  main: { eyebrow: 'MAIN CONCERTS', label: '大型演唱会' },
  special: { eyebrow: 'SPECIAL PROJECTS', label: '小型企划' },
  guest: { eyebrow: 'GUEST APPEARANCES', label: '嘉宾现场' },
}

function formatYear(value: Date | string | null | undefined) {
  if (!value) return 'ARCHIVE'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'ARCHIVE' : String(date.getUTCFullYear())
}

function archiveHref(tour: ConcertTimelineTour) {
  return `/music/live/tours/${generateArchiveSlug(tour.name)}`
}

function ArchivePoster({ tour, sizes, square = true }: Readonly<{ tour: ConcertTimelineTour; sizes: string; square?: boolean }>) {
  return <ConcertCover
    src={tour.posterUrl}
    alt={`${tour.name}演唱会海报`}
    sizes={sizes}
    className={`music-concert-gallery-image${square ? ' is-square' : ''}`}
  />
}

function OrbitPoster({ tour, hidden, onOpen, cardRef }: Readonly<{ tour: ConcertTimelineTour; hidden?: boolean; onOpen: (tour: ConcertTimelineTour) => void; cardRef: (element: HTMLElement | null) => void }>) {
  const year = formatYear(tour.startDate)
  return <article ref={cardRef} className="music-concert-gallery-poster" aria-hidden={hidden || undefined}>
    <button data-testid="concert-orbit-card" type="button" tabIndex={hidden ? -1 : undefined} className="music-concert-gallery-poster-button" aria-label={`展开《${tour.name}》演唱会档案`} onClick={() => onOpen(tour)}>
      <ArchivePoster tour={tour} sizes="(max-width: 767px) 132px, 220px" square />
      <span className="music-concert-gallery-year">{year}</span>
      <span className="music-concert-gallery-caption">
        <span>{year}</span>
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
  const rotationRef = useRef(0)
  const frameRef = useRef(0)
  const manualPauseUntilRef = useRef(0)
  const dragRef = useRef<{ pointerId: number; startAngle: number; startRotation: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const displayedTours = tours

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || displayedTours.length === 0) return undefined
    let previousTime = performance.now()

    const paint = (now: number) => {
      const width = stage.clientWidth
      const height = stage.clientHeight
      const mobile = window.innerWidth < 768
      const orbitCount = displayedTours.length
      const cardSize = cardsRef.current.get(0)?.offsetWidth || (mobile ? 112 : 220)
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
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [displayedTours.length, paused])

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
      {displayedTours.map((tour, index) => <OrbitPoster key={tour.id} tour={tour} hidden={false} onOpen={onOpen} cardRef={(element) => {
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
    <p>PRIVATE LIVE COLLECTION</p>
    <h2 id="concert-gallery-my-live-title">MY LIVE</h2>
    <strong>我的现场收藏</strong>
    <div className="music-concert-gallery-live-stats">
      <div><b>{value(data?.attendedShowCount)}</b><span>观看现场数</span></div>
      <div><b>{value(data?.attendedTourCount)}</b><span>观看巡演数</span></div>
    </div>
    <div className="music-concert-gallery-live-records">
      <div><span>最近观看</span><b title={latest}>{latest}</b></div>
      <div><span>看过城市数</span><b>{value(data?.attendedCityCount)}</b></div>
    </div>
    {status === 'error' ? <button type="button" className="music-concert-gallery-live-retry" onClick={onRetry}>加载失败 · 重试</button> : null}
    <Link href={actionHref}>进入我的现场 <span aria-hidden="true">→</span></Link>
  </section>
}

function ExpandedConcert({ tour, onClose }: Readonly<{ tour: ConcertTimelineTour; onClose: () => void }>) {
  return <div data-testid="concert-detail-modal" className="music-concert-gallery-modal" role="presentation" onClick={onClose}>
    <div className="music-concert-gallery-modal-panel" role="dialog" aria-modal="true" aria-labelledby="concert-gallery-modal-title">
      <button data-testid="concert-detail-close" type="button" className="music-concert-gallery-modal-close" aria-label="关闭演唱会档案" onClick={onClose}>×</button>
      <div className="music-concert-gallery-modal-grid" onClick={(event) => event.stopPropagation()}>
        <ArchivePoster tour={tour} sizes="(max-width: 767px) 58vw, 270px" />
        <div className="music-concert-gallery-modal-copy">
          <time>{formatYear(tour.startDate)}</time>
          <h2 id="concert-gallery-modal-title">{tour.name}</h2>
          <p className="music-concert-gallery-modal-count">{tour.concertCount} 场</p>
          <p className="music-concert-gallery-modal-description">{tour.description?.trim() || '简介暂未整理。'}</p>
          <Link href={archiveHref(tour)}>查看完整巡演详情 <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </div>
  </div>
}

export function MusicConcertTimeline({ tours, compact = false, myLive }: Readonly<{ tours: ConcertTimelineTour[]; compact?: boolean; myLive?: ConcertArchiveMyLive }>) {
  const [activeCategory, setActiveCategory] = useState<ConcertCategory>('main')
  const [switching, setSwitching] = useState(false)
  const [interactionPaused, setInteractionPaused] = useState(false)
  const [expandedTour, setExpandedTour] = useState<ConcertTimelineTour | null>(null)
  const initialMyLiveData = myLive || null
  const [myLiveData, setMyLiveData] = useState<ConcertArchiveMyLive | null>(initialMyLiveData)
  const [myLiveStatus, setMyLiveStatus] = useState<MyLiveStatus>('loading')
  const switchTimerRef = useRef<number | null>(null)
  const myLiveDataRef = useRef<ConcertArchiveMyLive | null>(initialMyLiveData)
  const myLiveRequestRef = useRef<AbortController | null>(null)
  const myLiveInFlightRef = useRef(false)
  const pathname = usePathname()
  const mainConcerts = tours.filter((tour) => tour.category === 'MAIN')
  const specialProjects = tours.filter((tour) => tour.category === 'SMALL')
  const guestConcerts = tours.filter((tour) => tour.category === 'GUEST')
  const categoryTours: Record<ConcertCategory, ConcertTimelineTour[]> = { main: mainConcerts, special: specialProjects, guest: guestConcerts }
  const activeLabel = CATEGORY_LABELS[activeCategory]

  function selectCategory(nextCategory: ConcertCategory) {
    if (switching || nextCategory === activeCategory) return
    setSwitching(true)
    switchTimerRef.current = window.setTimeout(() => {
      setActiveCategory(nextCategory)
      window.requestAnimationFrame(() => setSwitching(false))
    }, 180)
  }

  useEffect(() => () => {
    if (switchTimerRef.current !== null) window.clearTimeout(switchTimerRef.current)
  }, [])

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
      <p>{activeLabel.eyebrow}</p>
      <div role="tablist" aria-label="演唱会分类">
        {(Object.keys(CATEGORY_LABELS) as ConcertCategory[]).map((category) => <button key={category} type="button" role="tab" aria-selected={category === activeCategory} disabled={switching} onClick={() => selectCategory(category)}>{CATEGORY_LABELS[category].label}</button>)}
      </div>
    </header>
    <div className={`music-concert-gallery-stage${switching ? ' is-switching' : ''}`} onMouseEnter={() => setInteractionPaused(true)} onMouseLeave={() => setInteractionPaused(false)} onFocusCapture={() => setInteractionPaused(true)} onBlurCapture={() => setInteractionPaused(false)}>
      <MuseumWheel key={activeCategory} tours={categoryTours[activeCategory]} paused={Boolean(expandedTour) || switching || interactionPaused} onOpen={setExpandedTour} />
      <MyLiveCenter data={myLiveData} status={myLiveStatus} onRetry={() => void loadMyLive(true)} loginHref={`/login?redirect=${encodeURIComponent(pathname || '/music/concerts')}`} />
    </div>
    {expandedTour ? <ExpandedConcert tour={expandedTour} onClose={() => setExpandedTour(null)} /> : null}
  </section>
}
