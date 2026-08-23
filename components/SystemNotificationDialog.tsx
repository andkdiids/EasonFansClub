'use client'

import { useEffect, useRef } from 'react'
import type { UnifiedNotification } from '@/lib/notifications'

function formatSystemNotificationTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function SystemNotificationDialog({
  notification,
  actionHref,
  onClose,
  onAction,
}: Readonly<{
  notification: UnifiedNotification
  actionHref?: string | null
  onClose: () => void
  onAction?: () => void
}>) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [notification])

  const title = notification.title.trim() || '系统通知'
  const content = notification.content?.trim() || '暂无详细内容'
  const titleId = `system-notification-title-${notification.id}`
  const contentId = `system-notification-content-${notification.id}`

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={contentId}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-sky-100 bg-white shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-sky-100 px-5 py-4 sm:px-7 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs font-black tracking-[0.18em] text-brand-700">系统通知</p>
            <h2 id={titleId} className="mt-1 break-words text-xl font-black leading-8 text-brand-950 sm:text-2xl">{title}</h2>
            <time className="mt-1 block text-xs font-bold text-slate-500" dateTime={new Date(notification.createdAt).toISOString()}>
              {formatSystemNotificationTime(notification.createdAt)}
            </time>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭系统通知详情"
            onClick={onClose}
            className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-transparent text-xl font-bold leading-none text-slate-500 transition hover:border-sky-100 hover:bg-sky-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            ×
          </button>
        </header>

        <div id={contentId} className="min-h-0 overflow-y-auto px-5 py-5 sm:max-h-[65vh] sm:px-7 sm:py-6">
          <p className="whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-700 [overflow-wrap:anywhere] sm:text-base sm:leading-8">{content}</p>
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-sky-100 px-5 py-4 sm:px-7">
          {actionHref && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="min-h-10 rounded-lg bg-brand-950 px-4 text-sm font-black text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            >
              前往查看
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-lg border border-sky-100 bg-white px-4 text-sm font-black text-slate-600 transition hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            知道了
          </button>
        </footer>
      </section>
    </div>
  )
}
