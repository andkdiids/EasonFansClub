'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { FishModeCommentComposer, type FishModeReplyPayload } from '@/components/FishModeCommentComposer'
import { FishModeMediaDisclosure } from '@/components/ForumFishModePostRow'
import { DeleteReplyButton, type DeleteCommentResult } from '@/components/DeleteCommentButton'
import { FavoriteButton, LikeButton } from '@/components/PostActions'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import { confirmSessionForAction } from '@/lib/client-auth'
import { splitContentImages } from '@/lib/content-images'
import type { ForumDiscoveryMedia, ForumDiscoveryPost } from '@/lib/forum-discovery'
import { RichPostContent } from '@/components/posts/RichPostContent'
import { formatUid } from '@/lib/uid'

type FishDetailReplyAuthor = {
  id: string
  uid: number
  nickname: string
  displayName?: string
  avatarUrl?: string | null
  profile?: { displayName?: string | null; avatarUrl?: string | null } | null
  Profile?: { displayName?: string | null; avatarUrl?: string | null } | null
}

type FishDetailReply = {
  id: string
  content: string
  createdAt: string
  updatedAt?: string
  parentId: string | null
  likeCount: number
  liked?: boolean
  canDelete?: boolean
  author: FishDetailReplyAuthor
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

type FishNestedReply = {
  reply: FishDetailReply
  replyToName: string
}

function formatPreviewDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN')
}

function normalizeFishReply(value: unknown): FishDetailReply | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<FishDetailReply>
  if (typeof source.id !== 'string' || typeof source.content !== 'string') return null
  const sourceAuthor = source.author && typeof source.author === 'object' ? source.author as Partial<FishDetailReplyAuthor> : null
  if (!sourceAuthor || typeof sourceAuthor.id !== 'string') return null
  const profile = sourceAuthor.profile || sourceAuthor.Profile || null
  const nickname = typeof sourceAuthor.nickname === 'string' && sourceAuthor.nickname.trim() ? sourceAuthor.nickname : 'E院用户'
  return {
    id: source.id,
    content: source.content,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : undefined,
    parentId: typeof source.parentId === 'string' ? source.parentId : null,
    likeCount: Math.max(0, Number(source.likeCount) || 0),
    liked: Boolean(source.liked),
    canDelete: Boolean(source.canDelete),
    author: {
      id: sourceAuthor.id,
      uid: Number(sourceAuthor.uid) || 0,
      nickname,
      displayName: typeof sourceAuthor.displayName === 'string' ? sourceAuthor.displayName : profile?.displayName || undefined,
      avatarUrl: typeof sourceAuthor.avatarUrl === 'string' ? sourceAuthor.avatarUrl : profile?.avatarUrl || null,
      profile,
    },
  }
}

function buildReplyTree(replies: FishDetailReply[]) {
  const ids = new Set(replies.map((reply) => reply.id))
  const tree = new Map<string | null, FishDetailReply[]>()
  replies.forEach((reply) => {
    const parentId = reply.parentId && reply.parentId !== reply.id && ids.has(reply.parentId) ? reply.parentId : null
    tree.set(parentId, [...(tree.get(parentId) || []), reply])
  })
  return tree
}

function getReplyName(reply: FishDetailReply) {
  return reply.author.displayName || reply.author.nickname || 'E院用户'
}

function FishModeReplyLikeButton({ reply }: Readonly<{ reply: FishDetailReply }>) {
  const [liked, setLiked] = useState(Boolean(reply.liked))
  const [count, setCount] = useState(reply.likeCount)
  const [pending, setPending] = useState(false)

  async function toggleLike() {
    if (pending) return
    const confirmed = await confirmSessionForAction('/forum/discovery/reply-like')
    if (!confirmed) return
    setPending(true)
    try {
      const response = await fetch(`/api/replies/${encodeURIComponent(reply.id)}/like`, { method: 'POST' })
      const data = await response.json().catch(() => ({})) as { isLiked?: boolean; likeCount?: number }
      if (!response.ok) return
      setLiked(Boolean(data.isLiked))
      setCount(Math.max(0, Number(data.likeCount) || 0))
    } finally {
      setPending(false)
    }
  }

  return (
    <button type="button" className="fish-mode-preview-reply-action" onClick={() => void toggleLike()} disabled={pending}>
      {liked ? '取消赞' : '♡'} {count}
    </button>
  )
}

