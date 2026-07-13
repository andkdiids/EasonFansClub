'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type ToastNotification = {
  id: string
  source: 'personal' | 'system'
  title: string
  content: string | null
  link: string | null
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
      const response = await fetch('/api/notifications?unread=1&limit=5', { cache: 'no-store' }).catch(() => null)
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

    poll()
    const interval = window.setInterval(poll, 45_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.clearTimeout(closeTimer)
    }
  }, [enabled])

  if (!enabled || !toast) return null

  return (
    <div className="fixed inset-x-4 bottom-24 z-50 md:inset-x-auto md:bottom-6 md:right-6 md:w-96">
      <div className="rounded-2xl border border-sky-100 bg-white p-4 shadow-2xl shadow-sky-900/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-brand-950">{toast.title}</p>
            <p className="mt-1 line-clamp-2 text-sm font-bold leading-6 text-slate-600">{toast.content}</p>
          </div>
          <button onClick={() => setToast(null)} className="shrink-0 rounded-full px-2 text-lg font-black text-slate-400 hover:bg-slate-50">
            ×
          </button>
        </div>
        <Link href={toast.link || '/notifications'} className="mt-3 inline-flex rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">
          查看详情
        </Link>
      </div>
    </div>
  )
}
