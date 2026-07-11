'use client'

import { useEffect, useMemo, useState } from 'react'
import { ModuleFallback } from '@/components/ModuleFallback'
import { getMood } from '@/lib/daily'

type CheckIn = { id: string; checkDate: string; mood: string | null; streakDay: number }
type Message = { id: string; mood: string; content: string; createdAt: string }
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
  const [checkIns, setCheckIns] = useState<LoadState<CheckIn[]>>(initial([]))
  const [longestStreak, setLongestStreak] = useState(0)
  const [messages, setMessages] = useState<LoadState<Message[]>>(initial([]))
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
    loadJson<{ messages: Message[] }>('/api/profile/messages')
      .then((data) => setMessages({ loading: false, failed: false, data: data.messages }))
      .catch(() => setMessages({ loading: false, failed: true, data: [] }))
  }, [])

  return (
    <aside className="space-y-6">
      <div className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-black text-brand-950">本月挂号日历</h2>
          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">
            最长连续 {longestStreak} 天
          </span>
        </div>
        <div className="mt-5">
          {checkIns.failed ? <ModuleFallback /> : null}
          {checkIns.loading ? <ModuleFallback title="正在加载签到..." /> : null}
          {!checkIns.loading && !checkIns.failed ? (
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate() }, (_, index) => {
                const day = index + 1
                const record = checkIns.data.find((item) => new Date(item.checkDate).getDate() === day)
                const mood = getMood(record?.mood || '')
                return (
                  <div key={day} className={`aspect-square rounded-2xl p-2 text-center text-xs font-black ${record ? 'bg-brand-700 text-white' : 'bg-sky-50 text-slate-400'}`}>
                    <span>{day}</span>
                    <span className="mt-1 block text-lg">{mood?.icon || ''}</span>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
        <h2 className="text-2xl font-black text-brand-950">最近留言</h2>
        <div className="mt-5 space-y-3">
          {messages.failed ? <ModuleFallback /> : null}
          {messages.loading ? <ModuleFallback title="正在加载留言..." /> : null}
          {!messages.loading && !messages.failed && messages.data.length ? messages.data.map((item) => {
            const mood = getMood(item.mood)
            return (
              <article key={item.id} className="rounded-2xl bg-sky-50/75 p-4">
                <p className="font-black text-brand-950">{mood?.icon || '🎵'} {new Date(item.createdAt).toLocaleString('zh-CN')}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{item.content}</p>
              </article>
            )
          }) : null}
          {!messages.loading && !messages.failed && !messages.data.length ? <ModuleFallback title="还没有历史留言。" /> : null}
        </div>
      </div>
    </aside>
  )
}
