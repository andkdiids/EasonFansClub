'use client'

import { useCallback, useEffect, useState } from 'react'
import { DailyMessageActions } from '@/components/DailyMessageActions'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { CheckInMessageItem, CheckInMessageSort } from '@/lib/checkin-messages'
import { getMood } from '@/lib/daily'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

type DailyComment = CheckInMessageItem['comments'][number]

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
  initialMessages,
  initialDate,
  maxDate,
  initialSort,
  sessionUserId,
  sessionUserRole,
}: Readonly<{
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
  }, [initialDate, initialMessages, initialSort])

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
    <div className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase text-brand-700">E Friends Messages</p>
          <h2 className="mt-2 text-3xl font-black text-brand-950">E友留言</h2>
        </div>
        <form
          className="flex flex-wrap gap-2"
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
            className="rounded-full border border-sky-100 px-4 py-2 text-sm font-bold outline-none"
          />
          <select
            name="sort"
            value={sort}
            onChange={(event) => {
              const nextSort = event.target.value === 'hot' ? 'hot' : 'latest'
              setSort(nextSort)
              loadMessages(date, nextSort)
            }}
            className="rounded-full border border-sky-100 px-4 py-2 text-sm font-bold outline-none"
          >
            <option value="latest">最新</option>
            <option value="hot">热度</option>
          </select>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
          >
            {isLoading ? '加载中' : '查看'}
          </button>
        </form>
      </div>

      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</p> : null}

      <div className="mt-6 space-y-5">
        {messages.length ? messages.map((item) => {
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
            <article key={item.id} className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm">
              <div className="flex gap-4">
                <a href={`/user/${formatUid(item.user.uid)}`} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sky-50 text-2xl">
                  {avatar ? <SafeAvatar src={avatar} name={name} className="h-full w-full" /> : mood?.icon || '🎵'}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/user/${formatUid(item.user.uid)}`} className="font-black text-brand-950">{name}</a>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(item.user.uid)}</span>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{mood?.icon} {mood?.label}</span>
                    <span className="text-xs font-bold text-slate-400">留言日 {date}</span>
                    <span className="text-xs font-bold text-slate-400">发布 {beijingDateTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap leading-8 text-slate-700">{item.content}</p>
                  {rootComments.length ? (
                    <div className="mt-4 space-y-2 rounded-2xl bg-sky-50/70 p-3">
                      {rootComments.map((comment) => {
                        const commentName = comment.author.profile?.displayName || comment.author.nickname
                        const commentAvatar = publicImageUrl(comment.author.profile?.avatarUrl || comment.author.avatarUrl)
                        const children = collectThreadComments(comment.id)
                        const showAll = Boolean(expandedReplies[comment.id])
                        const visibleChildren = showAll ? children : children.slice(0, 3)
                        return (
                          <div key={comment.id} className="rounded-xl bg-white/70 p-3 text-sm leading-6 text-slate-600">
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
                  <DailyMessageActions
                    messageId={item.id}
                    likeCount={item.likeCount}
                    favoriteCount={item.favoriteCount}
                    commentCount={item.commentCount}
                    initialLiked={item.likes.length > 0}
                    initialFavorited={item.favorites.length > 0}
                    replyTo={replyTarget}
                    onReplyCancel={() => setReplyTargets((current) => ({ ...current, [item.id]: null }))}
                    onCommentCreated={(comment) => addComment(item.id, comment)}
                  />
                </div>
              </div>
            </article>
          )
        }) : (
          <div className="rounded-2xl bg-sky-50/80 p-8 text-center font-bold text-slate-500">这一天还没有 E友留言。</div>
        )}
      </div>
    </div>
  )
}
