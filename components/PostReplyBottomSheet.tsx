'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ReplyForm } from '@/components/ReplyForm'

export function PostReplyBottomSheet({
  open,
  postId,
  onClose,
  onReplyCreated,
}: Readonly<{
  open: boolean
  postId: string
  onClose: () => void
  onReplyCreated: (reply: unknown) => void
}>) {
  const [mounted, setMounted] = useState(false)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  const historyPushedRef = useRef(false)
  const previousHistoryStateRef = useRef<unknown>(null)
  const savedScrollYRef = useRef<number | null>(null)

  useEffect(() => setMounted(true), [])

  const requestClose = useCallback(() => {
    const shouldPopHistory = historyPushedRef.current
    const historyState = window.history.state as { ecfcPostReplySheet?: boolean; friendMentionPicker?: boolean } | null
    const historySteps = historyState?.friendMentionPicker ? 2 : 1
    historyPushedRef.current = false
    onClose()
    if (shouldPopHistory && historyState?.ecfcPostReplySheet) window.history.go(-historySteps)
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const media = window.matchMedia('(max-width: 767px)')
    const closeOnDesktopResize = () => {
      if (!media.matches) onClose()
    }
    closeOnDesktopResize()
    media.addEventListener('change', closeOnDesktopResize)
    return () => media.removeEventListener('change', closeOnDesktopResize)
  }, [onClose, open])

  useEffect(() => {
    if (!open || !mounted) return

    const body = document.body
    const savedScrollY = window.scrollY
    const previousBodyStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    savedScrollYRef.current = savedScrollY
    previousHistoryStateRef.current = window.history.state
    const historyState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {}
    window.history.pushState({ ...historyState, ecfcPostReplySheet: true }, '')
    historyPushedRef.current = true

    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    const updateViewport = () => {
      const viewport = window.visualViewport
      if (!viewport) {
        setKeyboardOffset(0)
        setViewportHeight(window.innerHeight)
        return
      }
      setKeyboardOffset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)))
      setViewportHeight(Math.round(viewport.height))
    }
    const onPopState = () => {
      if (!historyPushedRef.current) return
      // FriendMentionInput owns a nested history entry. Let its own listener
      // close the suggestion list before the sheet handles the back action.
      if (window.history.state?.ecfcPostReplySheet) return
      historyPushedRef.current = false
      onClose()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }

    updateViewport()
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onEscape)

    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onEscape)
      if (historyPushedRef.current && window.history.state?.ecfcPostReplySheet) {
        historyPushedRef.current = false
        window.history.replaceState(previousHistoryStateRef.current, '')
      }
      body.style.position = previousBodyStyle.position
      body.style.top = previousBodyStyle.top
      body.style.left = previousBodyStyle.left
      body.style.right = previousBodyStyle.right
      body.style.width = previousBodyStyle.width
      body.style.overflow = previousBodyStyle.overflow
      const restoreScrollY = savedScrollYRef.current
      if (restoreScrollY !== null) window.scrollTo({ top: restoreScrollY, behavior: 'auto' })
      savedScrollYRef.current = null
      setKeyboardOffset(0)
      setViewportHeight(null)
    }
  }, [mounted, onClose, open, requestClose])

  if (!mounted || !open) return null

  const sheetStyle = {
    '--post-reply-keyboard-offset': `${keyboardOffset}px`,
    '--post-reply-viewport-height': viewportHeight ? `${viewportHeight}px` : '100dvh',
  } as CSSProperties

  return createPortal(
    <>
      <button
        type="button"
        className="post-reply-bottom-sheet-backdrop"
        aria-label="关闭回复面板"
        onClick={requestClose}
      />
      <section
        className="post-reply-bottom-sheet"
        style={sheetStyle}
        role="dialog"
        aria-modal="true"
        aria-label="回复帖子"
      >
        <header className="post-reply-bottom-sheet-header">
          <span>回复帖子</span>
          <button type="button" onClick={requestClose} aria-label="关闭回复面板">×</button>
        </header>
        <ReplyForm
          postId={postId}
          autoFocus
          className="post-reply-bottom-form"
          onReplyCancel={requestClose}
          onReplyCreated={onReplyCreated}
        />
      </section>
    </>,
    document.body,
  )
}
