'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { UiIcon } from '@/components/UiIcon'
import { isAppNavigationActive, primaryNavigation } from './navigation'

const centerItems = [
  { href: '/posts/new', label: '发布帖子', icon: 'forum' as const },
  { href: '/checkin', label: '每日挂号', icon: 'check' as const },
  { href: '/games', label: '娱乐天空', icon: 'star' as const },
  { href: '/stickers', label: '表情包商店', icon: 'sticker' as const },
  { href: '/activities', label: '活动中心', icon: 'calendar' as const },
  { href: '/today', label: '今日', icon: 'archive' as const },
  { href: '/notifications', label: '通知中心', icon: 'bell' as const, showsUnread: true },
  { href: '/friends/activity', label: '好友动态', icon: 'friends' as const },
  { href: '/trending', label: '热门帖子', icon: 'chart' as const },
  { href: '/feedback', label: '反馈与更新', icon: 'feedback' as const },
]

export function MobileNavigation({ unreadCount, canAccessAdmin }: Readonly<{ unreadCount: number; canAccessAdmin: boolean }>) {
  const pathname = usePathname()
  const router = useRouter()
  const [centerOpen, setCenterOpen] = useState(false)
  const pendingHref = useRef('')
  const items = primaryNavigation.filter((item) => item.mobile)
  const first = items.slice(0, 2)
  const last = items.slice(2)
  const centerActive = centerItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
  const renderItem = (item: (typeof items)[number]) => <Link key={item.href} href={item.href} aria-current={isAppNavigationActive(pathname, item) ? 'page' : undefined} className={item.showsUnread ? 'mobile-notifications' : undefined}>
    <UiIcon name={item.icon} />{item.showsUnread && unreadCount > 0 ? <b>{unreadCount}</b> : null}<span>{item.label}</span>
  </Link>

  useEffect(() => {
    if (!centerOpen) return
    const root = document.documentElement
    const body = document.body
    const scrollY = window.scrollY
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPosition = body.style.position
    const previousBodyTop = body.style.top
    const previousBodyWidth = body.style.width
    root.dataset.easonCenterOpen = 'true'
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && history.state?.easonCenterSheet) history.back()
    }
    const onPopState = () => {
      setCenterOpen(false)
      const href = pendingHref.current
      pendingHref.current = ''
      if (href) router.push(href)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('popstate', onPopState)
    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
      body.style.position = previousBodyPosition
      body.style.top = previousBodyTop
      body.style.width = previousBodyWidth
      delete root.dataset.easonCenterOpen
      window.scrollTo({ top: scrollY, behavior: 'auto' })
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('popstate', onPopState)
    }
  }, [centerOpen, router])

  useEffect(() => setCenterOpen(false), [pathname])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return

    let frame = 0
    const logViewport = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const mobileBottomNav = document.querySelector<HTMLElement>('.mobile-bottom-nav')
        console.log({
          viewportHeight: window.innerHeight,
          scrollY: window.scrollY,
          bottomNavRect: mobileBottomNav?.getBoundingClientRect(),
        })
      })
    }

    logViewport()
    window.addEventListener('resize', logViewport, { passive: true })
    window.addEventListener('orientationchange', logViewport, { passive: true })
    window.addEventListener('scroll', logViewport, { passive: true })
    window.visualViewport?.addEventListener('resize', logViewport, { passive: true })
    window.visualViewport?.addEventListener('scroll', logViewport, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', logViewport)
      window.removeEventListener('orientationchange', logViewport)
      window.removeEventListener('scroll', logViewport)
      window.visualViewport?.removeEventListener('resize', logViewport)
      window.visualViewport?.removeEventListener('scroll', logViewport)
    }
  }, [])

  function openCenter() {
    if (centerOpen) return
    window.dispatchEvent(new Event('friend-dock:close'))
    window.history.pushState({ ...window.history.state, easonCenterSheet: true }, '')
    setCenterOpen(true)
  }

  function closeCenter() {
    pendingHref.current = ''
    if (window.history.state?.easonCenterSheet) window.history.back()
    else setCenterOpen(false)
  }

  function consumeBackdropEvent(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
  }

  function closeCenterFromBackdrop(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    event.stopPropagation()
    closeCenter()
  }

  function interceptNavigationWhileCenterOpen(event: ReactMouseEvent<HTMLElement>) {
    if (!centerOpen) return
    const target = event.target as Element
    if (target.closest('.mobile-center-button')) return
    event.preventDefault()
    event.stopPropagation()
    closeCenter()
  }

  function navigateFromCenter(href: string) {
    if (window.history.state?.easonCenterSheet) {
      pendingHref.current = href
      window.history.back()
      return
    }
    setCenterOpen(false)
    router.push(href)
  }

  const menuItems = canAccessAdmin
    ? [...centerItems, { href: '/admin', label: '后台管理', icon: 'settings' as const }]
    : centerItems

  const centerOverlay = centerOpen && typeof document !== 'undefined' ? createPortal(
    <>
      <button
        type="button"
        className="mobile-center-backdrop"
        aria-label="关闭 E院中心"
        onPointerDown={consumeBackdropEvent}
        onClick={closeCenterFromBackdrop}
      />
      <section className="mobile-center-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-center-title">
        <header>
          <div><p>EASON FANS CLUB</p><h2 id="mobile-center-title">E院中心</h2></div>
          <button type="button" onClick={closeCenter} aria-label="关闭 E院中心">×</button>
        </header>
        <nav aria-label="E院中心功能">
          {menuItems.map((item) => <button type="button" key={item.href} onClick={() => navigateFromCenter(item.href)}>
            <span className="mobile-center-item-icon"><UiIcon name={item.icon} /></span>
            <span>{item.label}</span>
            {'showsUnread' in item && item.showsUnread && unreadCount > 0 ? <b>{unreadCount}</b> : null}
          </button>)}
        </nav>
      </section>
    </>,
    document.body,
  ) : null

  return <>
    <nav
      data-mobile-main-nav
      data-center-open={centerOpen || undefined}
      className="mobile-bottom-nav app-mobile-nav"
      aria-label="移动端导航"
      onClickCapture={interceptNavigationWhileCenterOpen}
    >
      {first.map(renderItem)}
      <button type="button" className="mobile-center-button" aria-label="E院中心" aria-haspopup="dialog" aria-expanded={centerOpen} data-active={centerActive || undefined} onClick={centerOpen ? closeCenter : openCenter}>
        <span className="mobile-center-icon"><UiIcon name="grid" /></span>
        <span>E院中心</span>
      </button>
      {last.map(renderItem)}
    </nav>
    {centerOverlay}
  </>
}
