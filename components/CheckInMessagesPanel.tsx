'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DailyMessageActions } from '@/components/DailyMessageActions'
import { LikeAvatars } from '@/components/LikeAvatars'
import { useCheckInLike } from '@/components/checkin-like-context'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
import type { CheckInDisplayMessageItem, CheckInMessageSort } from '@/lib/checkin-messages'
import { formatBeijingDateTime } from '@/lib/beijing-time'
import { getMood } from '@/lib/daily'
import { profileImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type DailyComment = CheckInDisplayMessageItem['comments'][number]
const messagesPerPage = 5

function beijingDateTime(value: string) {
  return formatBeijingDateTime(value)
}

function updateUrl(date: string, sort: CheckInMessageSort) {
  const url = new URL(window.location.href)
  url.searchParams.set('date', date)
  url.searchParams.set('sort', sort)
  window.history.pushState(null, '', `${url.pathname}?${url.searchParams.toString()}`)
}

function buildCommentTree(comments: DailyComment[]) {
  const byParent = new Map<string | null, DailyComment[]>()
  comments.forEach((comment) => {
    const key = comment.parentId || null
    byParent.set(key, [...(byParent.get(key) || []), comment])
  })
  return byParent
}

function buildCommentMap(comments: DailyComment[]) {
  return new Map(comments.map((comment) => [comment.id, comment]))
}

function getCommentAuthorName(author: DailyComment['author']) {
  return 'uid' in author ? author.profile?.displayName || author.nickname : author.name
}

export function CheckInMessagesPanel({
  title,
  density = 'normal',
  anonymous = false,
  scope = 'public',
  emptyText,
  initialMessages,
  initialDate,
  maxDate,
  initialSort,
  previewMode = false,
  focusMessageId,
  focusCommentId,
  canManageMessages = false,
}: Readonly<{
  title?: string
  density?: PageLayoutModuleDensity
  anonymous?: boolean
  scope?: 'public' | 'friends'
  emptyText?: string
  initialMessages: CheckInDisplayMessageItem[]
  initialDate: string
  maxDate: string
  initialSort: CheckInMessageSort
  previewMode?: boolean
  focusMessageId?: string
  focusCommentId?: string
  /** 服务端根据当前登录用户角色计算的管理员标记：是否显示留言删除入口（接口侧仍独立鉴权）。 */
  canManageMessages?: boolean
}>) {
  const [date, setDate] = useState(initialDate)
  const [sort, setSort] = useState<CheckInMessageSort>(initialSort)
  const [messages, setMessages] = useState(initialMessages)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [replyTargets, setReplyTargets] = useState<Record<string, { id: string; name: string } | null>>({})
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const [focusError, setFocusError] = useState('')
  // 管理员删除留言：第一次点击只打开确认框，确认后才调用管理接口。
  const [deleteTarget, setDeleteTarget] = useState<CheckInDisplayMessageItem | null>(null)
  const [isDeletingMessage, setIsDeletingMessage] = useState(false)
  // 跨面板共享的点赞覆盖层（E友留言 / 好友留言 同步、翻页不丢失）。
  const likeCtx = useCheckInLike()
  // likeCtx 的 value 在每次点赞后都会更换身份（覆盖层变化），同步 effect / loadMessages
  // 只能通过 ref 访问它，否则点赞会反复触发「重置分页 + 用服务端旧值覆盖点赞状态」。
  const likeCtxRef = useRef(likeCtx)
  useEffect(() => {
    likeCtxRef.current = likeCtx
  })
  const isCompact = density !== 'normal'
  const isMinimal = density === 'minimal'
  const previewPageSize = previewMode ? (isMinimal ? 1 : isCompact ? 2 : messagesPerPage) : messagesPerPage
  const totalPages = Math.max(1, Math.ceil(messages.length / previewPageSize))
  const visibleMessages = useMemo(() => {
    const safePage = Math.min(Math.max(page, 1), totalPages)
    const start = (safePage - 1) * previewPageSize
    return messages.slice(start, start + previewPageSize)
  }, [messages, page, previewPageSize, totalPages])
  const pageNumbers = useMemo(() => {
    const maxVisible = 5
    const start = Math.max(1, Math.min(page - 2, totalPages - maxVisible + 1))
    const end = Math.min(totalPages, start + maxVisible - 1)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [page, totalPages])

  const loadMessages = useCallback(async (nextDate = date, nextSort = sort) => {
    if (isLoading) return

    setError('')
    setIsLoading(true)
    const params = new URLSearchParams({ date: nextDate, sort: nextSort, scope })

    try {
      const response = await fetch(`/api/checkin/messages?${params.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (response.status === 401) {
        window.location.href = '/login'
        return
      }

      if (!response.ok) {
        throw new Error(data.message || '留言列表暂时无法加载，请稍后重试')
      }

      setDate(data.date || nextDate)
      setSort(data.sort === 'hot' ? 'hot' : 'latest')
      const incoming = Array.isArray(data.messages) ? data.messages : []
      setMessages(incoming)
      // 服务端重载后，用服务端最新 likeCount / liked 刷新共享覆盖层，
      // 确保服务端数据成为权威源，避免旧缓存覆盖新数据（如他人点赞）。
      likeCtxRef.current.reconcileLikes(incoming.map((item: CheckInDisplayMessageItem) => ({
        id: item.id,
        likeCount: item.likeCount,
        liked: 'liked' in item ? item.liked : (Array.isArray((item as { likes?: unknown[] }).likes) ? ((item as { likes: unknown[] }).likes.length > 0) : false),
      })))
      setPage(1)
      updateUrl(data.date || nextDate, data.sort === 'hot' ? 'hot' : 'latest')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '留言列表暂时无法加载，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }, [date, isLoading, scope, sort])

  useEffect(() => {
    setDate(initialDate)
    setSort(initialSort)
    setMessages(initialMessages)
    // 用服务端初始数据刷新覆盖层（首次挂载时覆盖层为空，属 no-op；父组件重渲染传入新初始数据时保持服务端权威）。
    // 注意：不依赖 likeCtx——点赞会改变覆盖层导致 likeCtx 更换身份，若列入依赖会在每次点赞后
    // 重跑本 effect，用过期的 initialMessages 覆盖刚写入的点赞状态并把分页重置回第一页。
    likeCtxRef.current.reconcileLikes(initialMessages.map((item) => ({
      id: item.id,
      likeCount: item.likeCount,
      liked: 'liked' in item ? item.liked : (Array.isArray((item as { likes?: unknown[] }).likes) ? ((item as { likes: unknown[] }).likes.length > 0) : false),
    })))
    setPage(1)
  }, [initialDate, initialMessages, initialSort])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    if (previewMode || (!focusMessageId && !focusCommentId)) return
    const messageIndex = messages.findIndex((item) =>
      item.id === focusMessageId || item.comments.some((comment) => comment.id === focusCommentId),
    )
    if (messageIndex < 0) {
      setFocusError('该内容已被删除或无法查看')
      return
    }
    setFocusError('')
    setPage(Math.floor(messageIndex / previewPageSize) + 1)
    const message = messages[messageIndex]
    if (focusCommentId) {
      const commentMap = buildCommentMap(message.comments)
      let current = commentMap.get(focusCommentId)
      if (current) {
        while (current.parentId && commentMap.has(current.parentId)) current = commentMap.get(current.parentId)!
        setExpandedReplies((value) => ({ ...value, [current!.id]: true }))
      }
    }
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = document.getElementById(focusCommentId ? `comment-${focusCommentId}` : `message-${message.id}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.classList.add('notification-focus-target')
    }))
    const timer = window.setTimeout(() => {
      document.getElementById(focusCommentId ? `comment-${focusCommentId}` : `message-${message.id}`)?.classList.remove('notification-focus-target')
    }, 2600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusCommentId, focusMessageId, messages, previewMode, previewPageSize])

  useEffect(() => {
    if (previewMode) return
    function handleCheckInCompleted(event: Event) {
      const detail = (event as CustomEvent<{ date?: string }>).detail
      const nextDate = detail?.date || maxDate
      loadMessages(nextDate, sort)
    }
    function handleDayChanged(event: Event) {
      const detail = (event as CustomEvent<{ date?: string }>).detail
      const nextDate = detail?.date || maxDate
      setDate(nextDate)
      loadMessages(nextDate, sort)
    }

    window.addEventListener('checkin:completed', handleCheckInCompleted)
    window.addEventListener('checkin:dayChanged', handleDayChanged)
    return () => {
      window.removeEventListener('checkin:completed', handleCheckInCompleted)
      window.removeEventListener('checkin:dayChanged', handleDayChanged)
    }
  }, [loadMessages, maxDate, previewMode, sort])

  // 管理员删除留言：复用后台既有软删除接口（服务端校验 daily_message_manage 权限），
  // 成功后只从当前列表局部移除目标留言，不重新加载列表、不改动分页/筛选/滚动位置。
  // 若删除后当前页恰好为空且页码大于 1，由下方 page > totalPages 的夹取 effect 退回上一有效页。
  async function confirmDeleteMessage() {
    if (!deleteTarget || isDeletingMessage) return
    setIsDeletingMessage(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/daily-messages/${deleteTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDeleted: true, reason: '挂号页管理员删除留言' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data.message === 'string' ? data.message : '删除失败，请稍后重试')
      }
      setMessages((current) => current.filter((message) => message.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请稍后重试')
      setDeleteTarget(null)
    } finally {
      setIsDeletingMessage(false)
    }
  }

  return (
    <div className={`checkin-messages-panel ${isMinimal ? 'p-2' : 'p-3 sm:p-4'} flex h-full flex-col rounded-[24px] border shadow-sm ${previewMode ? 'checkin-messages-preview pointer-events-none select-none' : 'min-h-0 overflow-visible'}`}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          {!isMinimal ? <p className="text-xs font-black uppercase text-brand-700">{anonymous ? 'Public Check-ins' : 'Friend Check-ins'}</p> : null}
          <h2 className={isMinimal ? 'text-base font-black leading-tight text-brand-950' : 'mt-1 text-2xl font-black leading-tight text-brand-950'}>{title || 'E友留言'}</h2>
        </div>
        {!isMinimal ? <form
          className="flex flex-wrap gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            loadMessages()
          }}
        >
          <input
            name="date"
            type="date"
            value={date}
            max={maxDate}
            onChange={(event) => setDate(event.target.value)}
            disabled={previewMode}
            className="rounded-full border border-sky-100 px-3 py-1.5 text-xs font-bold outline-none sm:text-sm"
          />
          <select
            name="sort"
            value={sort}
            onChange={(event) => {
              const nextSort = event.target.value === 'hot' ? 'hot' : 'latest'
              setSort(nextSort)
              loadMessages(date, nextSort)
            }}
            disabled={previewMode}
            className="rounded-full border border-sky-100 px-3 py-1.5 text-xs font-bold outline-none sm:text-sm"
          >
            <option value="latest">最新</option>
            <option value="hot">热度</option>
          </select>
          <button
            type="submit"
            disabled={previewMode || isLoading}
            className="rounded-full bg-brand-700 px-3 py-1.5 text-xs font-black text-white disabled:opacity-60 sm:text-sm"
          >
            {isLoading ? '加载中' : '查看'}
          </button>
        </form> : null}
      </div>

      {error ? <p className="mt-3 shrink-0 rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null}
      {focusError ? <p className="mt-3 shrink-0 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-800">{focusError}</p> : null}

      <div className={`${isMinimal ? 'mt-1 space-y-1.5' : 'mt-3 space-y-3'} flex-1 ${previewMode ? '' : 'min-h-0 overflow-visible'}`}>
        {messages.length ? visibleMessages.map((item) => {
          const mood = getMood(item.mood)
          const fullIdentity = 'author' in item && 'uid' in item.author ? item.author : null
          const name = fullIdentity?.profile?.displayName || fullIdentity?.nickname || ('author' in item && 'name' in item.author ? item.author.name : '')
          const avatar = profileImageUrl(fullIdentity?.profile?.avatarUrl || fullIdentity?.avatarUrl)
          const commentTree = buildCommentTree(item.comments)
          const commentMap = buildCommentMap(item.comments)
          const rootComments = commentTree.get(null) || []
          const replyTarget = replyTargets[item.id] || null
          // 点赞展示状态：优先用共享覆盖层（双面板同步 / 翻页保留），否则用服务端初始值。
          const likeOverride = likeCtx.getLike(item.id)
          const effectiveLiked = likeOverride ? likeOverride.liked : ('liked' in item ? item.liked : item.likes.length > 0)
          const effectiveLikeCount = likeOverride ? likeOverride.likeCount : item.likeCount
          const collectThreadComments = (rootId: string) => {
            const result: Array<{ comment: DailyComment; replyToName: string }> = []
            const visit = (parentId: string) => {
              const parent = commentMap.get(parentId)
              const parentName = parent ? getCommentAuthorName(parent.author) : ''
              ;(commentTree.get(parentId) || []).forEach((child) => {
                result.push({ comment: child, replyToName: parentName })
                visit(child.id)
              })
            }
            visit(rootId)
            return result
          }
          return (
            <article key={item.id} id={`message-${item.id}`} className={`checkin-message-card ${isMinimal ? 'rounded-xl p-1.5' : 'rounded-2xl p-3'} border shadow-sm`}>
              <div className={isMinimal ? 'flex gap-2' : 'flex gap-3'}>
                {anonymous ? (
                  <div className={`${isMinimal ? 'h-7 w-7 rounded-xl text-base' : 'h-10 w-10 rounded-2xl text-xl'} grid shrink-0 place-items-center overflow-hidden bg-sky-50`}>
                    {mood?.icon || 'E'}
                  </div>
                ) : fullIdentity ? (
                  <a href={`/user/${formatUid(fullIdentity.uid)}`} className={`${isMinimal ? 'h-7 w-7 rounded-xl text-base' : 'h-10 w-10 rounded-2xl text-xl'} grid shrink-0 place-items-center overflow-hidden bg-sky-50`}>
                    {avatar ? <SafeAvatar src={avatar} name={name} uid={fullIdentity?.uid} className="h-full w-full" /> : mood?.icon || '🎵'}
                  </a>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className={isMinimal ? 'flex min-w-0 items-center gap-1.5' : 'flex flex-wrap items-center gap-2'}>
                    {anonymous ? (
                      <span className={isMinimal ? 'truncate text-xs font-black text-brand-950' : 'font-black text-brand-950'}>E院病友</span>
                    ) : (
                      fullIdentity ? <a href={`/user/${formatUid(fullIdentity.uid)}`} className={isMinimal ? 'truncate text-xs font-black text-brand-950' : 'font-black text-brand-950'}>{name}</a> : null
                    )}
                    {!anonymous && !isMinimal && fullIdentity ? <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(fullIdentity.uid)}</span> : null}
                    {!isMinimal ? <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{mood ? `${mood.icon} ${mood.label}` : '未填写心情'}</span> : mood ? <span className="text-xs">{mood.icon}</span> : null}
                    {!isCompact ? <span className="text-xs font-bold text-slate-400">留言日 {date}</span> : null}
                    {!isCompact ? <span className="text-xs font-bold text-slate-400">发布 {beijingDateTime(item.createdAt)}</span> : null}
                    {canManageMessages && !previewMode && !isMinimal ? (
                      <button
                        type="button"
                        aria-label="删除留言"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          setDeleteTarget(item)
                        }}
                        className="text-xs font-black text-red-600 transition hover:text-red-700"
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                  <p className={isMinimal ? 'mt-0.5 whitespace-pre-wrap text-xs leading-4 text-slate-700' : 'mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700'}>{item.content}</p>
                  {rootComments.length && !isMinimal ? (
                    <div className="checkin-comment-thread mt-2 space-y-2">
                      {rootComments.map((comment) => {
                        const commentIdentity = 'uid' in comment.author ? comment.author : null
                        const commentName = getCommentAuthorName(comment.author)
                        const commentAvatar = profileImageUrl(commentIdentity?.profile?.avatarUrl || commentIdentity?.avatarUrl)
                        const children = collectThreadComments(comment.id)
                        const showAll = Boolean(expandedReplies[comment.id])
                        const visibleChildren = showAll ? children : children.slice(0, 3)
                        return (
                          <div key={comment.id} id={`comment-${comment.id}`} className="checkin-comment-card rounded-xl p-2 text-sm leading-6 text-slate-600">
                            <div className="flex items-start gap-2">
                              {anonymous || !commentIdentity ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-100 text-xs">E</span> : <a href={`/user/${formatUid(commentIdentity.uid)}`} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-xs font-black text-white"><SafeAvatar src={commentAvatar} name={commentName} uid={commentIdentity.uid} className="h-full w-full" textClassName="text-xs" /></a>}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {anonymous || !commentIdentity ? <span className="font-black text-brand-950">匿名E友</span> : <a href={`/user/${formatUid(commentIdentity.uid)}`} className="font-black text-brand-950">{commentName}</a>}
                                  {!anonymous && commentIdentity ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-brand-700">UID {formatUid(commentIdentity.uid)}</span> : null}
                                  <span className="text-xs font-bold text-slate-400">{beijingDateTime(comment.createdAt)}</span>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap">{comment.content}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setReplyTargets((current) => ({ ...current, [item.id]: { id: comment.id, name: commentName } }))}
                                    className="text-xs font-black text-brand-700"
                                  >
                                    回复
                                  </button>
                                  {comment.canDelete ? (
                                    <DeleteCommentButton endpoint={`/api/daily-message-comments/${comment.id}`} onDeleted={() => loadMessages(date, sort)} />
                                  ) : null}
                                </div>

                                {visibleChildren.length ? (
                                  <div className="checkin-reply-thread mt-2 space-y-1 pl-3 sm:pl-4">
                                    {visibleChildren.map(({ comment: child, replyToName }) => {
                                      const childIdentity = 'uid' in child.author ? child.author : null
                                      const childName = getCommentAuthorName(child.author)
                                      const childAvatar = profileImageUrl(childIdentity?.profile?.avatarUrl || childIdentity?.avatarUrl)
                                      return (
                                        <div key={child.id} id={`comment-${child.id}`} className="min-w-0 py-2">
                                          <div className="flex min-w-0 items-start gap-2">
                                            {anonymous || !childIdentity ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 text-[10px]">E</span> : <a href={`/user/${formatUid(childIdentity.uid)}`} className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] font-black text-white"><SafeAvatar src={childAvatar} name={childName} uid={childIdentity.uid} className="h-full w-full" textClassName="text-[10px]" /></a>}
                                            <div className="min-w-0 flex-1">
                                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                                {anonymous || !childIdentity ? <span className="font-black text-brand-950">匿名E友</span> : <a href={`/user/${formatUid(childIdentity.uid)}`} className="font-black text-brand-950">{childName}</a>}
                                                {!anonymous && childIdentity ? <span className="font-bold text-slate-400">UID {formatUid(childIdentity.uid)}</span> : null}
                                                {!anonymous && childIdentity ? <span className="font-bold text-slate-400">Lv.{childIdentity.level}</span> : null}
                                                <span className="font-bold text-slate-400">{beijingDateTime(child.createdAt)}</span>
                                              </div>
                                              <p className="mt-1 break-words whitespace-pre-wrap text-sm leading-6">
                                                <span className="font-black text-brand-700">回复 @{replyToName}：</span>
                                                {child.content}
                                              </p>
                                              <div className="mt-1 flex flex-wrap items-center gap-3">
                                                <button
                                                  type="button"
                                                  onClick={() => setReplyTargets((current) => ({ ...current, [item.id]: { id: child.id, name: childName } }))}
                                                  className="text-xs font-black text-brand-700"
                                                >
                                                  回复
                                                </button>
                                                {child.canDelete ? (
                                                  <DeleteCommentButton endpoint={`/api/daily-message-comments/${child.id}`} variant="text" onDeleted={() => loadMessages(date, sort)} />
                                                ) : null}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )
                                    })}
                                    {children.length > 3 ? (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedReplies((current) => ({ ...current, [comment.id]: !showAll }))}
                                        className="text-xs font-black text-brand-700"
                                      >
                                        {showAll ? '收起回复' : `展开剩余 ${children.length - 3} 条回复`}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  {!isMinimal ? <DailyMessageActions
                    messageId={item.id}
                    liked={effectiveLiked}
                    likeCount={effectiveLikeCount}
                    favoriteCount={item.favoriteCount}
                    commentCount={item.commentCount}
                    initialFavorited={'favorited' in item ? item.favorited : item.favorites.length > 0}
                    replyTo={replyTarget}
                    onReplyCancel={() => setReplyTargets((current) => ({ ...current, [item.id]: null }))}
                    onCommentCreated={() => loadMessages(date, sort)}
                    onLikeChange={(value) => likeCtx.setLike(item.id, value)}
                  /> : null}
                  {!isMinimal && !previewMode && !anonymous ? (
                    // 朋友圈式点赞头像行：最多 10 个头像，超出 +N，点击展开全部点赞用户。
                    // 头像列表以服务端数据为准（点赞动作本身只即时更新 likeCount / liked）。
                    // 匿名墙（anonymous）不展示点赞者身份，仅保留 DailyMessageActions 的 ♥ 数量。
                    <LikeAvatars
                      likers={item.likers || []}
                      totalCount={effectiveLikeCount}
                      listUrl={`/api/daily-messages/${item.id}/like`}
                      className="mt-2"
                    />
                  ) : null}
                </div>
              </div>
            </article>
          )
        }) : (
          <div className="checkin-messages-empty rounded-2xl p-8 text-center font-bold text-slate-500">{emptyText || '这一天还没有 E友留言。'}</div>
        )}
      </div>
      {messages.length > previewPageSize ? (
        <nav className={`${isMinimal ? 'mt-1 gap-1' : 'mt-3 gap-1.5'} flex shrink-0 flex-wrap items-center justify-center`} aria-label="E友留言分页">
          <button
            type="button"
            onClick={() => setPage(1)}
            disabled={page === 1}
            className={`${isMinimal ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} rounded-full bg-sky-50 font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-45`}
          >
            首页
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className={`${isMinimal ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} rounded-full bg-sky-50 font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-45`}
          >
            上一页
          </button>
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => setPage(pageNumber)}
              className={`grid ${isMinimal ? 'h-6 min-w-6 px-1.5 text-[10px]' : 'h-8 min-w-8 px-2.5 text-xs'} place-items-center rounded-full font-black transition ${
                pageNumber === page ? 'bg-brand-950 text-white shadow-sm' : 'bg-sky-50 text-brand-700 hover:bg-sky-100'
              }`}
              aria-current={pageNumber === page ? 'page' : undefined}
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page === totalPages}
            className={`${isMinimal ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} rounded-full bg-sky-50 font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-45`}
          >
            下一页
          </button>
        </nav>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="确认删除这条留言？"
        description="删除后，这条留言将从挂号页面移除，此操作无法撤销。"
        confirmLabel="确认删除"
        loading={isDeletingMessage}
        onConfirm={() => void confirmDeleteMessage()}
        onCancel={() => {
          if (!isDeletingMessage) setDeleteTarget(null)
        }}
      />
    </div>
  )
}
