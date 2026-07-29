'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { getNotificationTarget } from '@/lib/notification-target'
import type { UnifiedNotification, UnreadSummary } from '@/lib/notifications'

type NotificationCategory = 'all' | 'reply' | 'like' | 'friend' | 'messages' | 'feedback' | 'system'

const categoryLabels: Record<NotificationCategory, string> = {
  all: '全部',
  reply: '回复',
  like: '点赞',
  friend: '好友申请',
  messages: '私信',
  feedback: '反馈',
  system: '系统',
}

const typeIcon: Record<string, string> = {
  reply: '↩',
  like: '♥',
  friend: '+',
  messages: '✉',
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

function getInitial(uid?: number | null) {
  return uid ? String(uid).padStart(5, '0').slice(0, 1) : 'E'
}

export function NotificationsClient({
  initialNotifications,
  initialUnreadSummary,
}: {
  initialNotifications: UnifiedNotification[]
  initialUnreadSummary: UnreadSummary
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unreadSummary, setUnreadSummary] = useState(initialUnreadSummary)
  const unreadCount = unreadSummary.total
  const [activeCategory, setActiveCategory] = useState<NotificationCategory>('all')
  const [isUpdating, setIsUpdating] = useState(false)
  const [replyingKey, setReplyingKey] = useState<string | null>(null)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [replyStatus, setReplyStatus] = useState<Record<string, string>>({})
  const [sendingReply, setSendingReply] = useState<string | null>(null)

  useEffect(() => {
    const saved = window.sessionStorage.getItem('notifications:return-state')
    if (!saved) return
    window.sessionStorage.removeItem('notifications:return-state')
    try {
      const state = JSON.parse(saved) as { category?: NotificationCategory; scrollY?: number }
      if (state.category && state.category in categoryLabels) setActiveCategory(state.category)
      window.requestAnimationFrame(() => window.scrollTo({ top: Number(state.scrollY) || 0, behavior: 'auto' }))
    } catch {
      // Ignore stale navigation state.
    }
  }, [])

  useEffect(() => {
    const dismissed = new Set(JSON.parse(window.localStorage.getItem('notifications:dismissed-system') || '[]') as string[])
    if (!dismissed.size) return
    const hiddenUnread = notifications.filter((item) => item.source === 'system' && dismissed.has(item.id) && !item.isRead)
    setNotifications((current) => current.filter((item) => item.source !== 'system' || !dismissed.has(item.id)))
    if (!hiddenUnread.length) return
    setUnreadSummary((summary) => ({
      ...summary,
      notifications: Math.max(0, summary.notifications - hiddenUnread.length),
      system: Math.max(0, summary.system - hiddenUnread.length),
      total: Math.max(0, summary.total - hiddenUnread.length),
    }))
    void fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: hiddenUnread.map((item) => ({ id: item.id, source: 'system' })) }),
    }).then((response) => {
      if (response.ok) window.dispatchEvent(new Event('unread-summary:refresh'))
    })
    // The initial server list is the only input needed to reconcile legacy local dismissals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categoryCounts = useMemo(() => {
    return {
      all: unreadSummary.total,
      reply: unreadSummary.replies,
      like: unreadSummary.likes,
      friend: unreadSummary.friendRequests,
      messages: unreadSummary.messages,
      feedback: unreadSummary.feedback,
      system: unreadSummary.system,
    } satisfies Record<NotificationCategory, number>
  }, [unreadSummary])

  const filteredNotifications = useMemo(() => {
    if (activeCategory === 'all') return notifications
    return notifications.filter((item) => item.category === activeCategory)
  }, [activeCategory, notifications])

  async function refreshUnreadSummary() {
    const response = await fetch('/api/notifications/unread-summary', { cache: 'no-store' })
    if (!response.ok) return
    setUnreadSummary(await response.json() as UnreadSummary)
  }

  useEffect(() => {
    const requestedCategory = searchParams.get('category') as NotificationCategory | null
    if (requestedCategory && requestedCategory in categoryLabels) setActiveCategory(requestedCategory)
  }, [searchParams])

  useEffect(() => {
    const refresh = () => void refreshUnreadSummary()
    window.addEventListener('unread-summary:refresh', refresh)
    return () => window.removeEventListener('unread-summary:refresh', refresh)
  }, [])

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
    window.dispatchEvent(new Event('unread-summary:refresh'))
    router.refresh()
  }

  async function openNotification(event: MouseEvent<HTMLAnchorElement>, item: UnifiedNotification) {
    event.preventDefault()
    const target = getNotificationTarget(item)
    if (!target) return
    try {
      await markRead(item)
    } catch (reason) {
      if (process.env.NODE_ENV === 'development') console.error('[notification:mark-read]', reason)
    } finally {
      window.sessionStorage.setItem('notifications:return-state', JSON.stringify({
        category: activeCategory,
        scrollY: window.scrollY,
      }))
      router.push(target)
    }
  }

  async function sendDirectReply(item: UnifiedNotification) {
    const key = `${item.source}:${item.id}`
    const target = item.replyTarget
    const content = (replyDrafts[key] || '').trim()
    if (!target || !content || sendingReply) return

    const request = target.kind === 'post'
      ? { url: `/api/posts/${target.resourceId}/replies`, body: { content, parentId: target.parentId } }
      : target.kind === 'daily-message'
        ? { url: `/api/daily-messages/${target.resourceId}/comments`, body: { content, parentId: target.parentId } }
        : target.kind === 'feedback'
          ? { url: `/api/feedback/${target.resourceId}/replies`, body: { content, attachments: [] } }
          : { url: '/api/profile-wall', body: { receiverUid: Number(target.resourceId), content, parentId: target.parentId } }

    setSendingReply(key)
    setReplyStatus((current) => ({ ...current, [key]: '' }))
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      const data = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) throw new Error(data.message || '回复失败，请稍后重试')
      await markRead(item)
      setReplyDrafts((current) => ({ ...current, [key]: '' }))
      setReplyingKey(null)
      setReplyStatus((current) => ({ ...current, [key]: '回复成功' }))
    } catch (error) {
      setReplyStatus((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : '回复失败，请稍后重试',
      }))
    } finally {
      setSendingReply(null)
    }
  }

  async function markAllRead() {
    setIsUpdating(true)
    const response = await fetch('/api/notifications/read-all', { method: 'POST' })
    setIsUpdating(false)
    if (!response.ok) return
    setNotifications((current) => current.map((row) => ({ ...row, isRead: true, readAt: row.readAt || new Date() })))
    window.dispatchEvent(new Event('unread-summary:refresh'))
    await refreshUnreadSummary()
    router.refresh()
  }

  async function clearNotifications(items: UnifiedNotification[]) {
    const personalIds = items.filter((item) => item.source === 'personal').map((item) => item.id)
    if (personalIds.length) {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: personalIds }),
      })
      if (!response.ok) return
    }
    const systemIds = items.filter((item) => item.source === 'system').map((item) => item.id)
    if (systemIds.length) {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: systemIds.map((id) => ({ id, source: 'system' })) }),
      })
      if (!response.ok) return
      const dismissed = new Set(JSON.parse(window.localStorage.getItem('notifications:dismissed-system') || '[]') as string[])
      systemIds.forEach((id) => dismissed.add(id))
      window.localStorage.setItem('notifications:dismissed-system', JSON.stringify(Array.from(dismissed).slice(-500)))
    }
    const keys = new Set(items.map((item) => `${item.source}:${item.id}`))
    setNotifications((current) => current.filter((item) => !keys.has(`${item.source}:${item.id}`)))
    window.dispatchEvent(new Event('unread-summary:refresh'))
  }

  function renderNotification(item: UnifiedNotification) {
    const itemKey = `${item.source}:${item.id}`
    const category = (item.category || 'system') as NotificationCategory
    const target = getNotificationTarget(item)
    const content = (
      <article
        className={`notification-list-item group relative overflow-hidden rounded-sm border p-4 transition sm:p-5 ${
          item.isRead
            ? `border-sky-100 bg-white/82 ${target ? 'hover:bg-white' : 'opacity-80'}`
            : 'border-sky-200 bg-sky-50/88 shadow-sky-900/5'
        }`}
      >
        {!item.isRead ? <span className="absolute left-0 top-6 h-8 w-1.5 rounded-r-full bg-sky-500" /> : null}
        <div className="flex min-w-0 gap-3 sm:gap-4">
          <div className="relative shrink-0">
            <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-brand-950 text-sm font-black text-white sm:h-12 sm:w-12">
              {item.actorAvatarUrl ? <img src={item.actorAvatarUrl} alt={item.actorName || item.title} className="h-full w-full object-cover" /> : getInitial(item.actorUid)}
            </span>
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-sky-100 text-[11px] font-black text-brand-700">
              {typeIcon[category] || 'i'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-black text-brand-700 ring-1 ring-sky-100">{item.typeLabel}</span>
              {!item.isRead ? <span className="rounded-full bg-sky-500 px-2.5 py-1 text-[11px] font-black text-white">未读</span> : null}
              {!target ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">暂无详情页</span> : null}
              <time className="text-xs font-bold text-slate-400">{formatTime(item.createdAt)}</time>
            </div>
            <h2 className="mt-2 break-words text-base font-black text-slate-950 sm:text-lg">{item.title}</h2>
            {item.content ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-600">{item.content}</p> : null}
            {target ? <span className="mt-3 inline-flex text-xs font-black text-brand-700">查看详情 →</span> : null}
          </div>
        </div>
      </article>
    )

    return (
      <div key={itemKey} id={`notification-${item.id}`} className="relative scroll-mt-20">
        {target ? (
          <Link href={target} onClick={(event) => void openNotification(event, item)} className="block min-h-12 w-full text-left">{content}</Link>
        ) : (
          <div className="min-h-12 w-full cursor-default text-left" aria-disabled="true">{content}</div>
        )}
        <button type="button" onClick={() => void clearNotifications([item])} className="absolute right-3 top-3 z-10 rounded-sm border border-sky-100 bg-white px-3 py-1.5 text-xs font-black text-slate-500 hover:text-red-600">清除</button>
        {item.replyTarget && !item.replyDisabledReason ? (
          <button
            type="button"
            onClick={() => setReplyingKey((current) => current === itemKey ? null : itemKey)}
            className="absolute right-3 top-12 z-10 min-h-9 rounded-sm border border-sky-100 bg-white px-3 py-1.5 text-xs font-black text-brand-700"
          >
            直接回复
          </button>
        ) : null}
        {item.replyDisabledReason ? <p className="border border-t-0 border-sky-100 bg-white px-4 py-3 text-sm font-black text-slate-500">{item.replyDisabledReason}</p> : null}
        {replyingKey === itemKey && item.replyTarget ? (
          <div className="border border-t-0 border-sky-100 bg-white p-4">
            <label htmlFor={`notification-reply-${item.id}`} className="text-xs font-black text-brand-700">
              回复 @{item.actorName || '对方'}
            </label>
            <textarea
              id={`notification-reply-${item.id}`}
              value={replyDrafts[itemKey] || ''}
              maxLength={item.replyTarget.kind === 'daily-message' ? 300 : item.replyTarget.kind === 'profile-wall' ? 500 : 2000}
              onChange={(event) => setReplyDrafts((current) => ({ ...current, [itemKey]: event.target.value }))}
              className="mt-2 min-h-20 w-full resize-y rounded-sm border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setReplyingKey(null)} className="min-h-10 rounded-sm border border-sky-100 px-4 text-sm font-black text-slate-600">取消</button>
              <button
                type="button"
                disabled={sendingReply === itemKey || !(replyDrafts[itemKey] || '').trim()}
                onClick={() => void sendDirectReply(item)}
                className="min-h-10 rounded-sm bg-brand-950 px-4 text-sm font-black text-white disabled:opacity-50"
              >
                {sendingReply === itemKey ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        ) : null}
        {replyStatus[itemKey] ? <p className={`px-4 py-2 text-sm font-black ${replyStatus[itemKey] === '回复成功' ? 'text-emerald-600' : 'text-red-600'}`}>{replyStatus[itemKey]}</p> : null}
      </div>
    )
  }

  return (
    <section className="notification-center space-y-5">
      <div className="rounded-[28px] border border-sky-100 bg-white/78 p-5 shadow-sm shadow-sky-900/5 backdrop-blur-xl sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.2em] text-brand-700">通知中心</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">通知中心</h1>
            <p className="mt-3 text-sm font-bold text-slate-500">未读通知 <span className="text-brand-700">{unreadCount}</span> 条</p>
          </div>
          <div className="flex flex-wrap gap-2"><button
            type="button"
            onClick={markAllRead}
            disabled={isUpdating || unreadCount === 0}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            全部已读
          </button><button type="button" onClick={() => void clearNotifications(notifications)} disabled={isUpdating || notifications.length === 0} className="inline-flex h-11 items-center justify-center rounded-xl border border-sky-100 bg-white px-5 text-sm font-black text-slate-600 disabled:opacity-50">清除通知</button></div>
        </div>
      </div>

      <div className="flat-tabs flex overflow-x-auto border-b border-sky-100">
        {(Object.keys(categoryLabels) as NotificationCategory[]).map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`rounded-none border-b-2 px-4 py-2 text-sm font-black transition ${
              activeCategory === category
                ? 'border-brand-700 text-brand-700'
                : 'border-transparent text-slate-500 hover:bg-sky-50'
            }`}
          >
            {categoryLabels[category]} {categoryCounts[category]}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {activeCategory === 'messages' ? (
          <div className="rounded-[24px] border border-sky-100 bg-white/82 p-8 text-center">
            <p className="text-lg font-black text-brand-950">未读私信 {unreadSummary.messages} 条</p>
            <p className="mt-2 text-sm font-bold text-slate-500">私信不会复制成普通通知，点击后在好友窗口查看会话。</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('friend-dock:open'))}
              className="mt-4 min-h-11 rounded-xl bg-brand-950 px-5 text-sm font-black text-white"
            >
              打开好友与私信
            </button>
          </div>
        ) : filteredNotifications.length ? (
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
