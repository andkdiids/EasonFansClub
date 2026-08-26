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
import { EcenterEditButton, EcenterShortcutEditorPanel } from './EcenterShortcutEditor'
import type { EcenterFeatureItem } from '@/lib/ecenter-features'
import { isAppNavigationActive, primaryNavigation } from './navigation'

export function MobileNavigation({ unreadCount, canAccessAdmin, ecenterFeatures }: Readonly<{ unreadCount: number; canAccessAdmin: boolean; ecenterFeatures: readonly EcenterFeatureItem[] }>) {
  const pathname = usePathname()
  const router = useRouter()
  const [centerOpen, setCenterOpen] = useState(false)
  const [centerEditing, setCenterEditing] = useState(false)
  const [userFeatures, setUserFeatures] = useState<readonly EcenterFeatureItem[]>(ecenterFeatures)
  const pendingHref = useRef('')
  const items = primaryNavigation.filter((item) => item.mobile)
  const first = items.slice(0, 2)
  const last = items.slice(2)
  useEffect(() => setUserFeatures(ecenterFeatures), [ecenterFeatures])

  const fallbackMenuItems = ecenterFeatures.filter((item) => !item.hidden && item.showInCenter && (!item.requiresAdmin || canAccessAdmin))
  const menuItems = userFeatures.length > 0 ? userFeatures.filter((item) => !item.hidden && item.showInCenter && (!item.requiresAdmin || canAccessAdmin)) : fallbackMenuItems
  const centerActive = menuItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
  const renderItem = (item: (typeof items)[number]) => <Link key={item.featureKey} href={item.href} aria-current={isAppNavigationActive(pathname, item) ? 'page' : undefined} className={item.showsUnread ? 'mobile-notifications' : undefined}>
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
  useEffect(() => setCenterEditing(false), [pathname])

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
    setCenterEditing(false)
    window.dispatchEvent(new Event('friend-dock:close'))
    window.history.pushState({ ...window.history.state, easonCenterSheet: true }, '')
    setCenterOpen(true)
  }

  function closeCenter() {
    setCenterEditing(false)
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

  const centerOverlay = centerOpen && typeof document !== 'undefined' ? createPortal(
    <>
      <button
        type="button"
        className="mobile-center-backdrop"
        aria-label="关闭 E院中心"
        onPointerDown={consumeBackdropEvent}
        onClick={closeCenterFromBackdrop}
      />
      <section className="mobile-center-sheet" data-center-editing={centerEditing ? 'true' : undefined} role="dialog" aria-modal="true" aria-labelledby="mobile-center-title">
        <header>
          <div><p>EASON FANS CLUB</p><h2 id="mobile-center-title">{centerEditing ? '编辑 E院中心' : 'E院中心'}</h2></div>
          <div className="mobile-center-header-actions">
            {!centerEditing ? <EcenterEditButton onClick={() => setCenterEditing(true)}>编辑</EcenterEditButton> : null}
            <button type="button" onClick={closeCenter} aria-label="关闭 E院中心">×</button>
          </div>
        </header>
        {centerEditing ? <EcenterShortcutEditorPanel
          initialFeatures={userFeatures}
          variant="mobile"
          onSaved={(features) => setUserFeatures(features)}
          onDone={() => setCenterEditing(false)}
        /> : <nav aria-label="E院中心功能">
          {menuItems.map((item) => <button type="button" key={item.featureKey} onClick={() => navigateFromCenter(item.href)}>
              <span className="mobile-center-item-icon"><UiIcon name={item.icon} /></span>
              <span>{item.label}</span>
              {item.showsUnread && unreadCount > 0 ? <b>{unreadCount}</b> : null}
            </button>)}
        </nav>}
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
