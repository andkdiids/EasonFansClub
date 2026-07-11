'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ModuleFallback } from '@/components/ModuleFallback'
import { getMood } from '@/lib/daily'
import { formatUid } from '@/lib/uid'

type LoadState<T> = { loading: boolean; failed: boolean; data: T }
type Post = {
  id: string
  title: string
  content: string
  likeCount: number
  replyCount: number
  viewCount: number
  isPinned: boolean
  isFeatured: boolean
  board: { name: string; slug: string }
  author: { uid: number; nickname: string; level: number; profile?: { displayName: string | null } | null }
}
type DailyMessage = {
  id: string
  mood: string
  content: string
  user: { uid: number; nickname: string; level: number; profile?: { displayName: string | null } | null }
}
type Activity = { id: string; title: string; description: string | null }
type Track = { id: string; title: string; artist: string }

function initial<T>(data: T): LoadState<T> {
  return { loading: true, failed: false, data }
}

async function loadJson<T>(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(url)
  return (await response.json()) as T
}

export function HomeModules({ emptyText }: { emptyText: string }) {
  const [posts, setPosts] = useState<LoadState<Post[]>>(initial([]))
  const [messages, setMessages] = useState<LoadState<DailyMessage[]>>(initial([]))
  const [activities, setActivities] = useState<LoadState<Activity[]>>(initial([]))
  const [tracks, setTracks] = useState<LoadState<Track[]>>(initial([]))

  useEffect(() => {
    loadJson<{ posts: Post[]; messages: DailyMessage[]; activities: Activity[]; tracks: Track[] }>('/api/home')
      .then((data) => {
        setPosts({ loading: false, failed: false, data: data.posts })
        setMessages({ loading: false, failed: false, data: data.messages })
        setActivities({ loading: false, failed: false, data: data.activities })
        setTracks({ loading: false, failed: false, data: data.tracks })
      })
      .catch(() => {
        setPosts({ loading: false, failed: true, data: [] })
        setMessages({ loading: false, failed: true, data: [] })
        setActivities({ loading: false, failed: true, data: [] })
        setTracks({ loading: false, failed: true, data: [] })
      })
  }, [])

  return (
    <>
      <section className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Forum</p>
            <h2 className="mt-2 text-4xl font-black text-brand-950">E院广场精选</h2>
          </div>
          <Link href="/posts/new" className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">发布帖子</Link>
        </div>
        {posts.failed ? <ModuleFallback /> : null}
        {posts.loading ? <ModuleFallback title="正在加载帖子..." /> : null}
        {!posts.loading && !posts.failed ? (
          <div className="grid gap-3">
            {posts.data.map((post) => {
              const authorName = post.author.profile?.displayName || post.author.nickname
              return (
                <article key={post.id} className="rounded-xl border border-sky-100 bg-white/82 p-5 shadow-sm">
                  <div className="mb-3 flex flex-wrap gap-2">
                    {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">置顶</span> : null}
                    {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">精华</span> : null}
                    <Link href={`/boards/${post.board.slug}`} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{post.board.name}</Link>
                  </div>
                  <Link href={`/posts/${post.id}`} className="text-2xl font-black text-brand-950 hover:text-brand-700">{post.title}</Link>
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
                  <p className="mt-4 text-xs font-bold text-slate-500">
                    <Link href={`/user/${formatUid(post.author.uid)}`} className="text-brand-950">{authorName}</Link>
                    {' '}· 回复 {post.replyCount} · 赞 {post.likeCount} · 浏览 {post.viewCount}
                  </p>
                </article>
              )
            })}
            {!posts.data.length ? <ModuleFallback title={emptyText} /> : null}
          </div>
        ) : null}
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[32px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Daily</p>
          <h2 className="mt-2 text-4xl font-black text-brand-950">E友留言精选</h2>
          <div className="mt-6 space-y-3">
            {messages.failed ? <ModuleFallback /> : null}
            {messages.loading ? <ModuleFallback title="正在加载留言..." /> : null}
            {!messages.loading && !messages.failed && messages.data.map((item) => {
              const mood = getMood(item.mood)
              const name = item.user.profile?.displayName || item.user.nickname
              return (
                <article key={item.id} className="rounded-3xl bg-sky-50/80 p-5">
                  <p className="font-black text-brand-950">{mood?.icon || '🎵'} {name} · Lv.{item.user.level}</p>
                  <p className="mt-2 line-clamp-2 leading-7 text-slate-600">{item.content}</p>
                </article>
              )
            })}
            {!messages.loading && !messages.failed && !messages.data.length ? <ModuleFallback title={emptyText} /> : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Music</p>
            <h2 className="mt-2 text-4xl font-black text-brand-950">EasMusic</h2>
            <div className="mt-6 grid gap-3">
              {tracks.failed ? <ModuleFallback /> : null}
              {tracks.loading ? <ModuleFallback title="正在加载音乐..." /> : null}
              {!tracks.loading && !tracks.failed && tracks.data.map((track) => (
                <Link key={track.id} href="/music" className="rounded-2xl bg-sky-50/80 p-4 font-black text-slate-700">{track.title}</Link>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Activities</p>
            <h2 className="mt-2 text-4xl font-black text-brand-950">活动中心</h2>
            {activities.failed ? <ModuleFallback /> : null}
            {activities.loading ? <p className="mt-4 text-lg font-bold leading-8 text-slate-600">正在加载活动...</p> : null}
            {!activities.loading && !activities.failed ? (
              <p className="mt-4 text-lg font-bold leading-8 text-slate-600">
                {activities.data[0]?.title || '下一场活动，正在准备。'}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </>
  )
}
