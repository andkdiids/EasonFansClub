'use client'

import { useEffect, useMemo, useState } from 'react'
import { ModuleFallback } from '@/components/ModuleFallback'
import { IpRegionLabel } from '@/components/IpRegionLabel'
import { getMood } from '@/lib/daily'
import { publicImageVariantUrl } from '@/lib/image-variants'

type CheckIn = { id: string; checkDate: string; mood: string | null; streakDay: number }
type ReplyItem = { id: string; content: string; createdAt: string; ipRegion?: string | null; authorName: string; authorAvatarUrl: string | null }
type Message = {
  id: string
  mood: string
  content: string
  createdAt: string
  ipRegion?: string | null
  likeCount: number
  commentCount: number
  comments: ReplyItem[]
}
type LoadState<T> = { loading: boolean; failed: boolean; data: T }

function initial<T>(data: T): LoadState<T> {
  return { loading: true, failed: false, data }
}

async function loadJson<T>(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(url)
  return (await response.json()) as T
}

export function ProfileDeferredModules() {
  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,40%)_minmax(0,60%)]">
      <ProfileCheckInCalendar />
      <ProfileRecentMessages />
    </section>
  )
}

export function ProfileCheckInCalendar() {
  const [checkIns, setCheckIns] = useState<LoadState<CheckIn[]>>(initial([]))
  const [longestStreak, setLongestStreak] = useState(0)
  const monthStart = useMemo(() => {
    const date = new Date()
    date.setDate(1)
    date.setHours(0, 0, 0, 0)
    return date
  }, [])

  useEffect(() => {
    loadJson<{ checkIns: CheckIn[]; longestStreak: number }>('/api/profile/checkins')
      .then((data) => {
        setCheckIns({ loading: false, failed: false, data: data.checkIns })
        setLongestStreak(data.longestStreak)
      })
      .catch(() => setCheckIns({ loading: false, failed: true, data: [] }))
  }, [])

  return (
    <div id="checkin-records" className="h-full scroll-mt-20 rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-3 pb-4 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[22px] font-black leading-tight text-brand-950">本月挂号日历</h2>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">
          最长连续 {longestStreak} 天
        </span>
      </div>
      <div className="mt-3">
        {checkIns.failed ? <ModuleFallback /> : null}
        {checkIns.loading ? <ModuleFallback title="正在加载签到..." /> : null}
        {!checkIns.loading && !checkIns.failed ? (
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {Array.from({ length: new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate() }, (_, index) => {
              const day = index + 1
              const record = checkIns.data.find((item) => new Date(item.checkDate).getDate() === day)
              const mood = getMood(record?.mood || '')
              return (
                <div key={day} className={`flex h-12 flex-col items-center justify-center rounded-lg p-1 text-center text-xs font-black sm:h-[60px] ${record ? 'bg-brand-700 text-white' : 'bg-sky-50 text-slate-400'}`}>
                  <span>{day}</span>
                  <span className="mt-0.5 block text-base leading-none">{mood?.icon || ''}</span>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ProfileRecentMessages() {
  const [messages, setMessages] = useState<LoadState<Message[]>>(initial([]))
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    loadJson<{ messages: Message[] }>('/api/profile/messages')
      .then((data) => setMessages({ loading: false, failed: false, data: data.messages }))
      .catch(() => setMessages({ loading: false, failed: true, data: [] }))
  }, [])

  function toggleExpand(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }

  async function deleteMessage(id: string) {
    if (deletingId) return
    if (!window.confirm('确认删除这条挂号留言吗？')) return

    setDeletingId(id)
    setDeleteError('')
    try {
      const response = await fetch(`/api/daily-messages/${id}`, { method: 'DELETE', credentials: 'same-origin' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '留言删除失败')
      setMessages((current) => ({ ...current, data: current.data.filter((item) => item.id !== id) }))
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '留言删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
<div className="h-full  border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-2xl font-black text-brand-950">最近留言</h2>
      {deleteError ? <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{deleteError}</p> : null}
      <div className="mt-5 space-y-3">
        {messages.failed ? <ModuleFallback /> : null}
        {messages.loading ? <ModuleFallback title="正在加载留言..." /> : null}
        {!messages.loading && !messages.failed && messages.data.length ? messages.data.map((item) => {
          const mood = getMood(item.mood)
          const isExpanded = Boolean(expanded[item.id])
          const hasReplies = item.commentCount > 0 || item.comments.length > 0
          return (
<article
  key={item.id}
  className=" border border-[var(--border)] bg-[var(--surface-subtle)] p-4"
>
              <div className="flex items-center gap-2 text-sm font-black text-brand-950">
                <span className="text-base">{mood?.icon || '🎵'}</span>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
                <IpRegionLabel ipRegion={item.ipRegion} />
              </div>
              <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-slate-600">{item.content}</p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {item.likeCount > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-600">
                    ♥ {item.likeCount}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-400">
                    ♡ 0
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleExpand(item.id)}
                  disabled={!hasReplies}
                  className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  💬 回复 {item.commentCount}
                  {hasReplies ? <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span> : null}
                </button>
                <button
                  type="button"
                  onClick={() => deleteMessage(item.id)}
                  disabled={deletingId === item.id}
                  className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-xs font-black text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingId === item.id ? '删除中…' : '删除'}
                </button>
              </div>

              {isExpanded && hasReplies ? (
                <ul className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                  {item.comments.length ? item.comments.map((reply) => (
                    <li key={reply.id} className="flex gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-xs font-black text-white">
                        {reply.authorAvatarUrl ? <img src={publicImageVariantUrl(reply.authorAvatarUrl, 'avatar-md') || reply.authorAvatarUrl} alt={reply.authorName} className="h-full w-full object-cover" loading="lazy" /> : (reply.authorName || '匿').slice(0, 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black text-brand-950">{reply.authorName}</span>
                          <time className="text-[11px] font-bold text-slate-400">{new Date(reply.createdAt).toLocaleString('zh-CN')}</time>
                          <IpRegionLabel ipRegion={reply.ipRegion} />
                        </div>
                        <p className="mt-0.5 break-words text-sm font-bold leading-5 text-slate-600">{reply.content}</p>
                      </div>
                    </li>
                  )) : (
                    <li className="text-xs font-bold text-slate-400">暂无回复内容</li>
                  )}
                </ul>
              ) : null}
            </article>
          )
        }) : null}
        {!messages.loading && !messages.failed && !messages.data.length ? <ModuleFallback title="还没有历史留言。" /> : null}
      </div>
    </div>
  )
}
