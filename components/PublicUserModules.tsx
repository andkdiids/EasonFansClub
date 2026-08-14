'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ModuleFallback } from '@/components/ModuleFallback'
import { Pagination } from '@/components/ui/Pagination'
import { formatUid } from '@/lib/uid'
import { PROFILE_RECORD_PAGE_SIZE, type ProfileRecentMessage, type ProfileRecordPagination } from '@/lib/profile-page'
import { scrollToSectionTop } from '@/lib/pagination'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { IpRegionLabel } from '@/components/IpRegionLabel'

type ModuleKey = 'posts' | 'replies' | 'recent-messages' | 'achievements' | 'badges' | 'albums' | 'favorites'
type PostItem = {
  id: string
  title: string
  content: string
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'VIOLATION'
  rejectionReason: string | null
  ipRegion: string | null
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
type ModuleItem = PostItem | ReplyItem | ProfileRecentMessage | AchievementItem | BadgeItem | AlbumItem | FavoriteItem
type PaginatedModuleKey = 'posts' | 'recent-messages'
type ModuleState = { loading: boolean; failed: boolean; items: ModuleItem[]; pagination?: ProfileRecordPagination }
type CacheState = Record<string, ModuleState | undefined>

function isPaginatedModule(moduleKey: ModuleKey): moduleKey is PaginatedModuleKey {
  return moduleKey === 'posts' || moduleKey === 'recent-messages'
}

function moduleCacheKey(moduleKey: ModuleKey, page: number) {
  return isPaginatedModule(moduleKey) ? `${moduleKey}:${page}` : moduleKey
}

const tabs: Array<{ key: ModuleKey; selfLabel: string; otherLabel: string }> = [
  { key: 'posts', selfLabel: '发帖记录', otherLabel: '发帖记录' },
  { key: 'replies', selfLabel: '回复记录', otherLabel: '回复记录' },
  { key: 'recent-messages', selfLabel: '最近留言', otherLabel: '最近留言' },
  { key: 'achievements', selfLabel: '我的成就', otherLabel: 'TA的成就' },
  { key: 'badges', selfLabel: '我的勋章', otherLabel: 'TA的勋章' },
  { key: 'albums', selfLabel: '我的专辑', otherLabel: 'TA的专辑' },
  { key: 'favorites', selfLabel: '我的收藏', otherLabel: 'TA的收藏' },
]

function moduleLabel(moduleKey: ModuleKey, isSelf: boolean) {
  const tab = tabs.find((item) => item.key === moduleKey)
  return isSelf ? tab?.selfLabel || '内容' : tab?.otherLabel || '内容'
}

export function PublicUserModules({ uid, isSelf, recentMessages = [], recentMessagesPagination }: { uid: string; isSelf: boolean; recentMessages?: ProfileRecentMessage[]; recentMessagesPagination?: ProfileRecordPagination }) {
  const [active, setActive] = useState<ModuleKey>('posts')
  const [modulePages, setModulePages] = useState<Record<PaginatedModuleKey, number>>({ posts: 1, 'recent-messages': recentMessagesPagination?.page || 1 })
  const [expandedRecentMessages, setExpandedRecentMessages] = useState<Record<string, boolean>>({})
  const modulesSectionRef = useRef<HTMLElement>(null)
  const initialRecentPage = recentMessagesPagination?.page || 1
  const [cache, setCache] = useState<CacheState>(() => ({
    [moduleCacheKey('recent-messages', initialRecentPage)]: { loading: false, failed: false, items: recentMessages, pagination: recentMessagesPagination },
  }))
  const activePage = isPaginatedModule(active) ? modulePages[active] : 1
  const state = cache[moduleCacheKey(active, activePage)]

  useEffect(() => {
    if (!isSelf) return
    const requested = new URLSearchParams(window.location.search).get('module')
    if (tabs.some((tab) => tab.key === requested)) setActive(requested as ModuleKey)
  }, [isSelf])

  const loadModule = useCallback(async (moduleKey: ModuleKey, requestedPage = 1, scrollAfterLoad = false) => {
    const requestedCacheKey = moduleCacheKey(moduleKey, requestedPage)
    setCache((current) => ({
      ...current,
      [requestedCacheKey]: {
        loading: true,
        failed: false,
        items: current[requestedCacheKey]?.items || [],
        pagination: current[requestedCacheKey]?.pagination,
      },
    }))

    try {
      const params = new URLSearchParams({ module: moduleKey })
      if (isPaginatedModule(moduleKey)) {
        params.set('page', String(Math.max(1, Math.trunc(requestedPage) || 1)))
        params.set('pageSize', String(PROFILE_RECORD_PAGE_SIZE))
      }
      const response = await fetch(`/api/users/${uid}/public-modules?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(moduleKey)
      const data = await response.json() as { items?: ModuleItem[]; pagination?: ProfileRecordPagination }
      const items = Array.isArray(data.items) ? data.items : []
      const pagination = data.pagination
      const resolvedPage = pagination?.page || requestedPage
      const resolvedCacheKey = moduleCacheKey(moduleKey, resolvedPage)
      setModulePages((current) => isPaginatedModule(moduleKey) ? { ...current, [moduleKey]: resolvedPage } : current)
      setCache((current) => ({
        ...current,
        [requestedCacheKey]: { loading: false, failed: false, items, pagination },
        [resolvedCacheKey]: { loading: false, failed: false, items, pagination },
      }))
      if (scrollAfterLoad) {
        window.requestAnimationFrame(() => scrollToSectionTop(modulesSectionRef.current))
      }
    } catch {
      setCache((current) => ({ ...current, [requestedCacheKey]: { loading: false, failed: true, items: [] } }))
    }
  }, [uid])

  useEffect(() => {
    if (state) return
    void loadModule(active, activePage)
  }, [active, activePage, loadModule, state])

  function handlePageChange(nextPage: number) {
    if (!isPaginatedModule(active) || !state?.pagination) return
    const safePage = Math.min(Math.max(1, Math.trunc(nextPage) || 1), state.pagination.totalPages)
    if (safePage === activePage) return
    setModulePages((current) => ({ ...current, [active]: safePage }))
    void loadModule(active, safePage, true)
  }

  return (
<section ref={modulesSectionRef} id="profile-modules" className="h-full min-w-0 scroll-mt-24">
<div className="flex flex-wrap gap-2 border border-[var(--border)] border-b-0 bg-[var(--surface)] p-2">
          {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`max-w-full rounded-xl px-3 py-2 text-xs font-black whitespace-nowrap sm:px-4 sm:text-sm ${active === tab.key ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}
          >
            {isSelf ? tab.selfLabel : tab.otherLabel}
          </button>
        ))}
      </div>

<div className="min-w-0 border-x border-b border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
      {state?.failed ? <ModuleFallback /> : null}
        {state?.loading || !state ? <ModuleFallback title="正在加载..." /> : null}
        {state && !state.loading && !state.failed ? (
          <ModuleContent
            moduleKey={active}
            items={state.items}
            isSelf={isSelf}
            pagination={state.pagination}
            currentPage={activePage}
            onPageChange={handlePageChange}
            expandedRecentMessages={expandedRecentMessages}
            onToggleRecentMessage={(messageId) => setExpandedRecentMessages((current) => ({ ...current, [messageId]: !current[messageId] }))}
          />
        ) : null}
      </div>
    </section>
  )
}

function ModuleContent({
  moduleKey,
  items,
  isSelf,
  pagination,
  currentPage,
  onPageChange,
  expandedRecentMessages,
  onToggleRecentMessage,
}: {
  moduleKey: ModuleKey
  items: ModuleItem[]
  isSelf: boolean
  pagination?: ProfileRecordPagination
  currentPage: number
  onPageChange: (page: number) => void
  expandedRecentMessages: Record<string, boolean>
  onToggleRecentMessage: (messageId: string) => void
}) {
  if (!items.length) return <ModuleFallback title={`${moduleLabel(moduleKey, isSelf)}暂时没有内容。`} />

  const pageNavigation = isPaginatedModule(moduleKey) && pagination && pagination.totalPages > 1 ? (
    <Pagination
      currentPage={currentPage}
      totalPages={pagination.totalPages}
      onPageChange={onPageChange}
      ariaLabel={moduleKey === 'posts' ? 'posts pagination' : 'check-in messages pagination'}
    />
  ) : null

  if (moduleKey === 'posts') {
    const posts = items as PostItem[]
    return (
      <div className="space-y-3">
        {posts.map((post) => (
<Link
  key={post.id}
  href={`/posts/${post.id}`}
  className="block border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
>            <p className="text-xs font-black text-brand-700">{post.board?.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-black text-brand-950">{post.title}</h3>
              {isSelf && post.moderationStatus === 'PENDING' ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">审核中</span> : null}
              {isSelf && post.moderationStatus === 'REJECTED' ? <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-black text-red-700">审核未通过</span> : null}
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
            {isSelf && post.moderationStatus === 'REJECTED' && post.rejectionReason ? <p className="mt-2 text-xs font-bold text-red-700">{post.rejectionReason}</p> : null}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500">
              <IpRegionLabel ipRegion={post.ipRegion} />
              <span>回复 {post.replyCount} · 赞 {post.likeCount} · 浏览 {post.viewCount}</span>
            </p>
          </Link>
        ))}
        {pageNavigation}
      </div>
    )
  }

  if (moduleKey === 'replies') {
    const replies = items as ReplyItem[]
    return (
      <div className="space-y-3">
        {replies.map((reply) => (
<Link
  key={reply.id}
  href={`/posts/${reply.post.id}`}
  className="block border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
>            <p className="font-black text-brand-950">{reply.post.title}</p>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{reply.content}</p>
          </Link>
        ))}
      </div>
    )
  }

  if (moduleKey === 'recent-messages') {
    const messages = items as ProfileRecentMessage[]
    return (
      <div className="space-y-3">
        {messages.map((message) => (
          <article key={message.id} className="min-w-0 border border-[var(--border)] bg-[var(--surface-subtle)] p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black text-brand-950">
              {message.mood ? <span className="rounded-full bg-sky-50 px-2 py-1 text-brand-700">{message.mood}</span> : null}
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN')}</time>
              <IpRegionLabel ipRegion={message.ipRegion} />
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{message.content}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
              <span>赞 {message.likeCount}</span>
              {message.commentCount > 0 || message.comments.length > 0 ? (
                <button type="button" onClick={() => onToggleRecentMessage(message.id)} className="text-brand-700">
                  回复 {message.commentCount}
                  <span className="ml-1">{expandedRecentMessages[message.id] ? '收起' : '查看'}</span>
                </button>
              ) : <span>回复 0</span>}
            </div>
            {expandedRecentMessages[message.id] ? (
              <ul className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                {message.comments.length ? message.comments.map((comment) => (
                  <li key={comment.id} className="flex gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-xs font-black text-white">
                      {comment.authorAvatarUrl ? <img src={publicImageVariantUrl(comment.authorAvatarUrl, 'avatar-md') || comment.authorAvatarUrl} alt={comment.authorName} className="h-full w-full object-cover" loading="lazy" /> : (comment.authorName || 'E').slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black text-brand-950">{comment.authorName}</span>
                        <time className="text-[11px] font-bold text-slate-400">{new Date(comment.createdAt).toLocaleString('zh-CN')}</time>
                        <IpRegionLabel ipRegion={comment.ipRegion} />
                      </div>
                      <p className="mt-0.5 break-words text-sm font-bold leading-5 text-slate-600">{comment.content}</p>
                    </div>
                  </li>
                )) : (
                  <li className="text-xs font-bold text-slate-400">暂无可见回复</li>
                )}
              </ul>
            ) : null}
          </article>
        ))}
        {pageNavigation}
      </div>
    )
  }

  if (moduleKey === 'achievements') {
    const achievements = items as AchievementItem[]
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {achievements.map((item) => (
          <div key={item.id} className="border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
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
<Link
  key={item.id}
  href={`/posts/${item.post.id}`}
  className="block border border-[var(--border)] bg-[var(--surface-subtle)] p-3"
>            <h3 className="text-lg font-black text-brand-950">{item.post.title}</h3>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.post.content}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">作者 {authorName} · UID {formatUid(author.uid)}</p>
          </Link>
        )
      })}
    </div>
  )
}
