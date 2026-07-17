'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { UnreadSummary } from '@/lib/notifications'

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">{count > 99 ? '99+' : count}</span>
}

export function UserNotificationMenu({
  displayName,
  avatarUrl,
  isAdmin,
  initialSummary,
}: {
  displayName: string
  avatarUrl?: string | null
  isAdmin: boolean
  initialSummary: UnreadSummary
}) {
  const [summary, setSummary] = useState(initialSummary)

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => fetch('/api/notifications/unread-summary', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<UnreadSummary> : null)
      .then((next) => { if (next) setSummary(next) })
      .catch(() => null)
    const listener = () => void refresh()
    window.addEventListener('unread-summary:refresh', listener)
    const timer = window.setInterval(refresh, 30000)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('unread-summary:refresh', listener) }
  }, [])

  const itemClass = 'flex min-h-11 items-center rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-sky-50'
  return <details className="relative shrink-0">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full bg-sky-50 px-2 py-1 pr-3">
      <span className="relative">
        <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-brand-950 text-sm font-black text-white">
          {avatarUrl ? <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" /> : displayName.slice(0, 1).toUpperCase()}
        </span>
        {summary.total > 0 ? <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-sky-50 bg-red-500" /> : null}
      </span>
      <span className="hidden max-w-28 truncate text-sm font-black text-brand-950 sm:block">{displayName}</span>
    </summary>
    <div className="absolute right-0 mt-3 w-60 rounded-2xl border border-sky-100 bg-white p-2 shadow-xl shadow-sky-900/10">
      <Link href="/profile" className={itemClass}>个人主页</Link>
      <Link href="/notifications" className={itemClass}>消息中心<Badge count={summary.notifications} /></Link>
      <Link href="/feedback" className={itemClass}>我的反馈<Badge count={summary.feedbackReplies} /></Link>
      <Link href="/friends" className={itemClass}>我的好友<Badge count={summary.friendRequests} /></Link>
      <Link href="/notifications?category=message" className={itemClass}>私信<Badge count={summary.directMessages} /></Link>
      <Link href="/settings/security" className={itemClass}>账号安全</Link>
      {isAdmin ? <Link href="/admin" className={`${itemClass} text-brand-700`}>后台管理</Link> : null}
      <form action="/api/auth/logout" method="post"><button className="w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50">退出登录</button></form>
    </div>
  </details>
}
