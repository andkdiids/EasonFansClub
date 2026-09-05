'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { redirectToLoginAfterConfirmedSessionInvalid } from '@/lib/client-auth'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DailyMessageActions } from '@/components/DailyMessageActions'
import { FriendFollowButton } from '@/components/FriendFollowButton'
import { LikeAvatars } from '@/components/LikeAvatars'
import { useCheckInLike } from '@/components/checkin-like-context'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { IpRegionLabel } from '@/components/IpRegionLabel'
import { SafeAvatar } from '@/components/SafeAvatar'
import { Pagination } from '@/components/ui/Pagination'
import { type CheckInDisplayMessageItem, type CheckInMessageItem, type CheckInMessagePagination, type CheckInMessageSort, type CheckInNotificationResolutionStatus } from '@/lib/checkin-messages'
import { anonymizeCheckInMessages } from '@/lib/checkin-message-display'
import { getCheckInMessagePageSize, CHECK_IN_MESSAGE_PAGE_SIZE } from '@/lib/checkin-pagination'
import { formatBeijingDateTime } from '@/lib/beijing-time'
import { checkInMessageAuthorId } from '@/lib/checkin-message-order'
import { getCheckInReplyToggleLabel, getVisibleCheckInReplyCount } from '@/lib/checkin-reply-display'
import { getMoodDisplay, NO_MOOD_LABEL } from '@/lib/checkin-mood'
import { profileImageUrl } from '@/lib/images'
import { scrollToSectionTop } from '@/lib/pagination'
import { formatUid } from '@/lib/uid'
import { UserDisplayName } from '@/components/UserDisplayName'
import { getFriendDisplayName, normalizeFriendRemark } from '@/lib/friend-display-name'

type DailyComment = CheckInDisplayMessageItem['comments'][number]
type FlattenedDailyComment = {
  comment: DailyComment
  replyToName: string
  isRoot: boolean
}
const messagesPerPage = CHECK_IN_MESSAGE_PAGE_SIZE
const EMPTY_FOLLOWED_USER_IDS: string[] = []

function beijingDateTime(value: string) {
  return formatBeijingDateTime(value)
}

function updateUrl(date: string, sort: CheckInMessageSort, page = 1) {
  const url = new URL(window.location.href)
  url.searchParams.set('date', date)
  url.searchParams.set('sort', sort)
  if (page > 1) url.searchParams.set('page', String(page))
  else url.searchParams.delete('page')
  window.history.pushState(null, '', `${url.pathname}?${url.searchParams.toString()}`)
}

type CheckInCompletedDetail = {
  date?: string
  dailyMessage?: CheckInMessageItem | null
}

type CheckInMessagesChangedDetail = { messageId?: string; date?: string }

function notifyCheckInMessagesChanged(messageId: string, date: string) {
  window.dispatchEvent(new CustomEvent<CheckInMessagesChangedDetail>('checkin:messages-changed', {
    detail: { messageId, date },
  }))
}

function isAdminMessage(message: CheckInDisplayMessageItem) {
  return 'isAdminMessage' in message && message.isAdminMessage
}

function messageSortOrder(message: CheckInDisplayMessageItem) {
  return 'sort' in message && typeof message.sort === 'number' ? message.sort : 0
}

