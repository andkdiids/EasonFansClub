'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { DailyMessageActions } from '@/components/DailyMessageActions'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import type { CheckInMessageItem, CheckInMessageSort } from '@/lib/checkin-messages'
import { getMood } from '@/lib/daily'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

function beijingDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function isAdminRole(role: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

function updateUrl(date: string, sort: CheckInMessageSort) {
  const url = new URL(window.location.href)
  url.searchParams.set('date', date)
  url.searchParams.set('sort', sort)
  window.history.pushState(null, '', `${url.pathname}?${url.searchParams.toString()}`)
}

export function CheckInMessagesPanel({
  initialMessages,
  initialDate,
  maxDate,
  initialSort,
  sessionUserId,
  sessionUserRole,
}: Readonly<{
  initialMessages: CheckInMessageItem[]
  initialDate: string
  maxDate: string
  initialSort: CheckInMessageSort
  sessionUserId: string
  sessionUserRole: string
}>) {
  const [date, setDate] = useState(initialDate)
  const [sort, setSort] = useState<CheckInMessageSort>(initialSort)
  const [messages, setMessages] = useState(initialMessages)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const loadMessages = useCallback(async (nextDate = date, nextSort = sort) => {
    if (isLoading) return

    setError('')
    setIsLoading(true)
    const params = new URLSearchParams({ date: nextDate, sort: nextSort })

    try {
      const response = await fetch(`/api/checkin/messages?${params.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (response.status === 401) {
        window.location.href = '/login'
        return
      }

      if (!response.ok) {
        throw new Error(data.message || '留言列表暂时无法加载，请稍后重试')
      }

      setDate(data.date || nextDate)
      setSort(data.sort === 'hot' ? 'hot' : 'latest')
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      updateUrl(data.date || nextDate, data.sort === 'hot' ? 'hot' : 'latest')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '留言列表暂时无法加载，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }, [date, isLoading, sort])

  useEffect(() => {
    setDate(initialDate)
    setSort(initialSort)
    setMessages(initialMessages)
  }, [initialDate, initialMessages, initialSort])

  useEffect(() => {
    function handleCheckInCompleted(event: Event) {
      const detail = (event as CustomEvent<{ date?: string }>).detail
      const nextDate = detail?.date || maxDate
      loadMessages(nextDate, sort)
    }

    window.addEventListener('checkin:completed', handleCheckInCompleted)
    return () => window.removeEventListener('checkin:completed', handleCheckInCompleted)
  }, [loadMessages, maxDate, sort])

  return (
    <div className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase text-brand-700">E Friends Messages</p>
          <h2 className="mt-2 text-3xl font-black text-brand-950">E友留言</h2>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            loadMessages()
          }}
        >
          <input
            name="date"
            type="date"
            value={date}
            max={maxDate}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-full border border-sky-100 px-4 py-2 text-sm font-bold outline-none"
          />
          <select
            name="sort"
            value={sort}
            onChange={(event) => {
              const nextSort = event.target.value === 'hot' ? 'hot' : 'latest'
              setSort(nextSort)
              loadMessages(date, nextSort)
            }}
            className="rounded-full border border-sky-100 px-4 py-2 text-sm font-bold outline-none"
          >
            <option value="latest">最新</option>
            <option value="hot">热度</option>
          </select>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
          >
            {isLoading ? '加载中' : '查看'}
          </button>
        </form>
      </div>

      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</p> : null}

      <div className="mt-6 space-y-5">
        {messages.length ? messages.map((item) => {
          const mood = getMood(item.mood)
          const name = item.user.profile?.displayName || item.user.nickname
          const avatar = publicImageUrl(item.user.profile?.avatarUrl || item.user.avatarUrl)
          return (
            <article key={item.id} className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm">
              <div className="flex gap-4">
                <a href={`/user/${formatUid(item.user.uid)}`} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sky-50 text-2xl">
                  {avatar ? <Image src={avatar} alt={name} width={48} height={48} className="h-full w-full object-cover" /> : mood?.icon || '🎵'}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/user/${formatUid(item.user.uid)}`} className="font-black text-brand-950">{name}</a>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(item.user.uid)}</span>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{mood?.icon} {mood?.label}</span>
                    <span className="text-xs font-bold text-slate-400">留言日 {date}</span>
                    <span className="text-xs font-bold text-slate-400">发布 {beijingDateTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap leading-8 text-slate-700">{item.content}</p>
                  {item.comments.length ? (
                    <div className="mt-4 space-y-2 rounded-2xl bg-sky-50/70 p-3">
                      {item.comments.map((comment) => (
                        <div key={comment.id} className="text-sm leading-6 text-slate-600">
                          <strong className="text-brand-950">{comment.author.profile?.displayName || comment.author.nickname}：</strong>
                          {comment.content}
                          {sessionUserId === comment.author.id || isAdminRole(sessionUserRole) ? (
                            <span className="ml-2">
                              <DeleteCommentButton endpoint={`/api/daily-message-comments/${comment.id}`} />
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <DailyMessageActions
                    messageId={item.id}
                    likeCount={item.likeCount}
                    favoriteCount={item.favoriteCount}
                    commentCount={item.commentCount}
                    initialLiked={item.likes.length > 0}
                    initialFavorited={item.favorites.length > 0}
                  />
                </div>
              </div>
            </article>
          )
        }) : (
          <div className="rounded-2xl bg-sky-50/80 p-8 text-center font-bold text-slate-500">这一天还没有 E友留言。</div>
        )}
      </div>
    </div>
  )
}
