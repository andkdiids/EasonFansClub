'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AdminPostActions, DeletePostButton, FavoriteButton, LikeButton } from '@/components/PostActions'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type PostItem = {
  id: string
  title: string
  content: string
  likeCount: number
  favoriteCount?: number
  replyCount: number
  viewCount: number
  isPinned: boolean
  isFeatured: boolean
  createdAt: Date | string
  updatedAt?: Date | string
  likedByMe?: boolean
  author: {
    id?: string
    uid?: number
    nickname: string
    avatarUrl?: string | null
    level: number
    profile?: { displayName: string | null; avatarUrl: string | null } | null
  }
  board: { name: string; slug: string }
  favorites?: Array<{ id: string }>
}

export function PostList({
  posts,
  canManage = false,
  currentUserId,
  emptyText = '暂时还没有帖子。',
  onBoardSelect,
  responsiveColumns = false,
}: Readonly<{ posts: PostItem[]; canManage?: boolean; currentUserId?: string; emptyText?: string; onBoardSelect?: (slug: string) => void; responsiveColumns?: boolean }>) {
  const [visiblePosts, setVisiblePosts] = useState(posts)

  useEffect(() => setVisiblePosts(posts), [posts])

  if (visiblePosts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-sky-200 bg-white/65 p-10 text-center text-slate-500">
        {emptyText}
      </div>
    )
  }

  return (
    <div className={`grid items-start gap-3 ${responsiveColumns ? 'md:grid-cols-2' : ''}`}>
      <p aria-live="polite" className={`text-right text-xs font-bold text-slate-500 ${responsiveColumns ? 'md:col-span-2' : ''}`}>
        共 {visiblePosts.length} 篇帖子
      </p>
      {visiblePosts.map((post) => {
        const authorName = post.author.profile?.displayName || post.author.nickname
        const authorAvatar = publicImageUrl(post.author.profile?.avatarUrl || post.author.avatarUrl)
        const isArchivedAuthor = post.author.uid === 0
        const canDelete = canManage || Boolean(currentUserId && post.author.id === currentUserId)
        return (
          <article key={post.id} data-post-id={post.id} className={`relative min-w-0 rounded-2xl border border-sky-100 bg-white/88 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${responsiveColumns && post.isPinned ? 'md:col-span-2' : ''}`}>
            <Link href={`/posts/${post.id}`} aria-label={`查看帖子：${post.title}`} className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" />
            <div className="relative z-10 mb-2 flex w-fit flex-wrap items-center gap-2">
              {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">置顶</span> : null}
              {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">精华</span> : null}
              <Link href={`/forum?board=${encodeURIComponent(post.board.slug)}`} onClick={(event) => { event.stopPropagation(); if (onBoardSelect) { event.preventDefault(); onBoardSelect(post.board.slug) } }} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">
                {post.board.name}
              </Link>
            </div>
            <h2 className="relative z-10 line-clamp-2 pr-2 text-lg font-black text-brand-950 sm:text-xl">{post.title}</h2>
            <p className="relative z-10 mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
            <footer className="relative z-10 mt-3 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
              {post.author.uid !== undefined && !isArchivedAuthor ? (
                <Link href={`/user/${formatUid(post.author.uid)}`} onClick={(event) => event.stopPropagation()} className="flex items-center gap-2 text-brand-950">
                  <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                    {authorAvatar ? <img src={authorAvatar} alt={authorName} className="h-full w-full object-cover" /> : authorName.slice(0, 1)}
                  </span>
                  <span>{authorName} · UID {formatUid(post.author.uid)} · Lv.{post.author.level}</span>
                </Link>
              ) : post.author.uid !== undefined ? (
                <span className="flex items-center gap-2 text-brand-950">
                  <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-slate-900 text-white">
                    {authorName.slice(0, 1)}
                  </span>
                  <span>{authorName}</span>
                </span>
              ) : null}
              <span>{formatDate(post.createdAt instanceof Date ? post.createdAt : new Date(post.createdAt))}</span>
              <span>浏览 {post.viewCount}</span>
              <span>回复 {post.replyCount}</span>
              <LikeButton postId={post.id} initialLiked={Boolean(post.likedByMe)} initialCount={post.likeCount} />
              {post.favoriteCount !== undefined ? <FavoriteButton postId={post.id} initialFavorited={Boolean(post.favorites?.length)} initialCount={post.favoriteCount} /> : null}
            </footer>
            {canManage ? (
              <div className="mt-4 border-t border-sky-100 pt-4">
                <AdminPostActions
                  postId={post.id}
                  isPinned={post.isPinned}
                  isFeatured={post.isFeatured}
                  onDeleted={() => setVisiblePosts((current) => current.filter((item) => item.id !== post.id))}
                />
              </div>
            ) : canDelete ? (
              <div className="mt-4 border-t border-sky-100 pt-4">
                <DeletePostButton
                  postId={post.id}
                  onDeleted={() => setVisiblePosts((current) => current.filter((item) => item.id !== post.id))}
                />
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
