'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useNotificationSummary } from '@/components/NotificationProvider'
import { SafeAvatar } from '@/components/SafeAvatar'

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">{count > 99 ? '99+' : count}</span>
}

export function UserNotificationMenu({
  displayName,
  uid,
  avatarUrl,
  isAdmin,
  currentUserId,
}: {
  displayName: string
  uid: number
  avatarUrl?: string | null
  isAdmin: boolean
  currentUserId: string
}) {
  const { summary } = useNotificationSummary()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
      if (loggingOut) return

  setLoggingOut(true)

  try {
        const response = await fetch('/api/auth/logout', {
      method: 'POST',
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error('退出登录失败')
    }

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(`eason-private-sync:${currentUserId}`)
      channel.postMessage({ type: 'logout', userId: currentUserId })
      channel.close()
    }
    window.location.replace('/login')
      } catch {
    setLoggingOut(false)
    window.alert('退出登录失败，请稍后重试')
  }
}

  const itemClass = 'flex min-h-10 items-center rounded-sm px-3 py-2 text-sm font-bold text-slate-700 hover:bg-sky-50'
  return <details data-user-menu className="relative z-[var(--layer-popover)] shrink-0">
    <summary className="site-user-menu-trigger flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-sm border border-sky-100 bg-white px-1.5 py-1 pr-3">
      <span className="relative">
        <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-brand-950 text-sm font-black text-white">
          <SafeAvatar src={avatarUrl} name={displayName} uid={uid} />
        </span>
        {summary.total > 0 ? <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-sky-50 bg-red-500" /> : null}
      </span>
      <span className="site-user-menu-name hidden max-w-28 truncate text-sm font-black text-brand-950 transition-colors duration-500 sm:block">{displayName}</span>
    </summary>
    <div data-user-menu-panel className="pointer-events-auto absolute right-0 z-[var(--layer-popover)] mt-2 w-60 rounded-sm border border-sky-100 bg-white p-2 shadow-sm">
      <Link href="/profile" className={itemClass}>个人主页</Link>
      <Link href="/notifications" className={itemClass}>消息中心<Badge count={summary.notifications} /></Link>
      <Link href="/feedback" className={itemClass}>我的反馈<Badge count={summary.feedbackReplies} /></Link>
      <Link href="/friends" className={itemClass}>我的好友<Badge count={summary.friendRequests} /></Link>
      <Link href="/notifications?category=messages" className={itemClass}>私信<Badge count={summary.directMessages} /></Link>
      <Link href="/settings/security" className={itemClass}>账号安全</Link>
      {isAdmin ? <Link href="/admin" className={`${itemClass} text-brand-700`}>后台管理</Link> : null}
<button
  type="button"
  onClick={handleLogout}
  disabled={loggingOut}
  className="w-full rounded-xl px-4 py-2 text-left text-sm font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
>
  {loggingOut ? '退出中…' : '退出登录'}
</button>    </div>
  </details>
}
