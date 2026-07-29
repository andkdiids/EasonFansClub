'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type ToastNotification = {
  id: string
  source: 'personal' | 'system'
  title: string
  content: string | null
  link: string | null
  targetUrl?: string | null
  createdAt: string | Date
}

const displayedKey = 'ecfc-displayed-notification-ids'

function loadDisplayedIds() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(displayedKey) || '[]') as string[])
  } catch {
    return new Set<string>()
  }
}

function saveDisplayedId(id: string) {
  const ids = Array.from(loadDisplayedIds())
  const next = [id, ...ids.filter((item) => item !== id)].slice(0, 80)
  window.localStorage.setItem(displayedKey, JSON.stringify(next))
}

export function NotificationToast({ enabled }: { enabled: boolean }) {
  const [toast, setToast] = useState<ToastNotification | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let closeTimer: number | undefined

    async function poll() {
      if (document.visibilityState === 'hidden') return
      const response = await fetch('/api/notifications/popup', { cache: 'no-store' }).catch(() => null)
      if (!response?.ok || cancelled) return
      const data = await response.json().catch(() => null) as { notifications?: ToastNotification[] } | null
      const displayed = loadDisplayedIds()
      const item = data?.notifications?.find((notification) => !displayed.has(`${notification.source}:${notification.id}`))
      if (!item || cancelled) return

      saveDisplayedId(`${item.source}:${item.id}`)
      setToast(item)
      window.clearTimeout(closeTimer)
      closeTimer = window.setTimeout(() => setToast(null), 10_000)
    }

    const initialTimer = window.setTimeout(poll, 12_000)
    const interval = window.setInterval(poll, 45_000)
    return () => {
      cancelled = true
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
      window.clearTimeout(closeTimer)
    }
  }, [enabled])

  if (!enabled || !toast) return null
  const createdAt = new Date(toast.createdAt)

  return (
    <div className="notification-toast fixed inset-x-4 md:inset-x-auto md:right-6 md:w-96">
      <div className="rounded-[24px] border border-sky-100/90 bg-white/88 p-4 shadow-2xl shadow-sky-900/20 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">重要提醒</p>
            <p className="mt-1 text-sm font-black text-brand-950">{toast.title}</p>
            <p className="mt-1 line-clamp-2 text-sm font-bold leading-6 text-slate-600">{toast.content}</p>
            <p className="mt-2 text-xs font-bold text-slate-400">
              {createdAt.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={() => setToast(null)} className="shrink-0 rounded-full px-2 text-lg font-black text-slate-400 hover:bg-slate-50">
            ×
          </button>
        </div>
        <Link href={toast.targetUrl || toast.link || '/notifications'} className="mt-3 inline-flex rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white shadow-sm">
          查看详情
        </Link>
      </div>
    </div>
  )
}
