'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { UnifiedNotification } from '@/lib/notifications'

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
  const [isUpdating, setIsUpdating] = useState(false)

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
    router.refresh()
  }

  async function markAllRead() {
    setIsUpdating(true)
    const response = await fetch('/api/notifications/read-all', { method: 'POST' })
    setIsUpdating(false)
    if (!response.ok) return
    setNotifications((current) => current.map((row) => ({ ...row, isRead: true, readAt: row.readAt || new Date() })))
    setUnreadCount(0)
    router.refresh()
  }

  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-black text-slate-500">未读 {unreadCount}</p>
        <button
          onClick={markAllRead}
          disabled={isUpdating || unreadCount === 0}
          className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          全部标记已读
        </button>
      </div>

      {notifications.length ? (
        notifications.map((item) => (
          <article key={`${item.source}:${item.id}`} className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-black text-slate-950">{item.title}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{item.content}</p>
                <p className="mt-3 text-xs font-bold text-slate-400">
                  {item.type} · {new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </p>
                {item.link ? (
                  <Link onClick={() => markRead(item)} href={item.link} className="mt-3 inline-flex rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">
                    查看详情
                  </Link>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-black ${item.isRead ? 'bg-slate-100 text-slate-500' : 'bg-sky-100 text-brand-700'}`}>
                  {item.isRead ? '已读' : '未读'}
                </span>
                {!item.isRead ? (
                  <button onClick={() => markRead(item)} disabled={isUpdating} className="text-xs font-black text-brand-700 disabled:opacity-50">
                    标记已读
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))
      ) : (
        <div className="rounded-2xl border border-sky-100 bg-white/80 p-8 text-center font-bold text-slate-500">
          暂时没有通知
        </div>
      )}
    </section>
  )
}
