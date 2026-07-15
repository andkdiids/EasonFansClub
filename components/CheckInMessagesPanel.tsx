'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DailyMessageActions } from '@/components/DailyMessageActions'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
import type { CheckInMessageItem, CheckInMessageSort } from '@/lib/checkin-messages'
import { getMood } from '@/lib/daily'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type DailyComment = CheckInMessageItem['comments'][number]
const messagesPerPage = 5

function beijingDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function isAdminRole(role: string) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
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

export function CheckInMessagesPanel({
  title,
  density = 'normal',
  anonymous = false,
  emptyText,
  initialMessages,
  initialDate,
  maxDate,
  initialSort,
  sessionUserId,
  sessionUserRole,
}: Readonly<{
  title?: string
  density?: PageLayoutModuleDensity
  anonymous?: boolean
  emptyText?: string
  initialMessages: CheckInMessageItem[]
  initialDate: string
  maxDate: string
  initialSort: CheckInMessageSort
  sessionUserId: string
  sessionUserRole: string
}>) {
  const [date, setDate] = useState(initialDate)
  const [sort, setSort] = useState<CheckInMessageSort>(initialSort)
  const [messages, setMessages] = useState(initialMessages)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [replyTargets, setReplyTargets] = useState<Record<string, { id: string; name: string } | null>>({})
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const isCompact = density !== 'normal'
  const isMinimal = density === 'minimal'
  const totalPages = Math.max(1, Math.ceil(messages.length / messagesPerPage))
  const visibleMessages = useMemo(() => {
    const safePage = Math.min(Math.max(page, 1), totalPages)
    const start = (safePage - 1) * messagesPerPage
    return messages.slice(start, start + messagesPerPage)
  }, [messages, page, totalPages])
  const pageNumbers = useMemo(() => {
    const maxVisible = 5
    const start = Math.max(1, Math.min(page - 2, totalPages - maxVisible + 1))
    const end = Math.min(totalPages, start + maxVisible - 1)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [page, totalPages])

  function addComment(messageId: string, comment: unknown) {
    if (!comment || typeof comment !== 'object') return
    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? { ...message, commentCount: message.commentCount + 1, comments: [...message.comments, comment as DailyComment] }
        : message
    )))
  }

  function removeComment(messageId: string, commentId: string) {
    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? (() => {
            const tree = buildCommentTree(message.comments)
            const collectIds = (parentId: string): string[] => (tree.get(parentId) || []).flatMap((comment) => [comment.id, ...collectIds(comment.id)])
            const removeIds = new Set([commentId, ...collectIds(commentId)])
            return {
              ...message,
              commentCount: Math.max(message.commentCount - removeIds.size, 0),
              comments: message.comments.filter((comment) => !removeIds.has(comment.id)),
            }
          })()
        : message
    )))
  }

  const loadMessages = useCallback(async (nextDate = date, nextSort = sort) => {
    if (isLoading) return

    setError('')
    setIsLoading(true)
    const params = new URLSearchParams({ date: nextDate, sort: nextSort })

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
      setMessages(Array.isArray(data.messages) ? data.messages : [])
      setPage(1)
      updateUrl(data.date || nextDate, data.sort === 'hot' ? 'hot' : 'latest')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '留言列表暂时无法加载，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }, [date, isLoading, sort])

  useEffect(() => {
    setDate(initialDate)
    setSort(initialSort)
    setMessages(initialMessages)
    setPage(1)
  }, [initialDate, initialMessages, initialSort])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
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
  }, [loadMessages, maxDate, sort])

  return (
    <div className={`${isMinimal ? 'p-2' : 'p-3 sm:p-4'} flex min-h-0 flex-col overflow-visible rounded-[24px] border border-sky-100 bg-white/85 shadow-sm`}>
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
            className="rounded-full border border-sky-100 px-3 py-1.5 text-xs font-bold outline-none sm:text-sm"
          >
            <option value="latest">最新</option>
            <option value="hot">热度</option>
          </select>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-full bg-brand-700 px-3 py-1.5 text-xs font-black text-white disabled:opacity-60 sm:text-sm"
          >
            {isLoading ? '加载中' : '查看'}
          </button>
        </form> : null}
      </div>

      {error ? <p className="mt-3 shrink-0 rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null}

      <div className={`${isMinimal ? 'mt-1 space-y-1.5' : 'mt-3 space-y-3'} min-h-0 overflow-visible`}>
        {messages.length ? visibleMessages.map((item) => {
          const mood = getMood(item.mood)
          const name = item.user.profile?.displayName || item.user.nickname
          const avatar = publicImageUrl(item.user.profile?.avatarUrl || item.user.avatarUrl)
          const commentTree = buildCommentTree(item.comments)
          const commentMap = buildCommentMap(item.comments)
          const rootComments = commentTree.get(null) || []
          const replyTarget = replyTargets[item.id] || null
          const collectThreadComments = (rootId: string) => {
            const result: Array<{ comment: DailyComment; replyToName: string }> = []
            const visit = (parentId: string) => {
              const parent = commentMap.get(parentId)
              const parentName = parent ? parent.author.profile?.displayName || parent.author.nickname : ''
              ;(commentTree.get(parentId) || []).forEach((child) => {
                result.push({ comment: child, replyToName: parentName })
                visit(child.id)
              })
            }
            visit(rootId)
            return result
          }
          return (
            <article key={item.id} className={`${isMinimal ? 'rounded-xl p-1.5' : 'rounded-2xl p-3'} border border-sky-100 bg-white shadow-sm`}>
              <div className={isMinimal ? 'flex gap-2' : 'flex gap-3'}>
                {anonymous ? (
                  <div className={`${isMinimal ? 'h-7 w-7 rounded-xl text-base' : 'h-10 w-10 rounded-2xl text-xl'} grid shrink-0 place-items-center overflow-hidden bg-sky-50`}>
                    {mood?.icon || '🎵'}
                  </div>
                ) : (
                  <a href={`/user/${formatUid(item.user.uid)}`} className={`${isMinimal ? 'h-7 w-7 rounded-xl text-base' : 'h-10 w-10 rounded-2xl text-xl'} grid shrink-0 place-items-center overflow-hidden bg-sky-50`}>
                    {avatar ? <SafeAvatar src={avatar} name={name} className="h-full w-full" /> : mood?.icon || '🎵'}
                  </a>
                )}
                <div className="min-w-0 flex-1">
                  <div className={isMinimal ? 'flex min-w-0 items-center gap-1.5' : 'flex flex-wrap items-center gap-2'}>
                    {anonymous ? (
                      <span className={isMinimal ? 'truncate text-xs font-black text-brand-950' : 'font-black text-brand-950'}>E院病友</span>
                    ) : (
                      <a href={`/user/${formatUid(item.user.uid)}`} className={isMinimal ? 'truncate text-xs font-black text-brand-950' : 'font-black text-brand-950'}>{name}</a>
                    )}
                    {!anonymous && !isMinimal ? <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(item.user.uid)}</span> : null}
                    {!isMinimal ? <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{mood?.icon} {mood?.label}</span> : <span className="text-xs">{mood?.icon}</span>}
                    {!isCompact ? <span className="text-xs font-bold text-slate-400">留言日 {date}</span> : null}
                    {!isCompact ? <span className="text-xs font-bold text-slate-400">发布 {beijingDateTime(item.createdAt)}</span> : null}
                  </div>
                  <p className={isMinimal ? 'mt-0.5 line-clamp-1 whitespace-pre-wrap text-xs leading-4 text-slate-700' : 'mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-slate-700'}>{item.content}</p>
                  {rootComments.length && !anonymous && !isMinimal ? (
                    <div className="mt-2 space-y-2 rounded-2xl bg-sky-50/70 p-2">
                      {rootComments.map((comment) => {
                        const commentName = comment.author.profile?.displayName || comment.author.nickname
                        const commentAvatar = publicImageUrl(comment.author.profile?.avatarUrl || comment.author.avatarUrl)
                        const children = collectThreadComments(comment.id)
                        const showAll = Boolean(expandedReplies[comment.id])
                        const visibleChildren = showAll ? children : children.slice(0, 3)
                        return (
                          <div key={comment.id} className="rounded-xl bg-white/70 p-2 text-sm leading-6 text-slate-600">
                            <div className="flex items-start gap-2">
                              <a href={`/user/${formatUid(comment.author.uid)}`} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-xs font-black text-white">
                                <SafeAvatar src={commentAvatar} name={commentName} className="h-full w-full" textClassName="text-xs" />
                              </a>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <a href={`/user/${formatUid(comment.author.uid)}`} className="font-black text-brand-950">{commentName}</a>
                                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-brand-700">UID {formatUid(comment.author.uid)}</span>
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
                                  {sessionUserId === comment.author.id || isAdminRole(sessionUserRole) ? (
                                    <DeleteCommentButton endpoint={`/api/daily-message-comments/${comment.id}`} onDeleted={() => removeComment(item.id, comment.id)} />
                                  ) : null}
                                </div>

                                {visibleChildren.length ? (
                                  <div className="mt-2 space-y-1 border-l-2 border-sky-100 pl-3 sm:pl-4">
                                    {visibleChildren.map(({ comment: child, replyToName }) => {
                                      const childName = child.author.profile?.displayName || child.author.nickname
                                      const childAvatar = publicImageUrl(child.author.profile?.avatarUrl || child.author.avatarUrl)
                                      return (
                                        <div key={child.id} className="min-w-0 py-2">
                                          <div className="flex min-w-0 items-start gap-2">
                                            <a href={`/user/${formatUid(child.author.uid)}`} className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] font-black text-white">
                                              <SafeAvatar src={childAvatar} name={childName} className="h-full w-full" textClassName="text-[10px]" />
                                            </a>
                                            <div className="min-w-0 flex-1">
                                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                                <a href={`/user/${formatUid(child.author.uid)}`} className="font-black text-brand-950">{childName}</a>
                                                <span className="font-bold text-slate-400">UID {formatUid(child.author.uid)}</span>
                                                <span className="font-bold text-slate-400">Lv.{child.author.level}</span>
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
                                                {sessionUserId === child.author.id || isAdminRole(sessionUserRole) ? (
                                                  <DeleteCommentButton endpoint={`/api/daily-message-comments/${child.id}`} variant="text" onDeleted={() => removeComment(item.id, child.id)} />
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
                  {!anonymous && !isMinimal ? <DailyMessageActions
                    messageId={item.id}
                    likeCount={item.likeCount}
                    favoriteCount={item.favoriteCount}
                    commentCount={item.commentCount}
                    initialLiked={item.likes.length > 0}
                    initialFavorited={item.favorites.length > 0}
                    replyTo={replyTarget}
                    onReplyCancel={() => setReplyTargets((current) => ({ ...current, [item.id]: null }))}
                    onCommentCreated={(comment) => addComment(item.id, comment)}
                  /> : null}
                </div>
              </div>
            </article>
          )
        }) : (
          <div className="rounded-2xl bg-sky-50/80 p-8 text-center font-bold text-slate-500">{emptyText || '这一天还没有 E友留言。'}</div>
        )}
      </div>
      {messages.length > messagesPerPage ? (
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
    </div>
  )
}
