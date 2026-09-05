'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SafeAvatar } from '@/components/SafeAvatar'
import { Pagination } from '@/components/ui/Pagination'
import { getMoodDisplay } from '@/lib/checkin-mood'
import { profileImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import { normalizeStoredInternalPath } from '@/lib/url-safety'
import { UserDisplayName } from '@/components/UserDisplayName'
import { getFriendDisplayName, normalizeFriendRemark } from '@/lib/friend-display-name'

type ActivityType = '' | 'CHECKIN' | 'POST' | 'BADGE'
type TimeFilter = 'today' | 'yesterday' | '7days' | 'custom'
type FriendActivity = {
  id: string
  mood: string | null
  moodType?: string | null
  moodEmoji?: string | null
  moodText?: string | null
  content: string | null
  type: 'CHECKIN' | 'POST' | 'BADGE'
  targetUrl: string | null
  createdAt: string
  actor: {
    id: string
    uid: number
    nickname: string
    displayName?: string | null
    friendRemark?: string | null
    equippedBadges?: import('@/lib/badge-types').EquippedBadgeView[]
    equippedBadge?: import('@/lib/badge-types').EquippedBadgeView | null
    avatarUrl: string | null
    profile: { displayName: string | null; avatarUrl: string | null } | null
  }
}
type Pagination = { page: number; limit: number; total: number; totalPages: number; hasPrevious: boolean; hasNext: boolean }

const inputClass = 'rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm font-black text-brand-950 outline-none focus:border-brand-400'

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateRange(filter: TimeFilter, customStart: string, customEnd: string) {
  const today = new Date()
  if (filter === 'today') {
    const value = dateKey(today)
    return { startDate: value, endDate: value }
  }
  if (filter === 'yesterday') {
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const value = dateKey(yesterday)
    return { startDate: value, endDate: value }
  }
  if (filter === '7days') {
    const start = new Date(today)
    start.setDate(start.getDate() - 6)
    return { startDate: dateKey(start), endDate: dateKey(today) }
  }
  return { startDate: customStart, endDate: customEnd }
}

export function FriendActivityPanel({ compact = false }: Readonly<{ compact?: boolean }>) {
  const [activities, setActivities] = useState<FriendActivity[]>([])
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('7days')
  const [activityType, setActivityType] = useState<ActivityType>('')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [page, setPage] = useState(1)
  const limit = compact ? 10 : 20
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit, total: 0, totalPages: 1, hasPrevious: false, hasNext: false })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const range = dateRange(timeFilter, customStart, customEnd)
    const params = new URLSearchParams({ page: compact ? '1' : String(page), limit: String(limit) })
    if (activityType) params.set('type', activityType)
    if (range.startDate) params.set('startDate', range.startDate)
    if (range.endDate) params.set('endDate', range.endDate)
    setLoading(true)
    setFailed('')

    fetch(`/api/friends/activity?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.message || '好友动态加载失败')
        return data
      })
      .then((data) => {
        setActivities(Array.isArray(data.activities) ? data.activities : [])
        setPagination(data.pagination || { page, limit, total: 0, totalPages: 1, hasPrevious: false, hasNext: false })
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setFailed(error instanceof Error ? error.message : '好友动态加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [activityType, compact, customEnd, customStart, limit, page, timeFilter])

  useEffect(() => {
    const updateRemark = (event: Event) => {
      const detail = (event as CustomEvent<{ targetUserId?: string; remark?: string | null }>).detail
      if (!detail?.targetUserId) return
      const friendRemark = normalizeFriendRemark(detail.remark)
      setActivities((current) => current.map((item) => item.actor.id === detail.targetUserId
        ? {
            ...item,
            actor: {
              ...item.actor,
              friendRemark,
              displayName: getFriendDisplayName({ nickname: item.actor.nickname, friendRemark, isFriendContext: true }),
            },
          }
        : item))
    }
    window.addEventListener('friend-remark:updated', updateRemark)
    return () => window.removeEventListener('friend-remark:updated', updateRemark)
  }, [])

  function changeTime(value: TimeFilter) {
    setTimeFilter(value)
    setPage(1)
  }

  return (
    <section className="rounded-sm border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Activity</p>
          <h2 className="mt-1 text-2xl font-black text-brand-950">好友动态</h2>
        </div>
        <p className="text-xs font-bold text-slate-500">{compact ? '最近 7 天 · 最多 10 条' : `共 ${pagination.total} 条`}</p>
      </div>
      {!compact ? <div className="mt-5 grid gap-3 bg-sky-50/70 p-4 md:grid-cols-2">
        <label className="text-xs font-black text-slate-600">时间筛选
          <select value={timeFilter} onChange={(event) => changeTime(event.target.value as TimeFilter)} className={`${inputClass} mt-1 w-full`}>
            <option value="today">今天</option>
            <option value="yesterday">昨天</option>
            <option value="7days">最近 7 天</option>
            <option value="custom">自定义日期</option>
          </select>
        </label>
        <label className="text-xs font-black text-slate-600">类型筛选
          <select value={activityType} onChange={(event) => { setActivityType(event.target.value as ActivityType); setPage(1) }} className={`${inputClass} mt-1 w-full`}>
            <option value="">全部</option>
            <option value="CHECKIN">今日挂号</option>
            <option value="POST">最近发帖</option>
            <option value="BADGE">获得勋章</option>
          </select>
        </label>
        {timeFilter === 'custom' ? <>
          <label className="text-xs font-black text-slate-600">开始日期<input type="date" value={customStart} onChange={(event) => { setCustomStart(event.target.value); setPage(1) }} className={`${inputClass} mt-1 w-full`} /></label>
          <label className="text-xs font-black text-slate-600">结束日期<input type="date" value={customEnd} onChange={(event) => { setCustomEnd(event.target.value); setPage(1) }} className={`${inputClass} mt-1 w-full`} /></label>
        </> : null}
      </div> : null}

      <div className="mt-5 space-y-3">
        {loading ? <p className="rounded-2xl bg-sky-50 p-5 text-center text-sm font-black text-slate-500">好友动态加载中...</p> : null}
        {failed ? <p className="rounded-2xl bg-red-50 p-5 text-center text-sm font-black text-red-600">{failed}</p> : null}
        {!loading && !failed && !activities.length ? <p className="rounded-2xl bg-sky-50 p-5 text-center text-sm font-black text-slate-500">该筛选条件下暂无好友动态</p> : null}
        {!loading && !failed ? activities.map((item) => {
          const mood = item.type === 'CHECKIN' ? getMoodDisplay(item) : null
          const name = getFriendDisplayName({ nickname: item.actor.nickname, friendRemark: item.actor.friendRemark, isFriendContext: true })
          const avatar = profileImageUrl(item.actor.profile?.avatarUrl || item.actor.avatarUrl)
          const typeLabel = item.type === 'CHECKIN' ? '今日挂号' : item.type === 'BADGE' ? '获得勋章' : '最近发帖'
          const targetUrl = normalizeStoredInternalPath(item.targetUrl)
          return (
            <article key={item.id} className="border border-sky-100 bg-sky-50/60 p-4">
              <div className="flex gap-3">
                <a href={`/user/${formatUid(item.actor.uid)}`} className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-white">
                  <SafeAvatar src={avatar} name={name} uid={item.actor.uid} className="h-full w-full" />
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/user/${formatUid(item.actor.uid)}`} className="font-black text-brand-950"><UserDisplayName name={name} uid={item.actor.uid} badges={item.actor.equippedBadges} badge={item.actor.equippedBadge} compact /></a>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(item.actor.uid)}</span>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">{item.type === 'CHECKIN' ? `${mood?.icon || '✚'} ${mood?.label || typeLabel}` : item.type === 'BADGE' ? `🎖 ${typeLabel}` : `✎ ${typeLabel}`}</span>
                  </div>
                  {item.content ? <p className="mt-2 line-clamp-3 text-sm font-bold leading-6 text-slate-600">{item.content}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {targetUrl ? <Link href={targetUrl} className="text-xs font-black text-brand-700">查看原动态</Link> : <span />}
                    <time className="text-xs font-bold text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
                  </div>
                </div>
              </div>
            </article>
          )
        }) : null}
      </div>

      {compact ? <Link href="/friends/activity" className="mt-5 flex min-h-11 items-center justify-center border-t border-sky-100 pt-5 text-sm font-black text-brand-700">查看更多动态</Link> : null}
      {!compact && !loading && !failed && pagination.totalPages > 1 ? (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          disabled={loading}
          ariaLabel="好友动态分页"
          className="friend-activity-pagination"
        />
      ) : null}
    </section>
  )
}
