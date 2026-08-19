'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DeleteReplyButton, type DeleteCommentResult } from '@/components/DeleteCommentButton'
import { isSessionDefinitivelyInvalid, recordForceLogout } from '@/lib/client-auth'
import { IpRegionLabel } from '@/components/IpRegionLabel'
import { ImageViewer } from '@/components/ImageViewer'
import { LikeAvatars, type LikeAvatarUser } from '@/components/LikeAvatars'
import { MentionText, type ReplyMentionView } from '@/components/MentionText'
import { ReplyForm } from '@/components/ReplyForm'
import { PostReplyBottomSheet } from '@/components/PostReplyBottomSheet'
import { SafeAvatar } from '@/components/SafeAvatar'
import { formatDate } from '@/lib/format'
import { profileImageUrl } from '@/lib/images'
import { toPublicMediaUrl } from '@/lib/media-url'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { formatUid } from '@/lib/uid'
import { splitContentImages } from '@/lib/content-images'
import { canPinPostReply, type PostReplySort } from '@/lib/post-replies'
import { Pagination } from '@/components/ui/Pagination'

type ReplyItem = {
  id: string
  content: string
  parentId: string | null
  likeCount: number
  isPinned: boolean
  liked: boolean
  likers?: LikeAvatarUser[]
  createdAt: Date | string
  ipRegion?: string | null
  stickerId?: string | null
  stickerUrl?: string | null
  mentions: ReplyMentionView[]
  author: {
    id: string
    uid: number
    nickname: string
    level: number
    avatarUrl?: string | null
    profile?: { displayName: string | null; avatarUrl: string | null } | null
  }
}

const unavailableAuthor: ReplyItem['author'] = {
  id: '',
  uid: 0,
  nickname: '已注销用户',
  level: 0,
  avatarUrl: null,
  profile: null,
}

function normalizeReply(value: unknown): ReplyItem | null {
  if (!value || typeof value !== 'object') return null
  const reply = value as Partial<ReplyItem>
  if (typeof reply.id !== 'string' || typeof reply.content !== 'string') return null
  const sourceAuthor = reply.author && typeof reply.author === 'object' ? reply.author : unavailableAuthor
  return {
    id: reply.id,
    content: reply.content,
    parentId: typeof reply.parentId === 'string' ? reply.parentId : null,
    likeCount: Number(reply.likeCount) || 0,
    isPinned: Boolean(reply.isPinned),
    liked: Boolean(reply.liked),
    likers: Array.isArray(reply.likers) ? reply.likers : [],
    createdAt: typeof reply.createdAt === 'string' || reply.createdAt instanceof Date ? reply.createdAt : new Date().toISOString(),
    ipRegion: typeof reply.ipRegion === 'string' ? reply.ipRegion : null,
    stickerId: typeof reply.stickerId === 'string' ? reply.stickerId : null,
    stickerUrl: typeof reply.stickerUrl === 'string' ? toPublicMediaUrl(reply.stickerUrl) : null,
    mentions: Array.isArray(reply.mentions) ? reply.mentions : [],
    author: {
      ...unavailableAuthor,
      ...sourceAuthor,
      nickname: sourceAuthor.nickname?.trim() || '已注销用户',
      level: Number(sourceAuthor.level) || 0,
      profile: sourceAuthor.profile || null,
    },
  }
}

function buildReplyTree(replies: ReplyItem[]) {
  const byParent = new Map<string | null, ReplyItem[]>()
  const ids = new Set(replies.map((reply) => reply.id))
  replies.forEach((reply) => {
    const key = reply.parentId && ids.has(reply.parentId) && reply.parentId !== reply.id ? reply.parentId : null
    byParent.set(key, [...(byParent.get(key) || []), reply])
  })
  return byParent
}

function buildReplyMap(replies: ReplyItem[]) {
  return new Map(replies.map((reply) => [reply.id, reply]))
}