export function ForumFishModePreview({ post, minimal = false, focusComments = false, hasPrevious, hasNext, onClose, onNavigate }: Readonly<{
  post: ForumDiscoveryPost
  minimal?: boolean
  focusComments?: boolean
  hasPrevious: boolean
  hasNext: boolean
  onClose: () => void
  onNavigate: (direction: -1 | 1) => void
}>) {
  const [detail, setDetail] = useState<FishDetailResponse['post'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [mainComposerOpen, setMainComposerOpen] = useState(false)
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null)
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({})
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setIsLoading(true)
    setError('')
    setMainComposerOpen(false)
    setActiveReplyId(null)
    setExpandedThreads({})
    setFeedback('')
    fetch(`/api/posts/${post.id}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as FishDetailResponse | { message?: string } | null
        if (!response.ok || !payload || !('post' in payload)) throw new Error(payload && 'message' in payload ? payload.message || '帖子加载失败' : '帖子加载失败')
        const normalizedReplies = Array.isArray(payload.post.replies)
          ? payload.post.replies.map(normalizeFishReply).filter((reply): reply is FishDetailReply => Boolean(reply))
          : []
        setDetail({ ...payload.post, replies: normalizedReplies })
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
  const replies = useMemo(() => detail?.replies || [], [detail])
  const replyCount = detail?.replyCount ?? post.replyCount
  const likeCount = detail?.likeCount ?? post.likeCount
  const favoriteCount = detail?.favoriteCount ?? post.favoriteCount
  const replyTree = useMemo(() => buildReplyTree(replies), [replies])
  const replyMap = useMemo(() => new Map(replies.map((reply) => [reply.id, reply])), [replies])
  const rootReplies = replyTree.get(null) || []

  useEffect(() => {
    if (!feedback) return
    const timer = window.setTimeout(() => setFeedback(''), 2200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    if (!activeReplyId) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`fish-mode-reply-form-${activeReplyId}`)?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeReplyId])

  useEffect(() => {
    if (!focusComments || !detail || isLoading) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`fish-mode-preview-replies-${post.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [detail, focusComments, isLoading, post.id])

  function focusReplies() {
    document.getElementById(`fish-mode-preview-replies-${post.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function openReplyComposer(reply: FishDetailReply) {
    setMainComposerOpen(false)
    setActiveReplyId(reply.id)
  }

  function handleReplyCreated(value: FishModeReplyPayload) {
    const created = normalizeFishReply(value)
    if (!created) return
    const nextCount = replyCount + 1
    setDetail((current) => {
      if (!current || current.replies.some((reply) => reply.id === created.id)) return current
      return { ...current, replies: [...current.replies, created], replyCount: nextCount }
    })
    setMainComposerOpen(false)
    setActiveReplyId(null)
    setFeedback('已评论')
    window.dispatchEvent(new CustomEvent('ecfc:post-reply-count', { detail: { postId: post.id, count: nextCount } }))
  }

  function removeReply(replyId: string, result: DeleteCommentResult) {
    const removedIds = new Set<string>([replyId])
    const collectChildren = (parentId: string) => {
      for (const child of replyTree.get(parentId) || []) {
        if (removedIds.has(child.id)) continue
        removedIds.add(child.id)
        collectChildren(child.id)
      }
    }
    collectChildren(replyId)
    const nextCount = typeof result.replyCount === 'number'
      ? Math.max(0, result.replyCount)
      : Math.max(0, replyCount - removedIds.size)
    setDetail((current) => current ? {
      ...current,
      replies: current.replies.filter((reply) => !removedIds.has(reply.id)),
      replyCount: nextCount,
    } : current)
    setActiveReplyId((current) => current && removedIds.has(current) ? null : current)
    window.dispatchEvent(new CustomEvent('ecfc:post-reply-count', { detail: { postId: post.id, count: nextCount } }))
  }

  function nestedReplies(rootId: string) {
    const result: FishNestedReply[] = []
    const visited = new Set<string>()
    const visit = (parentId: string, parentName: string) => {
      if (visited.has(parentId)) return
      visited.add(parentId)
      for (const child of replyTree.get(parentId) || []) {
        result.push({ reply: child, replyToName: parentName })
        visit(child.id, getReplyName(child))
      }
    }
    const root = replyMap.get(rootId)
    if (root) visit(rootId, getReplyName(root))
    return result
  }

  function renderReplyIdentity(reply: FishDetailReply) {
    const name = getReplyName(reply)
    const profile = reply.author.profile || reply.author.Profile
    return (
      <Link href={`/user/${formatUid(reply.author.uid)}`} className="fish-mode-preview-reply-author">
        <span className="fish-mode-preview-reply-avatar">
          <SafeAvatar src={reply.author.avatarUrl || profile?.avatarUrl} name={name} uid={reply.author.uid} variant="avatar-sm" />
        </span>
        <UserDisplayName name={name} uid={reply.author.uid} compact />
      </Link>
    )
  }

  function renderReplyActions(reply: FishDetailReply) {
    return (
      <div className="fish-mode-preview-reply-actions">
        <FishModeReplyLikeButton reply={reply} />
        <button type="button" className="fish-mode-preview-reply-action" onClick={() => openReplyComposer(reply)}>回复</button>
        {reply.canDelete ? <DeleteReplyButton replyId={reply.id} label="删除" variant="text" onDeleted={(result) => removeReply(reply.id, result)} /> : null}
        <time dateTime={reply.createdAt}>{formatPreviewDate(reply.createdAt)}</time>
      </div>
    )
  }

  function renderNestedReply(item: FishNestedReply) {
    const { reply, replyToName } = item
    const replyText = splitContentImages(reply.content).text
    return (
      <article key={reply.id} id={`fish-mode-reply-${reply.id}`} className="fish-mode-preview-reply fish-mode-preview-nested-reply">
        <div className="fish-mode-preview-reply-header">
          {renderReplyIdentity(reply)}
        </div>
        <p className="fish-mode-preview-reply-content">
          <span className="fish-mode-preview-reply-target">回复 {replyToName}：</span>
          {replyText}
        </p>
        {renderReplyActions(reply)}
        {activeReplyId === reply.id ? (
          <div id={`fish-mode-reply-form-${reply.id}`} className="fish-mode-preview-inline-reply-form">
            <FishModeCommentComposer
              postId={post.id}
              parentId={reply.id}
              replyToName={getReplyName(reply)}
              onCancel={() => setActiveReplyId(null)}
              onSubmitted={handleReplyCreated}
            />
          </div>
        ) : null}
      </article>
    )
  }

  function renderRootReply(reply: FishDetailReply) {
    const replyText = splitContentImages(reply.content).text
    const children = nestedReplies(reply.id)
    const showAll = Boolean(expandedThreads[reply.id])
    const visibleChildren = showAll ? children : children.slice(0, 3)
    return (
      <article key={reply.id} id={`fish-mode-reply-${reply.id}`} className="fish-mode-preview-reply">
        <div className="fish-mode-preview-reply-header">
          {renderReplyIdentity(reply)}
        </div>
        <p className="fish-mode-preview-reply-content">{replyText}</p>
        {renderReplyActions(reply)}
        {activeReplyId === reply.id ? (
          <div id={`fish-mode-reply-form-${reply.id}`} className="fish-mode-preview-inline-reply-form">
            <FishModeCommentComposer
              postId={post.id}
              parentId={reply.id}
              replyToName={getReplyName(reply)}
              onCancel={() => setActiveReplyId(null)}
              onSubmitted={handleReplyCreated}
            />
          </div>
        ) : null}
        {visibleChildren.length ? (
          <div className="fish-mode-preview-reply-thread">
            {visibleChildren.map(renderNestedReply)}
            {children.length > 3 ? (
              <button type="button" className="fish-mode-preview-reply-toggle" onClick={() => setExpandedThreads((current) => ({ ...current, [reply.id]: !showAll }))}>
                {showAll ? '收起回复' : `查看全部 ${children.length} 条回复`}
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    )
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
                <UserDisplayName name={post.author.displayName} uid={post.author.uid} badges={post.author.equippedBadges} badge={post.author.equippedBadge} badgeInteraction="static" compact />
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
            <button type="button" className="fish-mode-preview-action-count" onClick={focusReplies} aria-label="查看评论">评论 {replyCount}</button>
            <LikeButton postId={post.id} initialLiked={post.likedByMe} initialCount={likeCount} refreshOnSuccess={false} className="fish-mode-like-button" />
            <FavoriteButton postId={post.id} initialFavorited={post.favoritedByMe} initialCount={favoriteCount} refreshOnSuccess={false} className="fish-mode-favorite-button" />
            <button type="button" className="fish-mode-preview-action-button" onClick={() => { setActiveReplyId(null); setMainComposerOpen(true) }}>说点什么</button>
            <span className="fish-mode-preview-action-count">浏览 {detail?.viewCount ?? post.viewCount}</span>
          </div>
          <div className="fish-mode-full-post-row"><Link href={`/posts/${post.id}`} className="fish-mode-full-post-link">查看完整帖子</Link></div>
          {mainComposerOpen ? (
            <FishModeCommentComposer
              postId={post.id}
              onCancel={() => setMainComposerOpen(false)}
              onSubmitted={handleReplyCreated}
            />
          ) : null}
          {feedback ? <p className="fish-mode-inline-feedback" role="status">{feedback}</p> : null}

          <section id={`fish-mode-preview-replies-${post.id}`} className="fish-mode-preview-replies" aria-label="帖子回复">
            <div className="fish-mode-preview-section-heading">
              <h3>回复 {replyCount}</h3>
              {replies.length > 0 ? <span>显示最近 {replies.length} 条</span> : null}
            </div>
            {rootReplies.length ? (
              <div className="fish-mode-preview-reply-list">
                {rootReplies.map(renderRootReply)}
              </div>
            ) : !isLoading ? <p className="fish-mode-preview-empty-replies">还没有回复</p> : null}
          </section>
        </div>
      </aside>
    </div>
  )
}
