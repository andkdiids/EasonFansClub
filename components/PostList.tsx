'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AdminPostActions, FavoriteButton } from '@/components/PostActions'
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
  createdAt: Date
  author: {
    uid?: number
    nickname: string
    avatarUrl?: string | null
    level: number
    profile?: { displayName: string; avatarUrl: string | null } | null
  }
  board: { name: string; slug: string }
  favorites?: Array<{ id: string }>
}

export function PostList({ posts, canManage = false }: Readonly<{ posts: PostItem[]; canManage?: boolean }>) {
  const [visiblePosts, setVisiblePosts] = useState(posts)

  if (visiblePosts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-sky-200 bg-white/65 p-10 text-center text-slate-500">
        暂时还没有帖子。
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <p aria-live="polite" className="text-right text-xs font-bold text-slate-500">
        共 {visiblePosts.length} 篇帖子
      </p>
      {visiblePosts.map((post) => {
        const authorName = post.author.profile?.displayName || post.author.nickname
        const authorAvatar = publicImageUrl(post.author.profile?.avatarUrl || post.author.avatarUrl)
        return (
          <article key={post.id} data-post-id={post.id} className="rounded-xl border border-sky-100 bg-white/82 p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {post.isPinned ? <span className="rounded bg-red-50 px-2 py-1 text-xs font-black text-red-600">置顶</span> : null}
              {post.isFeatured ? <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">精华</span> : null}
              <Link href={`/boards/${post.board.slug}`} className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">
                {post.board.name}
              </Link>
            </div>
            <Link href={`/posts/${post.id}`} className="text-2xl font-black text-brand-950 hover:text-brand-700">
              {post.title}
            </Link>
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{post.content}</p>
            <footer className="mt-4 flex flex-wrap items-center gap-4 text-xs font-bold text-slate-500">
              {post.author.uid !== undefined ? (
                <Link href={`/user/${formatUid(post.author.uid)}`} className="flex items-center gap-2 text-brand-950">
                  <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                    {authorAvatar ? <img src={authorAvatar} alt={authorName} className="h-full w-full object-cover" /> : authorName.slice(0, 1)}
                  </span>
                  <span>{authorName} · UID {formatUid(post.author.uid)} · Lv.{post.author.level}</span>
                </Link>
              ) : null}
              <span>{formatDate(post.createdAt)}</span>
              <span>浏览 {post.viewCount}</span>
              <span>回复 {post.replyCount}</span>
              <span>赞 {post.likeCount}</span>
              <FavoriteButton postId={post.id} initialFavorited={Boolean(post.favorites?.length)} initialCount={post.favoriteCount || 0} />
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
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
