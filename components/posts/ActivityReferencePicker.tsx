'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

export type ActivityReferenceActivity = {
  id: string
  title: string
  coverUrl: string | null
  bannerUrl: string | null
  startsAt: string | null
  endsAt: string | null
  locationName: string | null
  displayStatus: string
  statusLabel: string
}

type ActivityReferenceSearchResponse = { activities?: ActivityReferenceActivity[] }

function formatActivityTime(startsAt: string | null, endsAt: string | null) {
  if (!startsAt && !endsAt) return ''
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const start = startsAt ? formatter.format(new Date(startsAt)) : ''
  const end = endsAt ? formatter.format(new Date(endsAt)) : ''
  return start && end ? `${start} - ${end}` : start || end
}

export function ActivityReferencePicker({
  open,
  onClose,
  onSelect,
}: Readonly<{
  open: boolean
  onClose: () => void
  onSelect: (activity: ActivityReferenceActivity) => void
}>) {
  const [query, setQuery] = useState('')
  const [activities, setActivities] = useState<ActivityReferenceActivity[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActivities([])
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmedQuery = query.trim()
    setActivities([])
    setError('')
    if (!trimmedQuery) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetch(`/api/activities/reference-search?q=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('活动搜索失败')
          return await response.json() as ActivityReferenceSearchResponse
        })
        .then((data) => setActivities(Array.isArray(data.activities) ? data.activities.slice(0, 15) : []))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          setError(reason instanceof Error ? reason.message : '活动搜索失败，请稍后重试')
          setActivities([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-lg flex-col border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="activity-reference-picker-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="activity-reference-picker-title" className="text-lg font-black text-brand-950">引用活动</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">只显示当前可公开查看的活动，状态会按最新数据更新。</p>
          </div>
          <button type="button" className="shrink-0 px-2 py-1 text-lg font-black text-slate-500" aria-label="关闭活动搜索" onClick={onClose}>×</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索活动名称"
          aria-label="搜索引用活动"
          className="mt-4 min-h-11 w-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm font-bold text-brand-950 outline-none focus:border-brand-500"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {!query.trim() ? <p className="p-4 text-sm font-bold text-slate-500">输入活动名称搜索</p> : null}
          {isLoading ? <p className="p-4 text-sm font-bold text-slate-500">搜索中…</p> : null}
          {error ? <p className="p-4 text-sm font-bold text-red-600" role="alert">{error}</p> : null}
          {!isLoading && !error && query.trim() && !activities.length ? <p className="p-4 text-sm font-bold text-slate-500">没有匹配的公开活动</p> : null}
          <div className="grid gap-2">
            {activities.map((activity) => {
              const cover = activity.coverUrl || activity.bannerUrl
              return (
                <button
                  key={activity.id}
                  type="button"
                  className="flex min-w-0 items-center gap-3 border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-left transition hover:border-brand-300 hover:bg-sky-50"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(activity)}
                >
                  <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-sky-100 text-xl font-black text-brand-700">
                    {cover ? <Image src={cover} alt="" fill sizes="56px" className="object-cover" /> : '活动'}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words font-black text-brand-950">{activity.title}</span>
                    <span className="mt-1 block break-words text-xs font-bold text-slate-500">
                      {[formatActivityTime(activity.startsAt, activity.endsAt), activity.locationName, activity.statusLabel].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
