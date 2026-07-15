'use client'

import { useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { getMood } from '@/lib/daily'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type FriendActivity = {
  id: string
  mood: string | null
  content: string | null
  createdAt: string
  actor: {
    uid: number
    nickname: string
    avatarUrl: string | null
    profile: { displayName: string | null; avatarUrl: string | null } | null
  }
}

export function FriendActivityPanel() {
  const [activities, setActivities] = useState<FriendActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true

    fetch('/api/friends/activity', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('load failed'))))
      .then((data) => {
        if (!active) return
        setActivities(Array.isArray(data.activities) ? data.activities : [])
        setFailed(false)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="rounded-[24px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">好友动态</p>
      <h2 className="mt-1 text-2xl font-black text-brand-950">好友动态</h2>
      <div className="mt-4 space-y-3">
        {loading ? <p className="rounded-2xl bg-sky-50 p-5 text-center text-sm font-black text-slate-500">好友动态加载中...</p> : null}
        {failed ? <p className="rounded-2xl bg-red-50 p-5 text-center text-sm font-black text-red-600">好友动态加载失败。</p> : null}
        {!loading && !failed && !activities.length ? <p className="rounded-2xl bg-sky-50 p-5 text-center text-sm font-black text-slate-500">暂无好友动态</p> : null}
        {activities.map((item) => {
          const mood = getMood(item.mood || '')
          const name = item.actor.profile?.displayName || item.actor.nickname
          const avatar = publicImageUrl(item.actor.profile?.avatarUrl || item.actor.avatarUrl)
          return (
            <article key={item.id} className="rounded-2xl bg-sky-50/75 p-3">
              <div className="flex gap-3">
                <a href={`/user/${formatUid(item.actor.uid)}`} className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white">
                  <SafeAvatar src={avatar} name={name} className="h-full w-full" />
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/user/${formatUid(item.actor.uid)}`} className="font-black text-brand-950">{name}</a>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(item.actor.uid)}</span>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">{mood?.icon || '*'} {mood?.label || '挂号'}</span>
                  </div>
                  {item.content ? <p className="mt-2 line-clamp-2 text-sm font-bold leading-6 text-slate-600">{item.content}</p> : null}
                  <p className="mt-2 text-xs font-bold text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</p>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
