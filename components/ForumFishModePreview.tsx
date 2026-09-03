'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { FishModeMediaDisclosure } from '@/components/ForumFishModePostRow'
import { FavoriteButton, LikeButton } from '@/components/PostActions'
import { ReplyForm } from '@/components/ReplyForm'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import { splitContentImages } from '@/lib/content-images'
import type { ForumDiscoveryMedia, ForumDiscoveryPost } from '@/lib/forum-discovery'
import { formatUid } from '@/lib/uid'
import { RichPostContent } from '@/components/posts/RichPostContent'

type FishDetailReply = {
  id: string
  content: string
  createdAt: string
  parentId: string | null
  author: {
    id: string
    nickname: string
    displayName?: string
    avatarUrl?: string | null
    Profile?: { displayName?: string | null; avatarUrl?: string | null } | null
  }
}

type FishDetailResponse = {
  post: {
    id: string
    title: string
    content: string
    richContent: unknown | null
    likeCount: number
    favoriteCount: number
    replyCount: number
    viewCount: number
    createdAt: string
    updatedAt: string
    media: ForumDiscoveryMedia[]
    replies: FishDetailReply[]
  }
}

function formatPreviewDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN')
}

export function ForumFishModePreview({ post, minimal = false, hasPrevious, hasNext, onClose, onNavigate }: Readonly<{
  post: ForumDiscoveryPost
  minimal?: boolean
  hasPrevious: boolean
  hasNext: boolean
  onClose: () => void
  onNavigate: (direction: -1 | 1) => void
}>) {
  const [detail, setDetail] = useState<FishDetailResponse['post'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setIsLoading(true)
    setError('')
    fetch(`/api/posts/${post.id}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as FishDetailResponse | { message?: string } | null
        if (!response.ok || !payload || !('post' in payload)) throw new Error(payload && 'message' in payload ? payload.message || '帖子加载失败' : '帖子加载失败')
        setDetail(payload.post)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '帖子加载失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [post.id])

  const mediaSource = useMemo(() => ({
    id: post.id,
    contentImages: detail ? splitContentImages(detail.content).images : post.contentImages || [],
    media: detail?.media?.length ? [...(post.media || []), ...detail.media] : post.media || [],
    sticker: post.sticker || null,
  }), [detail, post])
  const replies = detail?.replies || []
  const replyCount = detail?.replyCount ?? post.replyCount
  const likeCount = detail?.likeCount ?? post.likeCount
  const favoriteCount = detail?.favoriteCount ?? post.favoriteCount

  function onReplyCreated() {
    setDetail((current) => current ? { ...current, replyCount: current.replyCount + 1 } : current)
    window.dispatchEvent(new CustomEvent('ecfc:post-reply-count', { detail: { postId: post.id, count: replyCount + 1 } }))
  }

  return (
    <div className="fish-mode-preview-layer" data-fish-mode-preview data-minimal={minimal ? 'true' : 'false'}>
      <button type="button" className="fish-mode-preview-backdrop" onClick={onClose} aria-label="关闭帖子预览" />
      <aside className="fish-mode-preview-drawer" role="dialog" aria-modal="true" aria-labelledby={`fish-mode-preview-title-${post.id}`}>
        <header className="fish-mode-preview-header">
          <div className="fish-mode-preview-navigation">
            <button type="button" onClick={() => onNavigate(-1)} disabled={!hasPrevious} aria-label="上一条帖子">↑</button>
            <button type="button" onClick={() => onNavigate(1)} disabled={!hasNext} aria-label="下一条帖子">↓</button>
          </div>
          <span>帖子预览</span>
          <button type="button" className="fish-mode-preview-close" onClick={onClose} aria-label="关闭帖子预览">×</button>
        </header>

        <div className="fish-mode-preview-body">
          <div className="fish-mode-preview-author">
            <Link href={`/user/${formatUid(post.author.uid)}`} className="fish-mode-preview-author-link">
              <span className="fish-mode-preview-avatar">
                <SafeAvatar src={post.author.avatarUrl} name={post.author.displayName} uid={post.author.uid} variant="avatar-sm" className="fish-mode-preview-avatar-image" textClassName="fish-mode-preview-avatar-fallback" />
              </span>
              <span>
                <UserDisplayName name={post.author.displayName} uid={post.author.uid} badge={post.author.equippedBadge} badgeInteraction="static" compact />
                <small>UID {formatUid(post.author.uid)}</small>
              </span>
            </Link>
            <time dateTime={post.createdAt}>{formatPreviewDate(post.createdAt)}</time>
          </div>

          {isLoading ? <div className="fish-mode-preview-loading" aria-live="polite">正在打开帖子…</div> : null}
          {error ? <p className="fish-mode-preview-error" role="alert">{error}</p> : null}

          <article className="fish-mode-preview-post">
            <h2 id={`fish-mode-preview-title-${post.id}`}>{detail?.title || post.title || '帖子'}</h2>
            {detail ? <RichPostContent richContent={detail.richContent} fallbackContent={detail.content} className="fish-mode-preview-rich-content" enableSongPlayback={false} /> : post.contentPreview ? <p>{post.contentPreview}</p> : null}
            <FishModeMediaDisclosure source={mediaSource} minimal={minimal} />
          </article>

          <div className="fish-mode-preview-actions">
            <span>浏览 {detail?.viewCount ?? post.viewCount}</span>
            <LikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={likeCount} refreshOnSuccess={false} className="fish-mode-like-button" />
            <FavoriteButton postId={post.id} initialFavorited={post.favoritedByMe} initialCount={favoriteCount} refreshOnSuccess={false} className="fish-mode-favorite-button" />
            <Link href={`/posts/${post.id}`} className="fish-mode-full-post-link">查看完整帖子</Link>
          </div>

          <section className="fish-mode-preview-replies" aria-label="帖子回复">
            <div className="fish-mode-preview-section-heading">
              <h3>回复 {replyCount}</h3>
              {replies.length > 0 ? <span>显示最近 {replies.length} 条</span> : null}
            </div>
            {replies.length ? (
              <div className="fish-mode-preview-reply-list">
                {replies.map((reply) => {
                  const replyName = reply.author.displayName || reply.author.nickname
                  const replyText = splitContentImages(reply.content).text
                  return (
                    <article key={reply.id} className="fish-mode-preview-reply">
                      <div>
                        <strong>{replyName}</strong>
                        <time dateTime={reply.createdAt}>{formatPreviewDate(reply.createdAt)}</time>
                      </div>
                      {replyText ? <p>{replyText}</p> : null}
                    </article>
                  )
                })}
              </div>
            ) : !isLoading ? <p className="fish-mode-preview-empty-replies">还没有回复</p> : null}
            <ReplyForm postId={post.id} onReplyCreated={onReplyCreated} className="fish-mode-preview-reply-form" />
          </section>
        </div>
      </aside>
    </div>
  )
}
