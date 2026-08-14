'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { normalizeActionUrl } from '@/lib/url-safety'

type Announcement = {
  id: string
  title: string
  content: string
  type: string
  link: string | null
  buttonUrl: string | null
}

const dismissedKey = 'ecfc-dismissed-home-announcements'

function loadDismissedIds() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(dismissedKey) || '[]') as string[])
  } catch {
    return new Set<string>()
  }
}

export function HomeSystemAnnouncement({ announcement }: { announcement: Announcement | null }) {
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (!announcement) return
    setHidden(loadDismissedIds().has(announcement.id))
  }, [announcement])

  if (!announcement || hidden) return null

  const targetUrl = normalizeActionUrl(announcement.buttonUrl) || normalizeActionUrl(announcement.link) || '/notifications'

  function dismiss() {
    if (!announcement) return
    const ids = Array.from(loadDismissedIds())
    window.localStorage.setItem(dismissedKey, JSON.stringify([announcement.id, ...ids.filter((id) => id !== announcement.id)].slice(0, 60)))
    setHidden(true)
  }

  return (
    <section className="mx-auto max-w-7xl">
      <div className="flex flex-col gap-3 rounded-[24px] border border-sky-100 bg-white/86 p-4 shadow-sm shadow-sky-900/5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">{announcement.type}</p>
          <h2 className="mt-1 text-lg font-black text-brand-950">{announcement.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm font-bold leading-6 text-slate-600">{announcement.content}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={targetUrl} className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">
            查看
          </Link>
          <button onClick={dismiss} className="rounded-full bg-sky-50 px-4 py-2 text-xs font-black text-brand-700">
            关闭
          </button>
        </div>
      </div>
    </section>
  )
}
