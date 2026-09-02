'use client'

import { useEffect, useRef } from 'react'
import type { HomeUpdate } from '@/lib/home-announcement'

function formatUpdateDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return '暂无更新时间'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

export function HomeUpdateModal({ update, onClose }: Readonly<{ update: HomeUpdate; onClose: () => void }>) {
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
  }, [update.id])

  const titleId = `home-update-title-${update.id}`
  const contentId = `home-update-content-${update.id}`

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
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
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-sky-100 px-5 py-4 sm:px-7 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs font-black tracking-[0.18em] text-brand-700">内容更新</p>
            <h2 id={titleId} className="mt-1 break-words text-xl font-black leading-8 text-brand-950 sm:text-2xl">私家E院 · 内容更新</h2>
            <time className="mt-1 block text-xs font-bold text-slate-500" dateTime={new Date(update.publishAt || update.createdAt).toISOString()}>
              更新时间：{formatUpdateDate(update.publishAt || update.createdAt)}
            </time>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="关闭内容更新"
            onClick={onClose}
            className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-transparent text-xl font-bold leading-none text-slate-500 transition hover:border-sky-100 hover:bg-sky-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            ×
          </button>
        </header>

        <div id={contentId} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <h3 className="break-words text-lg font-black leading-7 text-brand-950">{update.title}</h3>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-700 [overflow-wrap:anywhere] sm:text-base sm:leading-8">{update.content}</p>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-sky-100 px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-lg bg-brand-950 px-5 text-sm font-black text-white transition hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            关闭
          </button>
        </footer>
      </section>
    </div>
  )
}
