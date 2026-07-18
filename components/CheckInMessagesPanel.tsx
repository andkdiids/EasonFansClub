'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DailyMessageActions } from '@/components/DailyMessageActions'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
import type { CheckInDisplayMessageItem, CheckInMessageSort } from '@/lib/checkin-messages'
import { formatBeijingDateTime } from '@/lib/beijing-time'
import { getMood } from '@/lib/daily'
import { publicImageUrl } from '@/lib/images'
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
      setMessages(Array.isArray(data.messages) ? data.messages : [])
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
    setPage(1)
  }, [initialDate, initialMessages, initialSort])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

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

  return (
    <div className={`${isMinimal ? 'p-2' : 'p-3 sm:p-4'} flex h-full flex-col rounded-[24px] border border-sky-100 bg-white/85 shadow-sm ${previewMode ? 'checkin-messages-preview pointer-events-none select-none' : 'min-h-0 overflow-visible'}`}>
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

      <div className={`${isMinimal ? 'mt-1 space-y-1.5' : 'mt-3 space-y-3'} flex-1 ${previewMode ? '' : 'min-h-0 overflow-visible'}`}>
        {messages.length ? visibleMessages.map((item) => {
          const mood = getMood(item.mood)
          const fullIdentity = 'user' in item ? item.user : null
          const name = fullIdentity?.profile?.displayName || fullIdentity?.nickname || ('author' in item ? item.author.name : '')
          const avatar = publicImageUrl(fullIdentity?.profile?.avatarUrl || fullIdentity?.avatarUrl)
          const commentTree = buildCommentTree(item.comments)
          const commentMap = buildCommentMap(item.comments)
          const rootComments = commentTree.get(null) || []
          const replyTarget = replyTargets[item.id] || null
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
            <article key={item.id} className={`${isMinimal ? 'rounded-xl p-1.5' : 'rounded-2xl p-3'} border border-sky-100 bg-white shadow-sm`}>
              <div className={isMinimal ? 'flex gap-2' : 'flex gap-3'}>
                {anonymous ? (
                  <div className={`${isMinimal ? 'h-7 w-7 rounded-xl text-base' : 'h-10 w-10 rounded-2xl text-xl'} grid shrink-0 place-items-center overflow-hidden bg-sky-50`}>
                    {mood?.icon || 'E'}
                  </div>
                ) : fullIdentity ? (
                  <a href={`/user/${formatUid(fullIdentity.uid)}`} className={`${isMinimal ? 'h-7 w-7 rounded-xl text-base' : 'h-10 w-10 rounded-2xl text-xl'} grid shrink-0 place-items-center overflow-hidden bg-sky-50`}>
                    {avatar ? <SafeAvatar src={avatar} name={name} className="h-full w-full" /> : mood?.icon || '🎵'}
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
                  </div>
                  <p className={isMinimal ? 'mt-0.5 whitespace-pre-wrap text-xs leading-4 text-slate-700' : 'mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700'}>{item.content}</p>
                  {rootComments.length && !isMinimal ? (
                    <div className="mt-2 space-y-2 rounded-2xl bg-sky-50/70 p-2">
                      {rootComments.map((comment) => {
                        const commentIdentity = 'uid' in comment.author ? comment.author : null
                        const commentName = getCommentAuthorName(comment.author)
                        const commentAvatar = publicImageUrl(commentIdentity?.profile?.avatarUrl || commentIdentity?.avatarUrl)
                        const children = collectThreadComments(comment.id)
                        const showAll = Boolean(expandedReplies[comment.id])
                        const visibleChildren = showAll ? children : children.slice(0, 3)
                        return (
                          <div key={comment.id} className="rounded-xl bg-white/70 p-2 text-sm leading-6 text-slate-600">
                            <div className="flex items-start gap-2">
                              {anonymous || !commentIdentity ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-100 text-xs">E</span> : <a href={`/user/${formatUid(commentIdentity.uid)}`} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-xs font-black text-white"><SafeAvatar src={commentAvatar} name={commentName} className="h-full w-full" textClassName="text-xs" /></a>}
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
                                  <div className="mt-2 space-y-1 border-l-2 border-sky-100 pl-3 sm:pl-4">
                                    {visibleChildren.map(({ comment: child, replyToName }) => {
                                      const childIdentity = 'uid' in child.author ? child.author : null
                                      const childName = getCommentAuthorName(child.author)
                                      const childAvatar = publicImageUrl(childIdentity?.profile?.avatarUrl || childIdentity?.avatarUrl)
                                      return (
                                        <div key={child.id} className="min-w-0 py-2">
                                          <div className="flex min-w-0 items-start gap-2">
                                            {anonymous || !childIdentity ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 text-[10px]">E</span> : <a href={`/user/${formatUid(childIdentity.uid)}`} className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-[10px] font-black text-white"><SafeAvatar src={childAvatar} name={childName} className="h-full w-full" textClassName="text-[10px]" /></a>}
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
                    likeCount={item.likeCount}
                    favoriteCount={item.favoriteCount}
                    commentCount={item.commentCount}
                    initialLiked={'liked' in item ? item.liked : item.likes.length > 0}
                    initialFavorited={'favorited' in item ? item.favorited : item.favorites.length > 0}
                    replyTo={replyTarget}
                    onReplyCancel={() => setReplyTargets((current) => ({ ...current, [item.id]: null }))}
                    onCommentCreated={() => loadMessages(date, sort)}
                  /> : null}
                </div>
              </div>
            </article>
          )
        }) : (
          <div className="rounded-2xl bg-sky-50/80 p-8 text-center font-bold text-slate-500">{emptyText || '这一天还没有 E友留言。'}</div>
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
    </div>
  )
}
