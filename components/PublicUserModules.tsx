'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ModuleFallback } from '@/components/ModuleFallback'
import { formatUid } from '@/lib/uid'

type ModuleKey = 'posts' | 'replies' | 'achievements' | 'badges' | 'albums' | 'favorites'
type PostItem = {
  id: string
  title: string
  content: string
  replyCount: number
  likeCount: number
  viewCount: number
  board?: { name: string }
}
type ReplyItem = { id: string; content: string; post: { id: string; title: string } }
type AchievementItem = { id: string; achievement: { title: string; icon: string | null; rarity: string } }
type BadgeItem = { id: string; badge: { name: string; description: string | null } }
type AlbumItem = { id: string; note: string | null; album: { title: string; slug: string } }
type FavoriteItem = {
  id: string
  post: {
    id: string
    title: string
    content: string
    author: { uid: number; nickname: string; profile?: { displayName: string | null } | null }
  }
}
type ModuleItem = PostItem | ReplyItem | AchievementItem | BadgeItem | AlbumItem | FavoriteItem
type CacheState = Record<string, { loading: boolean; failed: boolean; items: ModuleItem[] } | undefined>

const tabs: Array<{ key: ModuleKey; label: string }> = [
  { key: 'posts', label: '发帖记录' },
  { key: 'replies', label: '回复记录' },
  { key: 'achievements', label: '我的成就' },
  { key: 'badges', label: '我的勋章' },
  { key: 'albums', label: '我的专辑' },
  { key: 'favorites', label: '我的收藏' },
]

export function PublicUserModules({ uid, isSelf }: { uid: string; isSelf: boolean }) {
  const [active, setActive] = useState<ModuleKey>('posts')
  const [cache, setCache] = useState<CacheState>({})
  const visibleTabs = isSelf ? tabs : tabs.filter((tab) => tab.key !== 'favorites')
  const state = cache[active]

  useEffect(() => {
    if (!isSelf) return
    const requested = new URLSearchParams(window.location.search).get('module')
    if (tabs.some((tab) => tab.key === requested)) setActive(requested as ModuleKey)
  }, [isSelf])

  useEffect(() => {
    if (cache[active]) return
    const key = active
    let cancelled = false
    setCache((current) => ({ ...current, [key]: { loading: true, failed: false, items: [] } }))

    fetch(`/api/users/${uid}/public-modules?module=${key}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(key)
        return response.json()
      })
      .then((data) => {
        if (!cancelled) setCache((current) => ({ ...current, [key]: { loading: false, failed: false, items: data.items || [] } }))
      })
      .catch(() => {
        if (!cancelled) setCache((current) => ({ ...current, [key]: { loading: false, failed: true, items: [] } }))
      })

    return () => {
      cancelled = true
    }
    // cache is intentionally excluded so loading a tab does not retrigger the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, uid])

  return (
    <section id="profile-modules" className="space-y-4">
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-sky-100 bg-white/80 p-2">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-black ${active === tab.key ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-sky-100 bg-white/82 p-5 shadow-sm">
        {state?.failed ? <ModuleFallback /> : null}
        {state?.loading || !state ? <ModuleFallback title="正在加载..." /> : null}
        {state && !state.loading && !state.failed ? <ModuleContent moduleKey={active} items={state.items} /> : null}
      </div>
    </section>
  )
}

function ModuleContent({ moduleKey, items }: { moduleKey: ModuleKey; items: ModuleItem[] }) {
  if (!items.length) return <ModuleFallback title="暂时没有内容。" />

  if (moduleKey === 'posts') {
    const posts = items as PostItem[]
    return (
      <div className="space-y-3">
        {posts.map((post) => (
          <Link key={post.id} href={`/posts/${post.id}`} className="block rounded-2xl bg-sky-50 p-4">
            <p className="text-xs font-black text-brand-700">{post.board?.name}</p>
            <h3 className="mt-2 text-lg font-black text-brand-950">{post.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">回复 {post.replyCount} · 赞 {post.likeCount} · 浏览 {post.viewCount}</p>
          </Link>
        ))}
      </div>
    )
  }

  if (moduleKey === 'replies') {
    const replies = items as ReplyItem[]
    return (
      <div className="space-y-3">
        {replies.map((reply) => (
          <Link key={reply.id} href={`/posts/${reply.post.id}`} className="block rounded-2xl bg-sky-50 p-4">
            <p className="font-black text-brand-950">{reply.post.title}</p>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{reply.content}</p>
          </Link>
        ))}
      </div>
    )
  }

  if (moduleKey === 'achievements') {
    const achievements = items as AchievementItem[]
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {achievements.map((item) => (
          <div key={item.id} className="rounded-2xl bg-sky-50/80 p-4">
            <p className="text-3xl">{item.achievement.icon || '🏆'}</p>
            <h3 className="mt-2 font-black text-brand-950">{item.achievement.title}</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">{item.achievement.rarity}</p>
          </div>
        ))}
      </div>
    )
  }

  if (moduleKey === 'badges') {
    const badges = items as BadgeItem[]
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {badges.map((item) => (
          <div key={item.id} className="rounded-2xl bg-sky-50/80 p-4">
            <p className="font-black text-brand-950">🏅 {item.badge.name}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">{item.badge.description || '暂无介绍'}</p>
          </div>
        ))}
      </div>
    )
  }

  if (moduleKey === 'albums') {
    const albums = items as AlbumItem[]
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {albums.map((item) => (
          <Link key={item.id} href={`/culture/${item.album.slug}`} className="rounded-2xl bg-sky-50/80 p-4">
            <p className="font-black text-brand-950">{item.album.title}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">{item.note || '已加入收藏馆'}</p>
          </Link>
        ))}
      </div>
    )
  }

  const favorites = items as FavoriteItem[]
  return (
    <div className="space-y-3">
      {favorites.map((item) => {
        const author = item.post.author
        const authorName = author.profile?.displayName || author.nickname
        return (
          <Link key={item.id} href={`/posts/${item.post.id}`} className="block rounded-2xl bg-sky-50 p-4">
            <h3 className="text-lg font-black text-brand-950">{item.post.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.post.content}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">作者 {authorName} · UID {formatUid(author.uid)}</p>
          </Link>
        )
      })}
    </div>
  )
}
