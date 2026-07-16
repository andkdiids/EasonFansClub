'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type MouseEvent } from 'react'
import { getNotificationTarget } from '@/lib/notification-target'
import type { UnifiedNotification } from '@/lib/notifications'

type NotificationCategory = 'all' | 'reply' | 'like' | 'friend' | 'feedback' | 'system'

const categoryLabels: Record<NotificationCategory, string> = {
  all: '全部',
  reply: '回复',
  like: '点赞',
  friend: '好友',
  feedback: '反馈',
  system: '系统',
}

const typeIcon: Record<string, string> = {
  reply: '↩',
  like: '♥',
  friend: '+',
  feedback: '!',
  system: 'i',
}

function formatTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function getInitial(name?: string | null) {
  return (name || 'E').slice(0, 1).toUpperCase()
}

export function NotificationsClient({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: UnifiedNotification[]
  initialUnreadCount: number
}) {
  const router = useRouter()
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [activeCategory, setActiveCategory] = useState<NotificationCategory>('all')
  const [isUpdating, setIsUpdating] = useState(false)

  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(Object.keys(categoryLabels).map((key) => [key, 0])) as Record<NotificationCategory, number>
    counts.all = notifications.length
    notifications.forEach((item) => {
      const category = (item.category || 'system') as NotificationCategory
      if (counts[category] !== undefined) counts[category] += 1
    })
    return counts
  }, [notifications])

  const filteredNotifications = useMemo(() => {
    if (activeCategory === 'all') return notifications
    return notifications.filter((item) => item.category === activeCategory)
  }, [activeCategory, notifications])

  async function markRead(item: UnifiedNotification) {
    if (item.isRead) return
    setIsUpdating(true)
    const response = await fetch(`/api/notifications/${item.id}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: item.source }),
    })
    setIsUpdating(false)
    if (!response.ok) return
    setNotifications((current) => current.map((row) => row.id === item.id && row.source === item.source ? { ...row, isRead: true, readAt: new Date() } : row))
    setUnreadCount((count) => Math.max(count - 1, 0))
    window.dispatchEvent(new Event('unread-summary:refresh'))
    router.refresh()
  }

  async function openNotification(event: MouseEvent<HTMLAnchorElement>, item: UnifiedNotification) {
    event.preventDefault()
    const target = getNotificationTarget(item)
    try {
      await markRead(item)
    } catch (reason) {
      if (process.env.NODE_ENV === 'development') console.error('[notification:mark-read]', reason)
    } finally {
      router.push(target)
    }
  }

  async function markAllRead() {
    setIsUpdating(true)
    const response = await fetch('/api/notifications/read-all', { method: 'POST' })
    setIsUpdating(false)
    if (!response.ok) return
    setNotifications((current) => current.map((row) => ({ ...row, isRead: true, readAt: row.readAt || new Date() })))
    setUnreadCount(0)
    window.dispatchEvent(new Event('unread-summary:refresh'))
    router.refresh()
  }

  function renderNotification(item: UnifiedNotification) {
    const category = (item.category || 'system') as NotificationCategory
    const content = (
      <article
        className={`group relative overflow-hidden rounded-[24px] border p-4 shadow-sm transition sm:p-5 ${
          item.isRead
            ? 'border-sky-100 bg-white/82 hover:bg-white'
            : 'border-sky-200 bg-sky-50/88 shadow-sky-900/5'
        }`}
      >
        {!item.isRead ? <span className="absolute left-0 top-6 h-8 w-1.5 rounded-r-full bg-sky-500" /> : null}
        <div className="flex min-w-0 gap-3 sm:gap-4">
          <div className="relative shrink-0">
            <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-brand-950 text-sm font-black text-white sm:h-12 sm:w-12">
              {item.actorAvatarUrl ? <img src={item.actorAvatarUrl} alt={item.actorName || item.title} className="h-full w-full object-cover" /> : getInitial(item.actorName || item.typeLabel)}
            </span>
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-sky-100 text-[11px] font-black text-brand-700">
              {typeIcon[category] || 'i'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-black text-brand-700 ring-1 ring-sky-100">{item.typeLabel}</span>
              {!item.isRead ? <span className="rounded-full bg-sky-500 px-2.5 py-1 text-[11px] font-black text-white">未读</span> : null}
              <time className="text-xs font-bold text-slate-400">{formatTime(item.createdAt)}</time>
            </div>
            <h2 className="mt-2 break-words text-base font-black text-slate-950 sm:text-lg">{item.title}</h2>
            {item.content ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-600">{item.content}</p> : null}
          </div>
        </div>
      </article>
    )

    return (
      <Link key={`${item.source}:${item.id}`} href={getNotificationTarget(item)} onClick={(event) => void openNotification(event, item)} className="block min-h-12 w-full text-left">
        {content}
      </Link>
    )
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[28px] border border-sky-100 bg-white/78 p-5 shadow-sm shadow-sky-900/5 backdrop-blur-xl sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">Message Center</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">通知中心</h1>
            <p className="mt-3 text-sm font-bold text-slate-500">未读通知 <span className="text-brand-700">{unreadCount}</span> 条</p>
          </div>
          <button
            type="button"
            onClick={markAllRead}
            disabled={isUpdating || unreadCount === 0}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            全部已读
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(categoryLabels) as NotificationCategory[]).map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`rounded-full px-4 py-2 text-sm font-black transition ${
              activeCategory === category
                ? 'bg-brand-950 text-white shadow-sm'
                : 'border border-sky-100 bg-white/82 text-brand-700 hover:bg-sky-50'
            }`}
          >
            {categoryLabels[category]} {categoryCounts[category]}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredNotifications.length ? (
          filteredNotifications.map(renderNotification)
        ) : (
          <div className="rounded-[24px] border border-sky-100 bg-white/82 p-10 text-center">
            <p className="text-lg font-black text-brand-950">暂无通知</p>
            <p className="mt-2 text-sm font-bold text-slate-500">新的回复、点赞、好友和系统消息会出现在这里。</p>
          </div>
        )}
      </div>

      <div className="sr-only" aria-live="polite">未读通知 {unreadCount}</div>
    </section>
  )
}
