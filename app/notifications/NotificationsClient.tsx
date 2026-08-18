'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NotificationReplyComposer, type NotificationReplyPayload } from '@/components/NotificationReplyComposer'
import { Pagination } from '@/components/ui/Pagination'
import { useNotificationSummary } from '@/components/NotificationProvider'
import { getNotificationTarget } from '@/lib/notification-target'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { parseNotificationCategory, type NotificationCategory, type UnifiedNotification, type UnreadSummary } from '@/lib/notifications'
import { shouldRefreshNotificationList } from '@/lib/notification-refresh-policy'

// 系统类通知（使用网站 Logo 头像，而非用户头像或默认黑色方块）
const SYSTEM_LIKE_TYPES = new Set(['SYSTEM', 'ADMIN', 'BADGE', 'BIRTHDAY_GREETING', 'USER_REWARD'])

function isSystemLikeNotification(item: UnifiedNotification) {
  // 系统通知来源、无操作人，或显式的系统类型（含生日纪念）均视为系统类
  return item.source === 'system' || item.actorUid === null || SYSTEM_LIKE_TYPES.has(item.type)
}

function isSystemNotification(item: UnifiedNotification) {
  // UnifiedNotification 用 source 标记 SystemNotification，用 type 标记个人系统通知。
  return item.source === 'system' || item.type === 'SYSTEM'
}

function isBirthdayNotification(item: UnifiedNotification) {
  return item.type === 'BIRTHDAY_GREETING'
}

/**
 * 按通知类型提供「智能入口」：不同通知给出不同快捷入口与文案，而不是都进同一页面
 * （账号安全→去设置、资料→编辑资料、审核→查看帖子、互动→查看互动 等）。
 * - 返回 { label, href } 时渲染为跳转链接；
 * - 返回 { label, action: 'dock' } 时渲染为打开好友/私信 Dock 的按钮；
 * - 返回 null 时该通知不展示智能入口（如无任何跳转目标的系统公告，仅可标记已读 / 清除）。
 */
function getSmartEntry(item: UnifiedNotification): { label: string; href?: string; action?: 'dock' } | null {
  if (isSystemNotification(item)) return null

  const target = getNotificationTarget(item)
  if (target && target !== item.link) item = { ...item, link: target }
  switch (item.type) {
    case 'LIKE':
      return target ? { label: '查看点赞', href: target } : null
    case 'REPLY':
      return target ? { label: '查看回复', href: target } : null
    case 'FRIEND_REQUEST':
    case 'FOLLOW':
      return { label: '去好友', href: '/friends#received-requests' }
    case 'GUESS_SONG_DUEL_INVITE':
      return { label: '接受对决邀请', href: item.link || '/games/guess-song/duel' }
    case 'MESSAGE':
      return { label: '打开私信', action: 'dock' }
    case 'ADMIN':
      return target
        ? { label: target.startsWith('/profile/stickers') ? '修改表情包' : '查看详情', href: target }
        : null
    case 'BADGE':
      return { label: '查看徽章', href: '/profile/badges' }
    case 'BIRTHDAY_GREETING':
      return { label: '编辑资料', href: '/profile/edit' }
    case 'USER_REWARD':
      return { label: '查看成长', href: item.link || '/profile' }
    case 'ANNOUNCEMENT':
    case 'MAINTENANCE':
    case 'SECURITY':
      return target ? { label: '前往详情', href: target } : null
    default:
      return target ? { label: '查看详情', href: target } : null
  }
}

const categoryLabels: Record<NotificationCategory, string> = {
  all: '全部',
  reply: '回复',
  like: '点赞',
  friend: '申请',
  messages: '私信',
  feedback: '反馈',
  system: '系统',
  wall: '留言墙',
}

const typeIcon: Record<string, string> = {
  reply: '↩',
  like: '♥',
  friend: '+',
  messages: '✉',
  feedback: '!',
  system: 'i',
  wall: '✎',
}

function formatTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function getInitial(uid?: number | null) {
  return uid ? String(uid).padStart(5, '0').slice(0, 1) : 'E'
}

type NotificationReadResponse = {
  ok?: boolean
  readAt?: string | null
  notification?: {
    id: string
    source: UnifiedNotification['source']
    isRead: boolean
    readAt: string | null
  }
}

// 本地即时递减未读数（分类角标同步），随后由 Provider 触发的服务端汇总校正为权威值。
const NOTIFICATION_LIST_PAGE_SIZE = 20
const OPTIMISTIC_READ_STORAGE_KEY = 'notifications:optimistic-read'
const DISMISSED_SYSTEM_STORAGE_KEY = 'notifications:dismissed-system'

type NotificationPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function notificationKey(item: Pick<UnifiedNotification, 'id' | 'source'>) {
  return `${item.source}:${item.id}`
}

function persistOptimisticRead(key: string, readAt: Date) {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(OPTIMISTIC_READ_STORAGE_KEY) || '{}') as Record<string, string>
    stored[key] = readAt.toISOString()
    window.sessionStorage.setItem(OPTIMISTIC_READ_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // sessionStorage is only a return-state enhancement; server persistence is authoritative.
  }
}