export function PostRepliesSection({
  postId,
  initialReplies,
  initialReplyCount,
  currentUserId,
  canManageReplies,
  postAuthorId,
  focusId,
  sort,
  page,
  totalPages,
  hotReplyIds,
  commentsLoadError,
}: Readonly<{
  postId: string
  initialReplies: ReplyItem[]
  initialReplyCount: number
  currentUserId?: string
  canManageReplies?: boolean
  postAuthorId: string
  focusId?: string
  sort: PostReplySort
  page: number
  totalPages: number
  hotReplyIds?: string[]
  commentsLoadError?: boolean
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [replies, setReplies] = useState(() => initialReplies.map(normalizeReply).filter((reply): reply is ReplyItem => Boolean(reply)))
  const [replyCount, setReplyCount] = useState(() => Math.max(initialReplyCount, 0))
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null)
  const [mobileReplySheetOpen, setMobileReplySheetOpen] = useState(false)
  const [pinningReplyId, setPinningReplyId] = useState<string | null>(null)
  const activeReplyId = replyTo?.id
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const closeMobileReplySheet = useCallback(() => {
    setMobileReplySheetOpen(false)
    setReplyTo(null)
  }, [])
  useEffect(() => {
    setReplies(initialReplies.map(normalizeReply).filter((reply): reply is ReplyItem => Boolean(reply)))
    setReplyCount(Math.max(initialReplyCount, 0))
  }, [initialReplies, initialReplyCount])
  const tree = useMemo(() => buildReplyTree(replies), [replies])
  const replyMap = useMemo(() => buildReplyMap(replies), [replies])
  const rootReplies = tree.get(null) || []

  function buildCommentHref(nextSort: PostReplySort, nextPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (nextSort === 'latest') params.delete('commentSort')
    else params.set('commentSort', nextSort)
    if (nextPage <= 1) params.delete('commentPage')
    else params.set('commentPage', String(nextPage))
    const query = params.toString()
    return `${pathname}${query ? `?${query}` : ''}`
  }

  function changeCommentSort(nextSort: PostReplySort) {
    router.push(buildCommentHref(nextSort, 1), { scroll: false })
  }

  function changeCommentPage(nextPage: number) {
    router.push(buildCommentHref(sort, nextPage), { scroll: false })
  }

  async function toggleLike(replyId: string) {
    const response = await fetch(`/api/replies/${replyId}/like`, { method: 'POST' })
    if (response.status === 401) {
      // 二次确认：仅当权威 Session 接口确认失效才跳登录
      const invalid = await isSessionDefinitivelyInvalid()
      if (!invalid) return
      recordForceLogout('SESSION_INVALID', `/api/replies/${replyId}/like`, 401)
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
      return
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return
    setReplies((current) => current.map((reply) => reply.id === replyId
      ? { ...reply, liked: Boolean(data.isLiked), likeCount: Number(data.likeCount) || 0 }
      : reply))
    if (sort === 'hot') router.refresh()
  }

  async function togglePin(reply: ReplyItem) {
    if (!canPinPostReply({ currentUserId, postAuthorId, parentId: reply.parentId }) || pinningReplyId) return
    const pinned = !reply.isPinned
    setPinningReplyId(reply.id)
    const response = await fetch(`/api/replies/${reply.id}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    })
    if (response.status === 401) {
      // 二次确认：仅当权威 Session 接口确认失效才跳登录
      const invalid = await isSessionDefinitivelyInvalid()
      if (!invalid) {
        setPinningReplyId(null)
        return
      }
      recordForceLogout('SESSION_INVALID', `/api/replies/${reply.id}/pin`, 401)
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
      setPinningReplyId(null)
      return
    }
    if (response.ok) {
      setReplies((current) => {
        const updated = current.map((item) => item.id === reply.id
          ? { ...item, isPinned: pinned }
          : pinned && item.parentId === null ? { ...item, isPinned: false } : item)
        if (!pinned) return updated
        const pinnedReply = updated.find((item) => item.id === reply.id)
        return pinnedReply ? [pinnedReply, ...updated.filter((item) => item.id !== reply.id)] : updated
      })
      router.refresh()
    }
    setPinningReplyId(null)
  }

  function replyLikeButton(reply: ReplyItem) {
    return (
      <button type="button" onClick={() => void toggleLike(reply.id)} className="text-xs font-black text-brand-700">
        {reply.liked ? '取消点赞' : '点赞'} {reply.likeCount}
      </button>
    )
  }

  function openReplyComposer(target: { id: string; name: string }) {
    setReplyTo(target)
    if (window.matchMedia('(max-width: 767px)').matches) setMobileReplySheetOpen(true)
  }

  useEffect(() => {
    if (!focusId) return
    let current = replyMap.get(focusId)
    if (!current) return
    while (current.parentId && replyMap.has(current.parentId)) current = replyMap.get(current.parentId)!
    if (current.id !== focusId) setExpandedReplies((value) => ({ ...value, [current.id]: true }))
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`reply-${focusId}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.classList.add('notification-focus-target')
    })
    const timer = window.setTimeout(() => {
      document.getElementById(`reply-${focusId}`)?.classList.remove('notification-focus-target')
    }, 2600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusId, replies, replyMap])

  useEffect(() => {
    if (!activeReplyId) return
    if (window.matchMedia('(max-width: 767px)').matches) return
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`reply-form-${activeReplyId}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      target?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeReplyId])

  useEffect(() => {
    const onFocusComposer = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: string }>).detail
      if (detail?.postId !== postId || !currentUserId) return
      setReplyTo(null)
      if (window.matchMedia('(max-width: 767px)').matches) {
        setMobileReplySheetOpen(true)
        return
      }
      window.requestAnimationFrame(() => {
        const composer = document.getElementById(`post-primary-composer-${postId}`)
        composer?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        composer?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
      })
    }
    window.addEventListener('ecfc:focus-post-composer', onFocusComposer)
    return () => window.removeEventListener('ecfc:focus-post-composer', onFocusComposer)
  }, [currentUserId, postId])

  useEffect(() => {
    const onOpenReplySheet = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: string }>).detail
      if (detail?.postId !== postId || !currentUserId) return
      setReplyTo(null)
      setMobileReplySheetOpen(true)
    }
    window.addEventListener('ecfc:open-post-reply-sheet', onOpenReplySheet)
    return () => window.removeEventListener('ecfc:open-post-reply-sheet', onOpenReplySheet)
  }, [currentUserId, postId])

  function findRootReplyId(replyId: string) {
    let current = replyMap.get(replyId)
    const visited = new Set<string>()
    while (current?.parentId && replyMap.has(current.parentId) && !visited.has(current.id)) {
      visited.add(current.id)
      current = replyMap.get(current.parentId)
    }
    return current?.id || null
  }

  function addReply(reply: unknown) {
    const created = normalizeReply(reply)
    if (!created) return
    setReplies((current) => current.some((item) => item.id === created.id) ? current : [...current, created])
    const nextReplyCount = replyCount + 1
    setReplyCount(nextReplyCount)
    const rootId = created.parentId ? findRootReplyId(created.parentId) : null
    if (rootId) setExpandedReplies((current) => ({ ...current, [rootId]: true }))
    window.dispatchEvent(new CustomEvent('ecfc:post-reply-count', { detail: { postId, count: nextReplyCount } }))
    if (document.documentElement.dataset.forumDetailDiscover !== 'true') router.refresh()
  }

  function removeReply(replyId: string, result: DeleteCommentResult) {
    const byParent = buildReplyTree(replies)
    const collectIds = (parentId: string): string[] => (byParent.get(parentId) || []).flatMap((reply) => [reply.id, ...collectIds(reply.id)])
    const removeIds = new Set([replyId, ...collectIds(replyId)])
    setReplies((current) => current.filter((reply) => !removeIds.has(reply.id)))
    const nextReplyCount = typeof result.replyCount === 'number'
      ? Math.max(result.replyCount, 0)
      : Math.max(replyCount - removeIds.size, 0)
    setReplyCount(nextReplyCount)
    window.dispatchEvent(new CustomEvent('ecfc:post-reply-count', { detail: { postId, count: nextReplyCount } }))
  }

  function collectThreadReplies(rootId: string) {
    const result: Array<{ reply: ReplyItem; replyToName: string }> = []
    const visited = new Set<string>()
    const visit = (parentId: string) => {
      if (visited.has(parentId)) return
      visited.add(parentId)
      const parent = replyMap.get(parentId)
      const parentName = parent ? parent.author.profile?.displayName || parent.author.nickname : ''
      ;(tree.get(parentId) || []).forEach((child) => {
        result.push({ reply: child, replyToName: parentName })
        visit(child.id)
      })
    }
    visit(rootId)
    return result
  }

  function renderCompactReply(item: { reply: ReplyItem; replyToName: string }) {
    const { reply, replyToName } = item
    const name = reply.author.profile?.displayName || reply.author.nickname
    const avatar = profileImageUrl(reply.author.profile?.avatarUrl || reply.author.avatarUrl)
    const canDelete = currentUserId === reply.author.id || canManageReplies
    const replyBody = splitContentImages(reply.content)

    return (
      <div key={reply.id} id={`reply-${reply.id}`} className="min-w-0 scroll-mt-20 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <Link href={`/user/${formatUid(reply.author.uid)}`} className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] font-black text-white">
            <SafeAvatar src={avatar} name={name} uid={reply.author.uid} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Link href={`/user/${formatUid(reply.author.uid)}`} className="font-black text-brand-950">{name}</Link>
              <span className="font-bold text-slate-400">UID {formatUid(reply.author.uid)}</span>
              <span className="font-bold text-slate-400">Lv.{reply.author.level}</span>
              <span className="font-bold text-slate-400">{formatDate(new Date(reply.createdAt))}</span>
              <IpRegionLabel ipRegion={reply.ipRegion} />
            </div>
            <p className="mt-1 break-words whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {replyToName ? <span className="font-black text-brand-700">回复 @{replyToName}：</span> : null}
              <MentionText text={replyBody.text} mentions={reply.mentions} />
            </p>
            {reply.stickerUrl ? (
              <div className="mt-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicImageVariantUrl(reply.stickerUrl, 'thumb-sm') || reply.stickerUrl} alt="表情" className="max-h-20 max-w-20 object-contain" loading="lazy" />
              </div>
            ) : null}
            {replyBody.images.length ? <div className="mt-2 grid grid-cols-2 gap-2">{replyBody.images.map((url, imageIndex) => <ImageViewer key={url} src={url} alt={`${name} 的回复图片 ${imageIndex + 1}`} imageClassName="h-auto max-h-48 w-full object-contain" />)}</div> : null}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {replyLikeButton(reply)}
              {currentUserId ? (
                <button
                  type="button"
                  onClick={() => openReplyComposer({ id: reply.id, name })}
                  className="text-xs font-black text-brand-700"
                >
                  回复
                </button>
              ) : null}
              {canDelete ? (
                <DeleteReplyButton replyId={reply.id} label="删除" variant="text" onDeleted={(result) => removeReply(reply.id, result)} />
              ) : null}
            </div>
            <LikeAvatars
              likers={reply.likers || []}
              totalCount={reply.likeCount}
              listUrl={`/api/replies/${reply.id}/like`}
              className="mt-1.5"
            />
            {currentUserId && replyTo?.id === reply.id ? (
              <div id={`reply-form-${reply.id}`} className="post-reply-inline-composer mt-3">
                <ReplyForm
                  postId={postId}
                  replyTo={replyTo}
                  onReplyCancel={() => setReplyTo(null)}
                  onReplyCreated={addReply}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  function renderReply(reply: ReplyItem, index: number) {
    const name = reply.author.profile?.displayName || reply.author.nickname
    const avatar = profileImageUrl(reply.author.profile?.avatarUrl || reply.author.avatarUrl)
    const children = collectThreadReplies(reply.id)
    const showAll = Boolean(expandedReplies[reply.id])
    const visibleChildren = showAll ? children : children.slice(0, 3)
    const canDelete = currentUserId === reply.author.id || canManageReplies
    const replyBody = splitContentImages(reply.content)

    return (
      <article key={reply.id} id={`reply-${reply.id}`} className="scroll-mt-20">
        <div className="post-reply-card rounded-xl border p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm font-bold text-slate-500">
            <Link href={`/user/${formatUid(reply.author.uid)}`} className="flex min-w-0 items-center gap-2 text-brand-950">
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                <SafeAvatar src={avatar} name={name} uid={reply.author.uid} />
              </span>
              <span>{name} · UID {formatUid(reply.author.uid)} · Lv.{reply.author.level}</span>
            </Link>
            {reply.isPinned ? <span className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">置顶</span> : null}
            <span>#{index + 1} · {formatDate(new Date(reply.createdAt))}</span>
            <IpRegionLabel ipRegion={reply.ipRegion} />
          </div>
          <p className="whitespace-pre-wrap leading-7 text-slate-700">
            <MentionText text={replyBody.text} mentions={reply.mentions} />
          </p>
          {reply.stickerUrl ? (
            <div className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicImageVariantUrl(reply.stickerUrl, 'thumb-sm') || reply.stickerUrl} alt="表情" className="max-h-20 max-w-20 object-contain" loading="lazy" />
            </div>
          ) : null}
          {replyBody.images.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{replyBody.images.map((url, imageIndex) => <ImageViewer key={url} src={url} alt={`${name} 的回复图片 ${imageIndex + 1}`} imageClassName="h-auto max-h-72 w-full object-contain" />)}</div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {replyLikeButton(reply)}
            {currentUserId ? (
              <button
                type="button"
                onClick={() => openReplyComposer({ id: reply.id, name })}
                className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700"
              >
                回复
              </button>
            ) : null}
            {canPinPostReply({ currentUserId, postAuthorId, parentId: reply.parentId }) ? (
              <button
                type="button"
                disabled={pinningReplyId === reply.id}
                onClick={() => void togglePin(reply)}
                className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700 disabled:opacity-50"
              >
                {reply.isPinned ? '取消置顶' : '置顶'}
              </button>
            ) : null}
            {canDelete ? (
              <DeleteReplyButton replyId={reply.id} onDeleted={(result) => removeReply(reply.id, result)} />
            ) : null}
          </div>
          <LikeAvatars
            likers={reply.likers || []}
            totalCount={reply.likeCount}
            listUrl={`/api/replies/${reply.id}/like`}
            className="mt-2"
          />
        </div>
        {currentUserId && replyTo?.id === reply.id ? (
          <div id={`reply-form-${reply.id}`} className="post-reply-inline-composer mt-3">
            <ReplyForm
              postId={postId}
              replyTo={replyTo}
              onReplyCancel={() => setReplyTo(null)}
              onReplyCreated={addReply}
            />
          </div>
        ) : null}
        {visibleChildren.length ? (
          <div className="post-reply-thread mt-2 ml-3 space-y-1 pl-3 sm:ml-4 sm:pl-4">
            {visibleChildren.map((child) => renderCompactReply(child))}
            {children.length > 3 ? (
              <button
                type="button"
                onClick={() => setExpandedReplies((current) => ({ ...current, [reply.id]: !showAll }))}
                className="py-1 text-xs font-black text-brand-700"
              >
                {showAll ? '收起回复' : `展开剩余 ${children.length - 3} 条回复`}
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <>
    <section id={`post-comments-${postId}`} className="post-replies-section scroll-mt-16 space-y-3">
      {currentUserId && !replyTo ? (
        <div id={`post-primary-composer-${postId}`} data-post-primary-composer={postId}>
          <div className="post-replies-desktop-composer">
            <ReplyForm
              postId={postId}
              onReplyCancel={() => setReplyTo(null)}
              onReplyCreated={addReply}
            />
          </div>
          <div className="post-replies-mobile-composer-trigger">
            <button
              type="button"
              onClick={() => setMobileReplySheetOpen(true)}
              aria-label={'\u6253\u5f00\u56de\u590d\u7f16\u8f91\u5668'}
            >
              {'\u5199\u4e0b\u4f60\u7684\u56de\u590d\uff0c\u8f93\u5165 @ \u63d0\u53ca\u597d\u53cb\u2026'}
            </button>
          </div>
        </div>
      ) : !currentUserId ? (
        <div className="post-replies-login rounded-xl p-5 text-center font-bold text-slate-600">请先登录后再回复。</div>
      ) : null}

      <h2 className="text-2xl font-black text-brand-950">回复 {replyCount}</h2>
      {commentsLoadError ? <p role="alert" className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">评论加载失败，请刷新评论区重试。帖子正文仍可正常浏览。</p> : null}
      <div className="flex items-center justify-end">
        <div role="tablist" aria-label="评论排序" className="post-replies-sort-tabs inline-flex rounded-full bg-slate-100 p-1">
          {([['latest', '最新'], ['hot', '最热']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={sort === value}
              data-selected={sort === value ? 'true' : 'false'}
              onClick={() => changeCommentSort(value)}
              className={`post-replies-sort-tab rounded-full px-3 py-1 text-xs font-black transition ${sort === value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-brand-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {hotReplyIds?.length ? (
        <div className="post-replies-hot-list p-4">
          <h3 className="font-black text-brand-950">热门评论</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {hotReplyIds.map((id, index) => {
              const reply = replyMap.get(id)
              if (!reply) return null
              const name = reply.author.profile?.displayName || reply.author.nickname
              return <a key={id} href={`#reply-${id}`} className="post-replies-hot-link px-3 py-2 text-xs font-black text-brand-700">热门 #{index + 1} · {name} · {reply.likeCount} 赞</a>
            })}
          </div>
        </div>
      ) : null}
      {focusId && !replyMap.has(focusId) ? <p className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">该内容已被删除或无法查看</p> : null}
      {rootReplies.length === 0 ? (
        <div className="post-replies-empty rounded-xl border-dashed p-8 text-center text-slate-500">还没有回复。</div>
      ) : (
        <div className="space-y-3">
          {rootReplies.map((reply, index) => renderReply(reply, index))}
        </div>
      )}
      {totalPages > 1 ? (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={changeCommentPage}
          ariaLabel="评论分页"
          className="post-replies-pagination"
        />
      ) : null}

    </section>
    {currentUserId ? (
      <PostReplyBottomSheet
        open={mobileReplySheetOpen}
        postId={postId}
        replyTo={replyTo}
        onClose={closeMobileReplySheet}
        onReplyCreated={addReply}
      />
    ) : null}
    </>
  )
}