function compareCheckInMessages(left: CheckInDisplayMessageItem, right: CheckInDisplayMessageItem, sort: CheckInMessageSort) {
  const adminOrder = Number(isAdminMessage(right)) - Number(isAdminMessage(left))
  if (adminOrder) return adminOrder

  const manualOrder = messageSortOrder(left) - messageSortOrder(right)
  if (manualOrder) return manualOrder

  const pinnedOrder = Number(right.isPinned) - Number(left.isPinned)
  if (pinnedOrder) return pinnedOrder

  const featuredOrder = Number(right.isFeatured) - Number(left.isFeatured)
  if (featuredOrder) return featuredOrder

  if (sort === 'hot') {
    const likeOrder = right.likeCount - left.likeCount
    if (likeOrder) return likeOrder

    const commentOrder = right.commentCount - left.commentCount
    if (commentOrder) return commentOrder
  }

  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
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

function flattenCommentThread(
  roots: DailyComment[],
  commentTree: Map<string | null, DailyComment[]>,
  messageAuthorName: string,
) {
  const flattened: FlattenedDailyComment[] = []
  const visited = new Set<string>()

  function visit(comment: DailyComment, replyToName: string, isRoot: boolean) {
    if (visited.has(comment.id)) return
    visited.add(comment.id)
    flattened.push({ comment, replyToName, isRoot })
    const childReplyToName = getCommentAuthorName(comment.author)
    for (const child of commentTree.get(comment.id) || []) visit(child, childReplyToName, false)
  }

  for (const root of roots) visit(root, messageAuthorName, true)
  return flattened
}

function getCommentAuthorName(author: DailyComment['author']) {
  return 'uid' in author ? author.displayName || author.nickname || 'E院用户' : author.name
}

function getCommentAuthorBadges(author: DailyComment['author']) {
  return 'uid' in author ? author.equippedBadges || (author.equippedBadge ? [author.equippedBadge] : []) : []
}

export function CheckInMessagesPanel({
  title,
  anonymous = false,
  scope = 'public',
  emptyText,
  initialMessages,
  initialPagination,
  initialFollowedUserIds = EMPTY_FOLLOWED_USER_IDS,
  initialDate,
  maxDate,
  initialSort,
  sessionUserId,
  focusMessageId,
  focusCommentId,
  focusErrorKind,
  canManageMessages = false,
}: Readonly<{
  title?: string
  anonymous?: boolean
  scope?: 'public' | 'friends'
  emptyText?: string
  initialMessages: CheckInDisplayMessageItem[]
  initialPagination?: CheckInMessagePagination
  initialFollowedUserIds?: string[]
  initialDate: string
  maxDate: string
  initialSort: CheckInMessageSort
  sessionUserId?: string
  focusMessageId?: string
  focusCommentId?: string
  focusErrorKind?: CheckInNotificationResolutionStatus
  /** 服务端根据当前登录用户角色计算的管理员标记：是否显示留言删除入口（接口侧仍独立鉴权）。 */
  canManageMessages?: boolean
}>) {
  const [date, setDate] = useState(initialDate)
  const [sort, setSort] = useState<CheckInMessageSort>(initialSort)
  const [messages, setMessages] = useState<CheckInDisplayMessageItem[]>(initialMessages)
  const [followedUserIds, setFollowedUserIds] = useState<Set<string>>(() => new Set(initialFollowedUserIds))
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pagination, setPagination] = useState<CheckInMessagePagination | null>(initialPagination || null)
  const [replyTargets, setReplyTargets] = useState<Record<string, { id: string; name: string } | null>>({})
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(1)
  const [recentlyCreatedMessageId, setRecentlyCreatedMessageId] = useState<string | null>(null)
  const [focusError, setFocusError] = useState('')
  // 管理员删除留言：第一次点击只打开确认框，确认后才调用管理接口。
  const [deleteTarget, setDeleteTarget] = useState<CheckInDisplayMessageItem | null>(null)
  const [isDeletingMessage, setIsDeletingMessage] = useState(false)
  // 跨面板共享的点赞覆盖层（E友留言 / 好友留言 同步、翻页不丢失）。
  const likeCtx = useCheckInLike()
  // likeCtx 的 value 在每次点赞后都会更换身份（覆盖层变化），同步 effect / loadMessages
  // 只能通过 ref 访问它，否则点赞会反复触发「重置分页 + 用服务端旧值覆盖点赞状态」。
  const likeCtxRef = useRef(likeCtx)
  const sessionUserIdRef = useRef(sessionUserId)
  const recentlyCreatedMessageRef = useRef<CheckInDisplayMessageItem | null>(null)
  const messagesSectionRef = useRef<HTMLDivElement>(null)
  const pageSizeRef = useRef(CHECK_IN_MESSAGE_PAGE_SIZE)
  const currentPageRef = useRef(initialPagination?.page || 1)
  const initialQueryRef = useRef({ date: initialDate, sort: initialSort })
  const handledFocusKeyRef = useRef('')
  useEffect(() => {
    likeCtxRef.current = likeCtx
  })
  useEffect(() => {
    sessionUserIdRef.current = sessionUserId
  }, [sessionUserId])
  const serverPaginated = Boolean(initialPagination)
  const activePageSize = serverPaginated ? pagination?.pageSize || messagesPerPage : messagesPerPage
  const totalPages = serverPaginated ? pagination?.totalPages || 1 : Math.max(1, Math.ceil(messages.length / messagesPerPage))
  const visibleMessages = useMemo(() => {
    const safePage = Math.min(Math.max(page, 1), totalPages)
    const start = (safePage - 1) * activePageSize
    const pagedMessages = serverPaginated ? messages : messages.slice(start, start + activePageSize)
    const recentMessage = recentlyCreatedMessageId
      ? messages.find((item) => item.id === recentlyCreatedMessageId)
      : null
    if (recentMessage && !serverPaginated && !pagedMessages.some((item) => item.id === recentMessage.id)) {
      return [recentMessage, ...pagedMessages]
    }
    return pagedMessages
  }, [activePageSize, messages, page, recentlyCreatedMessageId, serverPaginated, totalPages])

  const loadMessages = useCallback(async (
    nextDate = date,
    nextSort = sort,
    syncUrl = true,
    resetPage = true,
    requestedPage = resetPage ? 1 : page,
    requestedPageSize?: number,
    scrollAfterLoad = false,
  ) => {
    if (isLoading) return

    setError('')
    setIsLoading(true)
    const nextPage = serverPaginated ? Math.max(1, Math.trunc(requestedPage) || 1) : 1
    const nextPageSize = serverPaginated
      ? Math.max(1, Math.trunc(requestedPageSize || pageSizeRef.current || messagesPerPage) || messagesPerPage)
      : messagesPerPage
    const params = new URLSearchParams({ date: nextDate, sort: nextSort, scope })
    if (serverPaginated) {
      params.set('page', String(nextPage))
      params.set('pageSize', String(nextPageSize))
    }

    try {
      const response = await fetch(`/api/checkin/messages?${params.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({}))

      if (response.status === 401) {
        if (!(await redirectToLoginAfterConfirmedSessionInvalid(response, '/api/checkin/messages'))) {
          setError('请求失败，请稍后重试。')
        }
        return
      }

      if (!response.ok) {
        throw new Error(data.message || '留言列表暂时无法加载，请稍后重试')
      }

      setDate(data.date || nextDate)
      setSort(data.sort === 'hot' ? 'hot' : 'latest')
      const incoming = Array.isArray(data.messages) ? data.messages : []
      const localMessage = recentlyCreatedMessageRef.current
      const merged = !serverPaginated && localMessage && !incoming.some((item: CheckInDisplayMessageItem) => item.id === localMessage.id)
        ? [...incoming, localMessage].sort((left, right) => compareCheckInMessages(left, right, nextSort))
        : incoming
      setMessages(merged)
      if (scope === 'friends' && Array.isArray(data.followedUserIds)) {
        setFollowedUserIds(new Set(data.followedUserIds.filter((id: unknown): id is string => typeof id === 'string')))
      }
      const nextPagination = data.pagination as CheckInMessagePagination | undefined
      if (serverPaginated && nextPagination) {
        pageSizeRef.current = nextPagination.pageSize
        setPagination(nextPagination)
        setPage(nextPagination.page)
      } else if (resetPage) {
        setPage(1)
      }
      if (localMessage && incoming.some((item: CheckInDisplayMessageItem) => item.id === localMessage.id)) {
        recentlyCreatedMessageRef.current = null
        setRecentlyCreatedMessageId(null)
      }
      // 服务端重载后，用服务端最新 likeCount / liked 刷新共享覆盖层，
      // 确保服务端数据成为权威源，避免旧缓存覆盖新数据（如他人点赞）。
      likeCtxRef.current.reconcileLikes(incoming.map((item: CheckInDisplayMessageItem) => ({
        id: item.id,
        likeCount: item.likeCount,
        liked: 'liked' in item ? item.liked : (Array.isArray((item as { likes?: unknown[] }).likes) ? ((item as { likes: unknown[] }).likes.length > 0) : false),
      })))
      if (syncUrl) updateUrl(data.date || nextDate, data.sort === 'hot' ? 'hot' : 'latest', serverPaginated ? nextPagination?.page || nextPage : 1)
      if (scrollAfterLoad) {
        window.requestAnimationFrame(() => scrollToSectionTop(messagesSectionRef.current))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '留言列表暂时无法加载，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }, [date, isLoading, page, scope, serverPaginated, sort])

  function handlePageChange(nextPage: number) {
    const safePage = Math.min(Math.max(1, Math.trunc(nextPage) || 1), totalPages)
    if (serverPaginated) {
      void loadMessages(date, sort, true, false, safePage, undefined, true)
      return
    }
    setPage(safePage)
    window.requestAnimationFrame(() => scrollToSectionTop(messagesSectionRef.current))
  }

  useEffect(() => {
    const queryChanged = initialQueryRef.current.date !== initialDate || initialQueryRef.current.sort !== initialSort
    setDate(initialDate)
    setSort(initialSort)
    setMessages(initialMessages)
    setPagination(initialPagination || null)
    setFollowedUserIds(new Set(initialFollowedUserIds))
    pageSizeRef.current = initialPagination?.pageSize || messagesPerPage
    if (recentlyCreatedMessageRef.current && initialMessages.some((item) => item.id === recentlyCreatedMessageRef.current?.id)) {
      recentlyCreatedMessageRef.current = null
      setRecentlyCreatedMessageId(null)
    }
    // 用服务端初始数据刷新覆盖层（首次挂载时覆盖层为空，属 no-op；父组件重渲染传入新初始数据时保持服务端权威）。
    // 注意：不依赖 likeCtx——点赞会改变覆盖层导致 likeCtx 更换身份，若列入依赖会在每次点赞后
    // 重跑本 effect，用过期的 initialMessages 覆盖刚写入的点赞状态并把分页重置回第一页。
    likeCtxRef.current.reconcileLikes(initialMessages.map((item) => ({
      id: item.id,
      likeCount: item.likeCount,
      liked: 'liked' in item ? item.liked : (Array.isArray((item as { likes?: unknown[] }).likes) ? ((item as { likes: unknown[] }).likes.length > 0) : false),
    })))
    if (initialPagination) setPage(initialPagination.page)
    else if (queryChanged) setPage(1)
    initialQueryRef.current = { date: initialDate, sort: initialSort }
  }, [initialDate, initialFollowedUserIds, initialMessages, initialPagination, initialSort])

  useEffect(() => {
    if (!serverPaginated) return
    const mediaQuery = window.matchMedia('(min-width: 768px)')
    const syncPageSize = () => {
      const nextPageSize = getCheckInMessagePageSize(mediaQuery.matches)
      if (pageSizeRef.current === nextPageSize) return
      pageSizeRef.current = nextPageSize
      void loadMessages(date, sort, true, false, currentPageRef.current, nextPageSize)
    }
    syncPageSize()
    mediaQuery.addEventListener('change', syncPageSize)
    return () => mediaQuery.removeEventListener('change', syncPageSize)
  }, [date, initialPagination?.page, loadMessages, page, serverPaginated, sort])

  useEffect(() => {
    currentPageRef.current = page
  }, [page])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  useEffect(() => {
    if (!focusMessageId && !focusCommentId) {
      handledFocusKeyRef.current = ''
      setFocusError('')
      return
    }
    if (focusErrorKind === 'LOAD_FAILED') {
      setFocusError(focusCommentId ? '暂时无法加载回复，请稍后重试' : '暂时无法加载留言，请稍后重试')
      return
    }
    if (focusCommentId && (focusErrorKind === 'DELETED' || focusErrorKind === 'NOT_FOUND' || focusErrorKind === 'FORBIDDEN')) {
      setFocusError(focusErrorKind === 'DELETED'
        ? '该回复已被删除'
        : focusErrorKind === 'NOT_FOUND' ? '该回复不存在或已失效' : '你暂时无法查看这条回复')
      return
    }
    const messageIndex = messages.findIndex((item) =>
      item.id === focusMessageId || item.comments.some((comment) => comment.id === focusCommentId),
    )
    if (messageIndex < 0) {
      setFocusError(focusCommentId
        ? focusErrorKind === 'DELETED' ? '该回复已被删除' : focusErrorKind === 'NOT_FOUND' ? '该回复不存在或已失效' : focusErrorKind === 'FORBIDDEN' ? '你暂时无法查看这条回复' : '暂时无法定位这条回复'
        : focusErrorKind === 'DELETED' ? '该留言已被删除' : focusErrorKind === 'FORBIDDEN' ? '你暂时无法查看这条留言' : focusErrorKind === 'NOT_FOUND' ? '该留言不存在或已失效' : '该内容已被删除或无法查看')
      return
    }
    setFocusError('')
    if (!serverPaginated && page !== Math.floor(messageIndex / messagesPerPage) + 1) {
      setPage(Math.floor(messageIndex / messagesPerPage) + 1)
      return
    }
    const message = messages[messageIndex]
    if (focusCommentId) {
      const commentMap = buildCommentMap(message.comments)
      let current = commentMap.get(focusCommentId)
      if (current) {
        while (current.parentId && commentMap.has(current.parentId)) current = commentMap.get(current.parentId)!
        if (!expandedReplies[message.id]) {
          setExpandedReplies((value) => ({ ...value, [message!.id]: true }))
          return
        }
      }
    }
    const targetElementId = focusCommentId ? `comment-${focusCommentId}` : `message-${message.id}`
    const focusKey = `${focusMessageId || message.id}:${focusCommentId || ''}`
    if (handledFocusKeyRef.current === focusKey) return
    let highlightTimer: number | undefined
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetElementId)
      if (!target) return
      handledFocusKeyRef.current = focusKey
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('notification-focus-target')
      highlightTimer = window.setTimeout(() => target.classList.remove('notification-focus-target'), 2600)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (highlightTimer !== undefined) window.clearTimeout(highlightTimer)
    }
  }, [expandedReplies, focusCommentId, focusErrorKind, focusMessageId, messages, page, serverPaginated])

  useEffect(() => {
    function handleCheckInCompleted(event: Event) {
      if (scope !== 'public' && scope !== 'friends') return
      const detail = (event as CustomEvent<CheckInCompletedDetail>).detail
      const nextDate = detail?.date || maxDate
      const createdMessage = detail?.dailyMessage
      if (!createdMessage || nextDate !== date) return

      const displayMessage = anonymous
        ? anonymizeCheckInMessages([createdMessage])[0]
        : createdMessage
      if (!displayMessage) return

      if (scope === 'friends') {
        if (checkInMessageAuthorId(displayMessage) !== sessionUserIdRef.current) return
        recentlyCreatedMessageRef.current = displayMessage
        setRecentlyCreatedMessageId(displayMessage.id)
        setPage(1)
        setMessages([displayMessage])
        void loadMessages(nextDate, sort, true, true, 1)
        return
      }

      recentlyCreatedMessageRef.current = displayMessage
      setRecentlyCreatedMessageId(displayMessage.id)
      setMessages((current) => {
        if (current.some((item) => item.id === displayMessage.id)) return current
        return [...current, displayMessage].sort((left, right) => compareCheckInMessages(left, right, sort))
      })
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
  }, [anonymous, date, loadMessages, maxDate, scope, sort])

  useEffect(() => {
    function handleMessagesChanged(event: Event) {
      const detail = (event as CustomEvent<CheckInMessagesChangedDetail>).detail
      if (detail?.date && detail.date !== date) return
      if (detail?.messageId && !messages.some((item) => item.id === detail.messageId)) return
      void loadMessages(detail?.date || date, sort, false, false)
    }

    window.addEventListener('checkin:messages-changed', handleMessagesChanged)
    return () => window.removeEventListener('checkin:messages-changed', handleMessagesChanged)
  }, [date, loadMessages, messages, sort])

  useEffect(() => {
    if (anonymous || scope !== 'friends') return
    const updateRemark = (event: Event) => {
      const detail = (event as CustomEvent<{ targetUserId?: string; remark?: string | null }>).detail
      if (!detail?.targetUserId) return
      const friendRemark = normalizeFriendRemark(detail.remark)
      setMessages((current) => current.map((item): CheckInDisplayMessageItem => {
        if (!('author' in item) || !('uid' in item.author)) return item
        const privateItem = item as CheckInMessageItem
        const author = privateItem.author
        if (!('uid' in author)) return item
        const rootAuthorMatches = author.id === detail.targetUserId
        const commentMatches = privateItem.comments.some((comment) => 'uid' in comment.author && comment.author.id === detail.targetUserId)
        const likerMatches = privateItem.likers.some((liker) => liker.id === detail.targetUserId)
        if (!rootAuthorMatches && !commentMatches && !likerMatches) return privateItem
        return {
          ...privateItem,
          author: rootAuthorMatches
            ? { ...author, friendRemark, displayName: getFriendDisplayName({ nickname: author.nickname, friendRemark, isFriendContext: true }) }
            : author,
          comments: privateItem.comments.map((comment) => {
            if (!('uid' in comment.author) || comment.author.id !== detail.targetUserId) return comment
            return {
              ...comment,
              author: {
                ...comment.author,
                friendRemark,
                displayName: getFriendDisplayName({ nickname: comment.author.nickname, friendRemark, isFriendContext: true }),
              },
            }
          }),
          likers: privateItem.likers.map((liker) => liker.id === detail.targetUserId
            ? {
                ...liker,
                friendRemark,
                displayName: getFriendDisplayName({ nickname: liker.nickname, friendRemark, isFriendContext: true }),
              }
            : liker),
        }
      }))
    }
    window.addEventListener('friend-remark:updated', updateRemark)
    return () => window.removeEventListener('friend-remark:updated', updateRemark)
  }, [anonymous, scope])

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
      notifyCheckInMessagesChanged(deleteTarget.id, date)
      setDeleteTarget(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请稍后重试')
      setDeleteTarget(null)
    } finally {
      setIsDeletingMessage(false)
    }
  }

  return (
    <div ref={messagesSectionRef} className="checkin-messages-panel flex min-w-0 flex-col rounded-[24px] border p-3 shadow-sm scroll-mt-24 sm:p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase text-brand-700">{scope === 'public' ? 'Public Check-ins' : 'Friend Check-ins'}</p>
          <h2 className="mt-1 text-2xl font-black leading-tight text-brand-950">{title || '病友留言'}</h2>
        </div>
        <form
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
        </form>
      </div>

      {error ? <p className="mt-3 shrink-0 rounded-2xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null}
      {focusError ? <p className="mt-3 shrink-0 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-800">{focusError}</p> : null}

      <div className="mt-3 space-y-3">
        {messages.length ? visibleMessages.map((item) => {
          const mood = getMoodDisplay(item)
          const fullIdentity = 'author' in item && 'uid' in item.author ? item.author : null
          const name = fullIdentity?.displayName || fullIdentity?.nickname || ('author' in item && 'name' in item.author ? item.author.name : 'E院用户')
          const avatar = profileImageUrl(fullIdentity?.profile?.avatarUrl || fullIdentity?.avatarUrl)
          const commentTree = buildCommentTree(item.comments)
          const rootComments = commentTree.get(null) || []
          const replyTarget = replyTargets[item.id] || null
          // 点赞展示状态：优先用共享覆盖层（双面板同步 / 翻页保留），否则用服务端初始值。
          const likeOverride = likeCtx.getLike(item.id)
          const effectiveLiked = likeOverride ? likeOverride.liked : ('liked' in item ? item.liked : item.likes.length > 0)
          const effectiveLikeCount = likeOverride ? likeOverride.likeCount : item.likeCount
           const threadComments = flattenCommentThread(rootComments, commentTree, name)
           const showAllReplies = Boolean(expandedReplies[item.id])
           const isFocusedMessage = item.id === focusMessageId || item.comments.some((comment) => comment.id === focusCommentId)
           // A notification target may be an old nested reply outside the
           // normal preview window. Once the exact target is loaded, render
           // the complete thread so the target and its ancestors are real DOM
           // nodes before the scroll/highlight effect runs.
           const visibleThreadComments = isFocusedMessage && focusCommentId
             ? threadComments
             : threadComments.slice(0, getVisibleCheckInReplyCount(threadComments.length, showAllReplies))
          const replyToggleLabel = getCheckInReplyToggleLabel(threadComments.length, showAllReplies)
          return (
            <article key={item.id} id={`message-${item.id}`} data-checkin-message-id={item.id} className="checkin-message-card rounded-2xl border p-3 shadow-sm">
              <div className="flex gap-3">
                {anonymous ? (
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sky-50 text-xl">
                    {mood?.icon || 'E'}
                  </div>
                ) : fullIdentity ? (
                  <a href={`/user/${formatUid(fullIdentity.uid)}`} className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sky-50 text-xl">
                    {avatar ? <SafeAvatar src={avatar} name={name} uid={fullIdentity?.uid} className="h-full w-full" /> : mood?.icon || '🎵'}
                  </a>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {anonymous ? (
                      <span className="font-black text-brand-950">E院病友</span>
                    ) : (
                      fullIdentity ? <a href={`/user/${formatUid(fullIdentity.uid)}`} className="min-w-0 max-w-[12rem] truncate font-black text-brand-950 sm:max-w-[16rem]"><UserDisplayName name={name} uid={fullIdentity.uid} badges={fullIdentity.equippedBadges} badge={fullIdentity.equippedBadge} compact /></a> : null
                    )}
                    {scope === 'friends' && !anonymous && fullIdentity && fullIdentity.id !== sessionUserId && !followedUserIds.has(fullIdentity.id) ? (
                      <FriendFollowButton
                        userId={fullIdentity.id}
                        initialFollowed={false}
                        compact
                        hideWhenFollowed
                        onChanged={(nextFollowed) => {
                          setFollowedUserIds((current) => {
                            const next = new Set(current)
                            if (nextFollowed) next.add(fullIdentity.id)
                            else next.delete(fullIdentity.id)
                            return next
                          })
                          if (nextFollowed) void loadMessages(date, sort, false, false, page)
                        }}
                      />
                    ) : null}
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{mood.formatted || NO_MOOD_LABEL}</span>
                    <span className="text-xs font-bold text-slate-400">留言日 {date}</span>
                    <span className="text-xs font-bold text-slate-400">发布 {beijingDateTime(item.createdAt)}</span>
                    <IpRegionLabel ipRegion={item.ipRegion} />
                    {canManageMessages ? (
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
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.content}</p>
                  {threadComments.length ? (
                    <div className="checkin-comment-thread mt-2 space-y-2">
                      {visibleThreadComments.map(({ comment, replyToName, isRoot }) => {
                        const commentIdentity = 'uid' in comment.author ? comment.author : null
                        const commentName = getCommentAuthorName(comment.author)
                        const commentAvatar = profileImageUrl(commentIdentity?.profile?.avatarUrl || commentIdentity?.avatarUrl)
                        return (
                          <div key={comment.id} id={`comment-${comment.id}`} data-checkin-reply-id={comment.id} className={`${isRoot ? 'checkin-comment-card' : 'checkin-reply-thread pl-3 sm:pl-4'} rounded-xl p-2 text-sm leading-6 text-slate-600`}>
                            <div className="flex items-start gap-2">
                              {anonymous || !commentIdentity ? <span className={`${isRoot ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]'} grid shrink-0 place-items-center rounded-full bg-sky-100`}>E</span> : <a href={`/user/${formatUid(commentIdentity.uid)}`} className={`${isRoot ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]'} grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 font-black text-white`}><SafeAvatar src={commentAvatar} name={commentName} uid={commentIdentity.uid} className="h-full w-full" textClassName={isRoot ? 'text-xs' : 'text-[10px]'} /></a>}
                              <div className="min-w-0 flex-1">
                                <div className={`${isRoot ? 'flex flex-wrap items-center gap-2' : 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs'}`}>
                                  {anonymous || !commentIdentity ? <span className="font-black text-brand-950">匿名E友</span> : <a href={`/user/${formatUid(commentIdentity.uid)}`} className="font-black text-brand-950"><UserDisplayName name={commentName} uid={commentIdentity.uid} badges={getCommentAuthorBadges(comment.author)} compact /></a>}
                                  {!isRoot && !anonymous && commentIdentity ? <span className="font-bold text-slate-400">Lv.{commentIdentity.level}</span> : null}
                                  <span className="text-xs font-bold text-slate-400">{beijingDateTime(comment.createdAt)}</span>
                                  <IpRegionLabel ipRegion={comment.ipRegion} />
                                </div>
                                <p className={`${isRoot ? 'text-sm' : 'text-sm'} mt-1 break-words whitespace-pre-wrap leading-6`}>
                                  {!isRoot ? <span className="font-black text-brand-700">回复 @{replyToName}：</span> : null}
                                  {comment.content}
                                </p>
                                <div className={`${isRoot ? 'mt-2 gap-2' : 'mt-1 gap-3'} flex flex-wrap items-center`}>
                                  <button
                                    type="button"
                                    onClick={() => setReplyTargets((current) => ({ ...current, [item.id]: { id: comment.id, name: commentName } }))}
                                    className="text-xs font-black text-brand-700"
                                  >
                                    回复
                                  </button>
                                  {comment.canDelete ? (
                                    <DeleteCommentButton endpoint={`/api/daily-message-comments/${comment.id}`} variant={isRoot ? 'pill' : 'text'} onDeleted={() => notifyCheckInMessagesChanged(item.id, date)} />
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {replyToggleLabel ? (
                        <button
                          type="button"
                          onClick={() => setExpandedReplies((current) => ({ ...current, [item.id]: !showAllReplies }))}
                          className="text-xs font-black text-brand-700"
                        >
                          {replyToggleLabel}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <DailyMessageActions
                    messageId={item.id}
                    liked={effectiveLiked}
                    likeCount={effectiveLikeCount}
                    favoriteCount={item.favoriteCount}
                    commentCount={item.commentCount}
                    initialFavorited={'favorited' in item ? item.favorited : item.favorites.length > 0}
                    replyTo={replyTarget}
                    onReplyCancel={() => setReplyTargets((current) => ({ ...current, [item.id]: null }))}
                    onCommentCreated={() => notifyCheckInMessagesChanged(item.id, date)}
                    onLikeChange={(value) => likeCtx.setLike(item.id, value)}
                  />
                  {!anonymous ? (
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
          <div className="checkin-messages-empty rounded-2xl p-8 text-center font-bold text-slate-500">{emptyText || '这一天还没有病友留言。'}</div>
        )}
      </div>
      {totalPages > 1 ? (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          disabled={isLoading}
          ariaLabel="病友留言分页"
          className="checkin-message-pagination"
        />
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