function removePersistedOptimisticRead(key: string) {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(OPTIMISTIC_READ_STORAGE_KEY) || '{}') as Record<string, string>
    delete stored[key]
    if (Object.keys(stored).length) window.sessionStorage.setItem(OPTIMISTIC_READ_STORAGE_KEY, JSON.stringify(stored))
    else window.sessionStorage.removeItem(OPTIMISTIC_READ_STORAGE_KEY)
  } catch {
    // Ignore malformed or unavailable session storage.
  }
}

function readDismissedSystemIds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(DISMISSED_SYSTEM_STORAGE_KEY) || '[]')
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function rememberDismissedSystemIds(ids: string[]) {
  if (!ids.length) return
  const dismissed = readDismissedSystemIds()
  ids.forEach((id) => dismissed.add(id))
  try {
    window.localStorage.setItem(DISMISSED_SYSTEM_STORAGE_KEY, JSON.stringify(Array.from(dismissed).slice(-1000)))
  } catch {
    // Local dismissal only prevents a global system row from reappearing in this browser.
  }
}

function filterDismissedSystemNotifications(items: UnifiedNotification[]) {
  const dismissed = readDismissedSystemIds()
  return items.filter((item) => item.source !== 'system' || !dismissed.has(item.id))
}

function isNotificationRead(item: UnifiedNotification) {
  // `isRead` is the unified client-side fact. Personal rows are mapped from
  // Notification.isRead and system rows from SystemNotificationRead.
  return item.isRead === true
}

function mergeUnreadSummary(base: UnreadSummary, items: UnifiedNotification[], direction: 1 | -1) {
  const next = { ...base }
  const change = (value: number) => direction === -1 ? Math.max(0, value - 1) : value + 1
  for (const item of items) {
    if (isNotificationRead(item)) continue
    next.total = change(next.total)
    if (item.source === 'system' || item.category === 'system' || item.category === 'reply' || item.category === 'like' || item.category === 'wall') {
      next.notifications = change(next.notifications)
    }
    if (item.source === 'system' || item.category === 'system') next.system = change(next.system)
    if (item.category === 'reply') next.replies = change(next.replies)
    if (item.category === 'like') next.likes = change(next.likes)
    if (item.category === 'wall') next.wall = change(next.wall)
    if (item.category === 'friend') next.friendRequests = change(next.friendRequests)
    if (item.category === 'messages') {
      next.messages = change(next.messages)
      next.directMessages = change(next.directMessages)
    }
    if (item.category === 'feedback') {
      next.feedback = change(next.feedback)
      next.feedbackReplies = change(next.feedbackReplies)
    }
  }
  return next
}

function decrementUnreadSummary(base: UnreadSummary, items: UnifiedNotification[]): UnreadSummary {
  return mergeUnreadSummary(base, items, -1)
}

function incrementUnreadSummary(base: UnreadSummary, items: UnifiedNotification[]): UnreadSummary {
  return mergeUnreadSummary(base, items, 1)
}

export function NotificationsClient({
  initialNotifications,
  initialPagination,
  initialCategory = 'all',
  siteLogoUrl,
  initialLoadError = null,
  initialLoadWarning = null,
}: {
  initialNotifications: UnifiedNotification[]
  initialPagination: NotificationPagination
  initialCategory?: NotificationCategory
  siteLogoUrl?: string | null
  initialLoadError?: string | null
  initialLoadWarning?: string | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const searchParamsStringRef = useRef(searchParamsString)
  searchParamsStringRef.current = searchParamsString
  const { summary: sharedSummary, refresh: refreshUnreadSummary } = useNotificationSummary()
  const [notifications, setNotifications] = useState(initialNotifications)
  const [pagination, setPagination] = useState(initialPagination)
  const [summaryOverride, setSummaryOverride] = useState<UnreadSummary | null>(null)
  const unreadSummary = summaryOverride || sharedSummary
  const unreadCount = unreadSummary.total
  const [activeCategory, setActiveCategory] = useState<NotificationCategory>(initialCategory)
  const [isUpdating, setIsUpdating] = useState(false)
  const [replyingKey, setReplyingKey] = useState<string | null>(null)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [replyStatus, setReplyStatus] = useState<Record<string, string>>({})
  const [sendingReply, setSendingReply] = useState<string | null>(null)
  const optimisticReadRef = useRef<Map<string, Date>>(new Map())
  const notificationListRequestRef = useRef<{ key: string; promise: Promise<void>; controller: AbortController } | null>(null)
  const notificationListRequestSequenceRef = useRef(0)
  // 进行中的已读请求（按 source:id 去重），避免同一条通知连点导致重复请求 / 未读数重复扣减。
  const markingReadRef = useRef<Set<string>>(new Set())
  // 清除二次确认：第一次点击只打开确认框，确认后才真正调用删除接口。
  const [clearConfirm, setClearConfirm] = useState<{ title: string; description: string; items: UnifiedNotification[]; all?: boolean } | null>(null)
  const [isClearing, setIsClearing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [allReadError, setAllReadError] = useState('')
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false)
  const [loadError, setLoadError] = useState(initialLoadError || '')
  const [loadWarning, setLoadWarning] = useState(initialLoadWarning || '')

  const mergeServerNotifications = useCallback((serverNotifications: UnifiedNotification[], nextPagination?: NotificationPagination) => {
    const merged = filterDismissedSystemNotifications(serverNotifications).map((item) => {
      const key = notificationKey(item)
      if (isNotificationRead(item)) {
        optimisticReadRef.current.delete(key)
        return item
      }
      const optimisticReadAt = optimisticReadRef.current.get(key)
      return optimisticReadAt
        ? { ...item, isRead: true, read: true, readAt: optimisticReadAt }
        : item
    })
    setNotifications(merged)
    if (nextPagination) setPagination(nextPagination)
  }, [])

  const currentPage = Math.max(1, Number.parseInt(new URLSearchParams(searchParamsString).get('page') || '1', 10) || 1)
  const buildNotificationHref = useCallback((page: number, category = activeCategory) => {
    const next = new URLSearchParams(searchParamsStringRef.current)
    if (page <= 1) next.delete('page')
    else next.set('page', String(page))
    if (category === 'all') next.delete('category')
    else next.set('category', category)
    const query = next.toString()
    return `/notifications${query ? `?${query}` : ''}`
  }, [activeCategory])

  const refreshNotifications = useCallback(() => {
    const requestKey = `${currentPage}:${activeCategory}`
    if (notificationListRequestRef.current?.key === requestKey) return notificationListRequestRef.current.promise
    notificationListRequestRef.current?.controller.abort()
    const requestSequence = ++notificationListRequestSequenceRef.current
    const controller = new AbortController()
    const request = (async () => {
      try {
        const params = new URLSearchParams({ page: String(currentPage), pageSize: String(NOTIFICATION_LIST_PAGE_SIZE) })
        if (activeCategory !== 'all') params.set('category', activeCategory)
        const response = await fetch(`/api/notifications?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await response.json().catch(() => null) as {
          notifications?: UnifiedNotification[]
          page?: number
          pageSize?: number
          total?: number
          totalPages?: number
          message?: string
          degraded?: boolean
          failed?: boolean
        } | null
        if (requestSequence !== notificationListRequestSequenceRef.current) return
        if (!response.ok) {
          setLoadError(data?.message || '通知加载失败，请重试')
          setLoadWarning('')
          return
        }
        if (Array.isArray(data?.notifications)) {
          setLoadError(data.failed ? '通知加载失败，请重试' : '')
          setLoadWarning(data.degraded && !data.failed ? '部分通知暂时无法加载，请点击重试' : '')
          const nextPagination = typeof data.page === 'number' && typeof data.pageSize === 'number' && typeof data.total === 'number' && typeof data.totalPages === 'number'
            ? { page: data.page, pageSize: data.pageSize, total: data.total, totalPages: data.totalPages }
            : undefined
          mergeServerNotifications(data.notifications, nextPagination)
          if (nextPagination && nextPagination.page !== currentPage) {
            router.replace(buildNotificationHref(nextPagination.page), { scroll: false })
          }
        }
      } catch {
        if (controller.signal.aborted) return
        if (requestSequence === notificationListRequestSequenceRef.current) {
          setLoadError('通知加载失败，请重试')
          setLoadWarning('')
        }
      }
    })()
    notificationListRequestRef.current = { key: requestKey, promise: request, controller }
    void request.finally(() => {
      if (notificationListRequestRef.current?.promise === request) notificationListRequestRef.current = null
    })
    return request
  }, [activeCategory, buildNotificationHref, currentPage, mergeServerNotifications, router])

  useEffect(() => {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(OPTIMISTIC_READ_STORAGE_KEY) || '{}') as Record<string, string>
      Object.entries(stored).forEach(([key, value]) => {
        const readAt = new Date(value)
        if (!Number.isNaN(readAt.getTime())) optimisticReadRef.current.set(key, readAt)
      })
      window.sessionStorage.removeItem(OPTIMISTIC_READ_STORAGE_KEY)
    } catch {
      // Ignore malformed return state.
    }
    mergeServerNotifications(initialNotifications, initialPagination)
    setLoadError(initialLoadError || '')
    setLoadWarning(initialLoadWarning || '')
  }, [initialLoadError, initialLoadWarning, initialNotifications, initialPagination, mergeServerNotifications])

  useEffect(() => {
    let initialPageShow = true
    const sync = (event?: Event) => {
      if (event?.type === 'pageshow' && initialPageShow) {
        // The server component already supplied the first page. A pageshow
        // event is still useful for bfcache restores, but must not duplicate
        // the first navigation request.
        initialPageShow = false
        return
      }
      if (document.visibilityState === 'visible') void refreshNotifications()
    }
    const onRealtimeEvent = (event: Event) => {
      const detail = (event as CustomEvent<Parameters<typeof shouldRefreshNotificationList>[0]>).detail
      if (detail && shouldRefreshNotificationList(detail)) sync()
    }
    window.addEventListener('pageshow', sync)
    window.addEventListener('realtime:event', onRealtimeEvent)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('pageshow', sync)
      window.removeEventListener('realtime:event', onRealtimeEvent)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [refreshNotifications])

  useEffect(() => () => {
    notificationListRequestRef.current?.controller.abort()
  }, [])

  useEffect(() => {
    setSummaryOverride(null)
  }, [sharedSummary])

  useEffect(() => {
    const saved = window.sessionStorage.getItem('notifications:return-state')
    if (!saved) return
    window.sessionStorage.removeItem('notifications:return-state')
    try {
      const state = JSON.parse(saved) as { category?: NotificationCategory; scrollY?: number }
      if (state.category && state.category in categoryLabels) setActiveCategory(state.category)
      window.requestAnimationFrame(() => window.scrollTo({ top: Number(state.scrollY) || 0, behavior: 'auto' }))
    } catch {
      // Ignore stale navigation state.
    }
  }, [])

  useEffect(() => {
    const dismissed = readDismissedSystemIds()
    if (!dismissed.size) return
    const hiddenUnread = notifications.filter((item) => item.source === 'system' && dismissed.has(item.id) && !isNotificationRead(item))
    setNotifications((current) => current.filter((item) => item.source !== 'system' || !dismissed.has(item.id)))
    if (!hiddenUnread.length) return
    setSummaryOverride((current) => ({
      ...(current || sharedSummary),
      notifications: Math.max(0, (current || sharedSummary).notifications - hiddenUnread.length),
      system: Math.max(0, (current || sharedSummary).system - hiddenUnread.length),
      total: Math.max(0, (current || sharedSummary).total - hiddenUnread.length),
    }))
    void fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: hiddenUnread.map((item) => ({ id: item.id, source: 'system' })) }),
    }).then((response) => {
      if (response.ok) window.dispatchEvent(new Event('unread-summary:refresh'))
    })
    // The initial server list is the only input needed to reconcile legacy local dismissals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categoryCounts = useMemo(() => {
    return {
      all: unreadSummary.total,
      reply: unreadSummary.replies,
      like: unreadSummary.likes,
      friend: unreadSummary.friendRequests,
      messages: unreadSummary.messages,
      feedback: unreadSummary.feedback,
      system: unreadSummary.system,
      wall: unreadSummary.wall,
    } satisfies Record<NotificationCategory, number>
  }, [unreadSummary])

  const filteredNotifications = useMemo(() => {
    if (activeCategory === 'all') return notifications
    return notifications.filter((item) => item.category === activeCategory)
  }, [activeCategory, notifications])

  useEffect(() => {
    const nextCategory = parseNotificationCategory(new URLSearchParams(searchParamsString).get('category'))
    setActiveCategory((current) => current === nextCategory ? current : nextCategory)
  }, [searchParamsString])

  function goToPage(nextPage: number) {
    const safePage = Math.min(Math.max(1, Math.trunc(nextPage) || 1), Math.max(1, pagination.totalPages))
    router.push(buildNotificationHref(safePage), { scroll: true })
  }

  function selectCategory(category: NotificationCategory) {
    setActiveCategory(category)
    router.push(buildNotificationHref(1, category), { scroll: true })
  }

  async function markRead(item: UnifiedNotification): Promise<boolean> {
    if (isNotificationRead(item)) return true

    const matchesItem = (row: UnifiedNotification) => row.id === item.id && row.source === item.source
    const itemKey = notificationKey(item)
    // 同一条通知已读请求进行中时不重复发起（连点 / 双击只算一次）。
    if (markingReadRef.current.has(itemKey)) return true
    markingReadRef.current.add(itemKey)
    const optimisticReadAt = new Date()
    optimisticReadRef.current.set(itemKey, optimisticReadAt)
    persistOptimisticRead(itemKey, optimisticReadAt)
    setSummaryOverride(decrementUnreadSummary(unreadSummary, [item]))
    // Update the card before waiting for the network. If the request fails,
    // the exact optimistic row is restored below.
    setNotifications((current) => current.map((row) => matchesItem(row)
      ? { ...row, isRead: true, read: true, readAt: optimisticReadAt }
      : row))
    setIsUpdating(true)

    try {
      const response = await fetch(`/api/notifications/${item.id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: item.source }),
        // Keep the write alive when a card immediately navigates away.
        keepalive: true,
      })
      const data = await response.json().catch(() => null) as NotificationReadResponse | null
      if (!response.ok || data?.ok === false) {
        optimisticReadRef.current.delete(itemKey)
        removePersistedOptimisticRead(itemKey)
        setNotifications((current) => current.map((row) => matchesItem(row) && row.readAt === optimisticReadAt
          ? { ...row, isRead: item.isRead, read: item.read, readAt: item.readAt }
          : row))
        setSummaryOverride((current) => incrementUnreadSummary(current || sharedSummary, [item]))
        return false
      }

      const persistedReadAt = data?.readAt === null
        ? null
        : data?.readAt
          ? new Date(data.readAt)
          : optimisticReadAt
      const safeReadAt = persistedReadAt && Number.isNaN(persistedReadAt.getTime()) ? optimisticReadAt : persistedReadAt
      setNotifications((current) => current.map((row) => matchesItem(row)
        ? { ...row, isRead: true, read: true, readAt: safeReadAt }
        : row))
      // The list and badge are already updated locally. Refresh only the
      // shared summary; do not reload the list or trigger a router refresh.
      await refreshUnreadSummary()
      return true
    } catch (reason) {
      optimisticReadRef.current.delete(itemKey)
      removePersistedOptimisticRead(itemKey)
      setNotifications((current) => current.map((row) => matchesItem(row) && row.readAt === optimisticReadAt
        ? { ...row, isRead: item.isRead, read: item.read, readAt: item.readAt }
        : row))
      setSummaryOverride((current) => incrementUnreadSummary(current || sharedSummary, [item]))
      if (process.env.NODE_ENV === 'development') console.error('[notification:mark-read]', reason)
      return false
    } finally {
      markingReadRef.current.delete(itemKey)
      setIsUpdating(false)
    }
  }

  // 进入通知目标页：标记已读 + 记录返回状态 + 跳转。返回 false 表示该通知无跳转目标（仅标记已读）。
  async function navigateToNotification(item: UnifiedNotification): Promise<boolean> {
    const target = getNotificationTarget(item)
    await markRead(item)
    if (!target) return false
    window.sessionStorage.setItem('notifications:return-state', JSON.stringify({
      category: activeCategory,
      scrollY: window.scrollY,
    }))
    router.push(target)
    return true
  }

  async function openNotification(event: MouseEvent<HTMLAnchorElement>, item: UnifiedNotification) {
    event.preventDefault()
    await navigateToNotification(item)
  }

  async function sendDirectReply(item: UnifiedNotification, payload: NotificationReplyPayload) {
    const key = `${item.source}:${item.id}`
    const target = item.replyTarget
    const content = payload.content.trim()
    const hasRichContent = Boolean(content || payload.imageUrls.length || payload.stickerId)
    if (!target || !hasRichContent || sendingReply) return

    const request = target.kind === 'post'
      ? {
          url: `/api/posts/${target.resourceId}/replies`,
          body: {
            content: payload.content,
            parentId: target.parentId,
            imageUrls: payload.imageUrls,
            mentions: payload.mentions,
            stickerId: payload.stickerId,
          },
        }
      : target.kind === 'daily-message'
        ? { url: `/api/daily-messages/${target.resourceId}/comments`, body: { content, parentId: target.parentId } }
        : target.kind === 'feedback'
          ? { url: `/api/feedback/${target.resourceId}/replies`, body: { content, attachments: [] } }
          : { url: '/api/profile-wall', body: { receiverUid: Number(target.resourceId), content, parentId: target.parentId } }

    setSendingReply(key)
    setReplyStatus((current) => ({ ...current, [key]: '' }))
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      const data = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) throw new Error(data.message || '回复失败，请稍后重试')
      await markRead(item)
      setReplyDrafts((current) => ({ ...current, [key]: '' }))
      setReplyingKey(null)
      setReplyStatus((current) => ({ ...current, [key]: '回复成功' }))
    } catch (error) {
      setReplyStatus((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : '回复失败，请稍后重试',
      }))
    } finally {
      setSendingReply(null)
    }
  }

  async function markAllRead() {
    // 防止连续点击产生多个请求（与单条已读、清除互不干扰）。
    if (isMarkingAllRead) return
    const previousSummary = unreadSummary
    const previousNotifications = notifications
    const optimisticReadAt = new Date()
    const optimisticItems = notifications.filter((item) => !isNotificationRead(item))
    const zeroSummary: UnreadSummary = {
      notifications: 0,
      system: 0,
      replies: 0,
      likes: 0,
      wall: 0,
      feedbackReplies: 0,
      feedback: 0,
      friendRequests: 0,
      directMessages: 0,
      messages: 0,
      total: 0,
    }
    optimisticItems.forEach((item) => {
      const key = notificationKey(item)
      optimisticReadRef.current.set(key, optimisticReadAt)
      persistOptimisticRead(key, optimisticReadAt)
    })
    // 乐观更新：先让列表与未读角标立即归零，不等服务端返回。
    setNotifications((current) => current.map((row) => ({
      ...row,
      isRead: true,
      read: true,
      readAt: row.readAt || optimisticReadAt,
    })))
    setSummaryOverride(zeroSummary)
    setIsMarkingAllRead(true)
    setAllReadError('')
    try {
      // keepalive：即使用户立刻切走页面 / 关闭标签页，请求仍会被发出并完成，
      // 避免"点了没反应、回来还是未读"的问题。
      const response = await fetch('/api/notifications/read-all', {
        method: 'POST',
        keepalive: true,
      })
      if (!response.ok) {
        optimisticItems.forEach((item) => {
          const key = notificationKey(item)
          optimisticReadRef.current.delete(key)
          removePersistedOptimisticRead(key)
        })
        setNotifications(previousNotifications)
        setSummaryOverride(previousSummary)
        setAllReadError('操作失败，请重试')
        return
      }
      await refreshUnreadSummary()
      setSummaryOverride(null)
    } catch {
      optimisticItems.forEach((item) => {
        const key = notificationKey(item)
        optimisticReadRef.current.delete(key)
        removePersistedOptimisticRead(key)
      })
      setNotifications(previousNotifications)
      setSummaryOverride(previousSummary)
      setAllReadError('操作失败，请重试')
    } finally {
      setIsMarkingAllRead(false)
    }
  }

  // 只负责真正的删除请求与本地状态更新；调用前必须经过 clearConfirm 二次确认。
  // 返回是否成功——失败时保留原列表与原未读数，并显示错误。
  async function clearNotifications(items: UnifiedNotification[], clearAll = false): Promise<boolean> {
    // A list request started before the delete must not be allowed to put its
    // stale response back into the client after the delete succeeds.
    notificationListRequestRef.current?.controller.abort()
    notificationListRequestRef.current = null
    notificationListRequestSequenceRef.current += 1

    if (clearAll) {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!response.ok) return false
      const data = await response.json().catch(() => null) as { systemIds?: unknown } | null
      const systemIds = Array.isArray(data?.systemIds)
        ? data.systemIds.filter((id): id is string => typeof id === 'string')
        : []
      rememberDismissedSystemIds(systemIds)
      setNotifications([])
      setPagination((current) => ({ ...current, page: 1, total: 0, totalPages: 1 }))
      const currentSummary = summaryOverride || sharedSummary
      setSummaryOverride({
        ...currentSummary,
        notifications: 0,
        system: 0,
        replies: 0,
        likes: 0,
        wall: 0,
        feedbackReplies: 0,
        feedback: 0,
        friendRequests: 0,
        total: currentSummary.directMessages,
      })
      if (currentPage !== 1) router.replace(buildNotificationHref(1), { scroll: false })
      await refreshUnreadSummary()
      return true
    }

    const personalIds = items.filter((item) => item.source === 'personal').map((item) => item.id)
    if (personalIds.length) {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: personalIds }),
      })
      if (!response.ok) return false
    }
    const systemIds = items.filter((item) => item.source === 'system').map((item) => item.id)
    if (systemIds.length) {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: systemIds.map((id) => ({ id, source: 'system' })) }),
      })
      if (!response.ok) return false
      rememberDismissedSystemIds(systemIds)
    }
    const keys = new Set(items.map((item) => `${item.source}:${item.id}`))
    setNotifications((current) => current.filter((item) => !keys.has(`${item.source}:${item.id}`)))
    // 删除未读通知时未读数同步减少（删除已读通知不影响），随后由服务端汇总校正。
    setSummaryOverride((current) => decrementUnreadSummary(current || sharedSummary, items))
    await refreshUnreadSummary()
    return true
  }

  async function confirmClearNotifications() {
    if (!clearConfirm || isClearing) return
    setIsClearing(true)
    setActionError('')
    try {
      const ok = await clearNotifications(clearConfirm.items, clearConfirm.all === true)
      if (ok) {
        setClearConfirm(null)
      } else {
        setActionError('清除失败，请稍后重试')
      }
    } catch {
      setActionError('清除失败，请稍后重试')
    } finally {
      setIsClearing(false)
    }
  }

  function renderNotification(item: UnifiedNotification) {
    const itemKey = `${item.source}:${item.id}`
    const category = (item.category || 'system') as NotificationCategory
    const target = getNotificationTarget(item)
    const systemLike = isSystemLikeNotification(item)
    const isBirthday = isBirthdayNotification(item)
    const isUserReward = item.type === 'USER_REWARD'
    const isReplyNotification = item.type === 'REPLY' || item.category === 'feedback'
    const replyPreview = item.replyPreview?.trim() || null
    const fallbackContent = item.content?.trim() || null
    const displayReplyPreview = replyPreview || fallbackContent
    const canDirectReply = isReplyNotification && Boolean(item.replyTarget && !item.replyDisabledReason)
    const smartEntry = getSmartEntry(item)
    // 生日通知轻微视觉强调：浅色背景 + 左侧主题色边框（保持扁平简洁 Windows 风格）
    const emphasisClass = isBirthday && !isNotificationRead(item) ? 'border-l-4 border-l-sky-400 bg-sky-50/70' : ''
    const titleClass = isNotificationRead(item) ? 'font-bold text-slate-700' : 'font-black text-slate-950'
    // 生日通知分类文字显示为「今日」（仅前端展示，不动数据库枚举）
    const displayLabel = isBirthday ? '今日' : item.typeLabel
    const hasDisplayLabel = Boolean(displayLabel?.trim())

    // 整卡可点击跳转；无跳转目标时仅标记已读。键盘可达。
    function handleCardActivate() {
      if (target) void navigateToNotification(item)
      else void markRead(item)
    }

    return (
      <div key={itemKey} id={`notification-${item.id}`} className="relative scroll-mt-20">
        <article
          role={target ? 'link' : 'button'}
          tabIndex={0}
          onClick={handleCardActivate}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleCardActivate()
            }
          }}
          className={`notification-list-item group flex min-w-0 gap-2 rounded-sm border p-2.5 transition sm:gap-2.5 sm:p-3 ${
            isNotificationRead(item) ? 'is-read' : 'is-unread'
          } ${emphasisClass} ${target ? 'cursor-pointer' : ''}`}
        >
          {/* 头像区 */}
          <div className="relative shrink-0">
            {systemLike ? (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200 sm:h-9 sm:w-9">
                {siteLogoUrl ? (
                  <img src={publicImageVariantUrl(siteLogoUrl, 'thumb-sm') || siteLogoUrl} alt="私家E院" className="h-full w-full object-contain" />
                ) : (
                  <span className="ecfc-brand-icon" aria-hidden>Ｅ</span>
                )}
              </span>
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-950 text-xs font-black text-white sm:h-9 sm:w-9">
                {profileImageUrl(item.actorAvatarUrl) ? <img src={publicImageVariantUrl(item.actorAvatarUrl, 'avatar-md') || profileImageUrl(item.actorAvatarUrl)!} alt={item.actorName || item.title} className="h-full w-full object-cover" loading="lazy" /> : getInitial(item.actorUid)}
              </span>
            )}
            {!systemLike && !isBirthday ? (
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-sky-100 text-[10px] font-black text-brand-700">
                {typeIcon[category] || 'i'}
              </span>
            ) : null}
            {isUserReward ? <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-emerald-100 text-[10px] font-black text-emerald-700">＋</span> : null}
          </div>

          {/* 内容区：标题 + 正文 + 智能入口 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-1.5">
              {hasDisplayLabel ? <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-brand-700 ring-1 ring-sky-100">{displayLabel}</span> : null}
              {!isNotificationRead(item) ? <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-black text-white">未读</span> : null}
            </div>
            <h2 className={`notification-title mt-0.5 break-words text-sm sm:text-base ${titleClass}`}>{item.title}</h2>
            {isReplyNotification && displayReplyPreview ? (
              <p className="notification-reply-preview mt-0.5 break-words text-xs font-bold leading-4 text-slate-600">
                {replyPreview && item.actorName ? <span className="font-black text-slate-700">{item.actorName}：</span> : null}
                {displayReplyPreview}
              </p>
            ) : !isReplyNotification && fallbackContent ? (
              <p className={`mt-0.5 whitespace-pre-wrap break-words text-xs font-bold leading-4 text-slate-600 ${isUserReward ? '' : 'line-clamp-2'}`}>{fallbackContent}</p>
            ) : null}

            {/* 智能入口：不同通知提供不同快捷入口（账号安全→去设置、资料→编辑资料、审核→查看帖子、互动→查看互动） */}
            {smartEntry?.action === 'dock' ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  void markRead(item)
                  window.dispatchEvent(new Event('friend-dock:open'))
                }}
                className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 ring-1 ring-sky-100 hover:bg-sky-100"
              >
                {smartEntry.label} →
              </button>
            ) : smartEntry?.href ? (
              <Link
                href={smartEntry.href}
                onClick={(event) => {
                  event.stopPropagation()
                  openNotification(event, item)
                }}
                className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm bg-sky-50 px-2.5 py-1 text-[11px] font-black text-brand-700 ring-1 ring-sky-100 hover:bg-sky-100"
              >
                {smartEntry.label} →
              </Link>
            ) : null}

            {/* 时间区（固定内容区底部）+ 操作按钮（流式排布，移动端自动换行，无横向滚动） */}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5 pt-1">
              <time className="text-[11px] font-bold text-slate-400">{formatTime(item.createdAt)}</time>
              <div className="flex flex-wrap items-center gap-1">
                {canDirectReply ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setReplyingKey((current) => current === itemKey ? null : itemKey)
                    }}
                    className="min-h-8 rounded-sm border border-sky-100 bg-white px-2.5 py-1 text-[11px] font-black text-brand-700"
                  >
                    直接回复
                  </button>
                ) : null}
                {!isNotificationRead(item) ? (
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void markRead(item)
                    }}
                    className="min-h-8 rounded-sm border border-sky-100 bg-white px-2.5 py-1 text-[11px] font-black text-brand-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    已读
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="清除这条通知"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setActionError('')
                    setClearConfirm({
                      title: '确认清除这条通知？',
                      description: '清除后，这条通知将从通知中心移除，此操作无法撤销。',
                      items: [item],
                    })
                  }}
                  className="min-h-8 rounded-sm border border-sky-100 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 hover:text-red-600"
                >
                  清除
                </button>
              </div>
            </div>
          </div>
        </article>

        {item.replyDisabledReason ? <p className="mt-2 rounded-sm border border-sky-100 bg-white px-4 py-3 text-sm font-black text-slate-500">{item.replyDisabledReason}</p> : null}
        {replyingKey === itemKey && item.replyTarget && canDirectReply ? (
          <NotificationReplyComposer
            actorName={item.actorName}
            initialContent={replyDrafts[itemKey] || ''}
            maxLength={item.replyTarget.kind === 'daily-message' ? 300 : item.replyTarget.kind === 'profile-wall' ? 500 : 5000}
            rich={item.replyTarget.kind === 'post'}
            submitting={sendingReply === itemKey}
            disabled={sendingReply === itemKey}
            onDraftChange={(content) => setReplyDrafts((current) => ({ ...current, [itemKey]: content }))}
            onCancel={() => setReplyingKey(null)}
            onSubmit={(payload) => sendDirectReply(item, payload)}
          />
        ) : null}
        {replyStatus[itemKey] ? <p className={`mt-2 px-1 py-2 text-sm font-black ${replyStatus[itemKey] === '回复成功' ? 'text-emerald-600' : 'text-red-600'}`}>{replyStatus[itemKey]}</p> : null}
      </div>
    )
  }

  return (
    <section className="notification-center space-y-3">
      <div className="rounded-[28px] border border-sky-100 bg-white/78 p-5 shadow-sm shadow-sky-900/5 backdrop-blur-xl sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.2em] text-brand-700">通知中心</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">通知中心</h1>
            <p className="mt-3 text-sm font-bold text-slate-500">未读通知 <span className="text-brand-700">{unreadCount}</span> 条</p>
          </div>
          <div className="flex flex-wrap gap-2"><button
            type="button"
            onClick={markAllRead}
            disabled={isMarkingAllRead || unreadCount === 0}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isMarkingAllRead ? '处理中…' : unreadCount === 0 ? '已全部读' : '全部已读'}
          </button><button
            type="button"
            onClick={() => {
              setActionError('')
              setAllReadError('')
              setClearConfirm({
                title: '确认清除全部通知？',
                description: '全部通知将从通知中心移除，此操作无法撤销。',
                items: notifications,
                all: true,
              })
            }}
            disabled={isUpdating || isMarkingAllRead || pagination.total === 0}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-sky-100 bg-white px-5 text-sm font-black text-slate-600 disabled:opacity-50"
          >
            清除通知
          </button></div>
        </div>
        {actionError ? <p className="mt-3 rounded-sm border border-red-100 bg-red-50 px-3 py-2 text-sm font-black text-red-600">{actionError}</p> : null}
        {allReadError ? <p className="mt-3 rounded-sm border border-red-100 bg-red-50 px-3 py-2 text-sm font-black text-red-600">{allReadError}</p> : null}
        {loadError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800" role="alert">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => void refreshNotifications()}
              className="min-h-9 rounded-lg bg-amber-800 px-3 text-xs font-black text-white"
            >
              重新加载
            </button>
          </div>
        ) : null}
        {loadWarning ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800" role="status">
            <span>{loadWarning}</span>
            <button
              type="button"
              onClick={() => void refreshNotifications()}
              className="min-h-9 rounded-lg bg-amber-800 px-3 text-xs font-black text-white"
            >
              重新加载
            </button>
          </div>
        ) : null}
      </div>

      <div className="flat-tabs flex overflow-x-auto border-b border-sky-100">
        {(Object.keys(categoryLabels) as NotificationCategory[]).map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => selectCategory(category)}
            className={`rounded-none border-b-2 px-4 py-2 text-sm font-black transition ${
              activeCategory === category
                ? 'border-brand-700 text-brand-700'
                : 'border-transparent text-slate-500 hover:bg-sky-50'
            }`}
          >
            {categoryLabels[category]} {categoryCounts[category]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {loadError || (loadWarning && notifications.length === 0) ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-8 text-center" role="alert">
            <p className="text-lg font-black text-amber-900">通知加载失败，请重试</p>
            <p className="mt-2 text-sm font-bold text-amber-800">通知数据暂时不可用，现有通知不会被删除。</p>
          </div>
        ) : activeCategory === 'messages' ? (
          <div className="rounded-[24px] border border-sky-100 bg-white/82 p-8 text-center">
            <p className="text-lg font-black text-brand-950">未读私信 {unreadSummary.messages} 条</p>
            <p className="mt-2 text-sm font-bold text-slate-500">私信不会复制成普通通知，点击后在好友窗口查看会话。</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('friend-dock:open'))}
              className="mt-4 min-h-11 rounded-xl bg-brand-950 px-5 text-sm font-black text-white"
            >
              打开好友与私信
            </button>
          </div>
        ) : filteredNotifications.length ? (
          filteredNotifications.map(renderNotification)
        ) : (
          <div className="rounded-[24px] border border-sky-100 bg-white/82 p-10 text-center">
            <p className="text-lg font-black text-brand-950">暂无通知</p>
            <p className="mt-2 text-sm font-bold text-slate-500">新的回复、点赞、好友和系统消息会出现在这里。</p>
          </div>
        )}
      </div>

      {activeCategory !== 'messages' && pagination.totalPages > 1 ? (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={goToPage}
          disabled={isUpdating}
          ariaLabel="通知分页"
        />
      ) : null}

      <div className="sr-only" aria-live="polite">未读通知 {unreadCount}</div>
      <ConfirmDialog
        open={Boolean(clearConfirm)}
        title={clearConfirm?.title || ''}
        description={clearConfirm?.description}
        confirmLabel={clearConfirm?.all || (clearConfirm && clearConfirm.items.length > 1) ? '确认全部清除' : '确认清除'}
        loading={isClearing}
        onConfirm={() => void confirmClearNotifications()}
        onCancel={() => {
          if (!isClearing) setClearConfirm(null)
        }}
      />
    </section>
  )
}
