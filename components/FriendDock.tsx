'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { StickerPicker, type PickerSticker } from '@/components/StickerPicker'
import { FriendProfileCard } from '@/components/FriendProfileCard'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { FriendDockUser, RelationshipStatus } from '@/lib/friend-types'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { mergeUniqueFriendPage, UNGROUPED_FRIEND_GROUP_ID } from '@/lib/friend-grouping'
import type { UnreadSummary } from '@/lib/notifications'
import { formatUid } from '@/lib/uid'

type MessageStatus = 'SENDING' | 'SENT' | 'READ' | 'FAILED'
type Message = {
  id: string
  content: string
  senderId: string
  createdAt: string
  type?: string | null
  clientMessageId: string | null
  readAt: string | null
  status?: MessageStatus
  stickerId?: string | null
  stickerUrl?: string | null
}

type FriendGroup = {
  id: string
  name: string
  sortOrder: number
  count: number
}

type FriendGroupPagination = {
  page: number
  total: number
  hasMore: boolean
}

const emptySummary: UnreadSummary = {
  notifications: 0,
  system: 0,
  replies: 0,
  likes: 0,
  feedbackReplies: 0,
  feedback: 0,
  friendRequests: 0,
  directMessages: 0,
  messages: 0,
  total: 0,
}

function createMessageId() {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return globalThis.crypto.randomUUID()
    } catch (error) {
      console.error('[friend-dock.message-id.randomUUID]', error)
    }
  }

  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function FriendDock({
  currentUserId,
  unreadSummary = emptySummary,
}: {
  currentUserId: string
  unreadSummary?: UnreadSummary
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [friends, setFriends] = useState<FriendDockUser[]>([])
  const [searchResults, setSearchResults] = useState<FriendDockUser[]>([])
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([])
  const [groupFriends, setGroupFriends] = useState<Record<string, FriendDockUser[]>>({})
  const [groupPagination, setGroupPagination] = useState<Record<string, FriendGroupPagination>>({})
  const [loadingGroupIds, setLoadingGroupIds] = useState<Set<string>>(new Set())
  const [friendListReady, setFriendListReady] = useState(false)
  const [ungroupedCount, setUngroupedCount] = useState(0)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [friendTotal, setFriendTotal] = useState(0)
  const [loadingList, setLoadingList] = useState(false)
  const [profileFriend, setProfileFriend] = useState<FriendDockUser | null>(null)
  const [conversationId, setConversationId] = useState('')
  const [chatFriend, setChatFriend] = useState<FriendDockUser | null>(null)
  const [chatActionsOpen, setChatActionsOpen] = useState(false)
  const [clearingChat, setClearingChat] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [pendingSticker, setPendingSticker] = useState<PickerSticker | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [newMessageNotice, setNewMessageNotice] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [viewport, setViewport] = useState({ height: 0, top: 0 })
  const [isMobileDrawer, setIsMobileDrawer] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const cursorRef = useRef('')
  const beforeCursorRef = useRef('')
  const nearBottomRef = useRef(true)
  const backdropCloseTimerRef = useRef(0)
  const sendingMessageIdsRef = useRef(new Set<string>())
  const chatSessionRef = useRef(0)
  const friendListRequestRef = useRef(0)
  const friendsRef = useRef<FriendDockUser[]>([])
  const friendListPageRef = useRef(1)
  const groupRequestRef = useRef(new Map<string, number>())

  // 统一表情面板选中系统 emoji 时，在当前光标处插入并恢复焦点
  const insertEmoji = useCallback((emoji: string) => {
    const input = messageInputRef.current
    const start = input?.selectionStart ?? content.length
    const end = input?.selectionEnd ?? content.length
    const next = `${content.slice(0, start)}${emoji}${content.slice(end)}`.slice(0, 1000)
    const cursor = Math.min(start + emoji.length, next.length)
    setContent(next)
    window.requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(cursor, cursor)
    })
  }, [content])

  const resetChat = useCallback(() => {
    chatSessionRef.current += 1
    sendingMessageIdsRef.current.clear()
    setChatFriend(null)
    setChatActionsOpen(false)
    setConversationId('')
    setMessages([])
    setContent('')
    setPendingSticker(null)
    setPickerOpen(false)
    setSending(false)
    setClearingChat(false)
    setError('')
    cursorRef.current = ''
    beforeCursorRef.current = ''
    nearBottomRef.current = true
    setNewMessageNotice(false)
    setHasOlderMessages(false)
    setLoadingOlder(false)
  }, [])

  const closeDock = useCallback(() => {
    window.clearTimeout(backdropCloseTimerRef.current)
    setOpen(false)
    setProfileFriend(null)
    resetChat()
    window.requestAnimationFrame(() => toggleRef.current?.focus())
  }, [resetChat])

  const openFriendList = useCallback(() => {
    resetChat()
    setProfileFriend(null)
    setCollapsed(false)
    setFriendListReady(false)
    groupRequestRef.current.forEach((requestId, groupId) => groupRequestRef.current.set(groupId, requestId + 1))
    setLoadingGroupIds(new Set())
    setGroupFriends({})
    setGroupPagination({})
    setOpen(true)
  }, [resetChat])

  const notifyClients = useCallback((type: 'friends' | 'messages' | 'unread') => {
    window.dispatchEvent(new Event('unread-summary:refresh'))
    if (type !== 'unread') {
      window.dispatchEvent(new CustomEvent('friend-dock:refresh', { detail: { type } }))
    }
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(`eason-private-sync:${currentUserId}`)
      channel.postMessage({ type, userId: currentUserId })
      channel.close()
    }
  }, [currentUserId])

  const loadGroupFriends = useCallback(async (groupId: string, nextPage = 1, append = false) => {
    const requestId = (groupRequestRef.current.get(groupId) || 0) + 1
    groupRequestRef.current.set(groupId, requestId)
    setLoadingGroupIds((current) => new Set(current).add(groupId))
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: '20',
        groupId,
      })
      const response = await fetch(`/api/friends/list?${params}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (groupRequestRef.current.get(groupId) !== requestId) return
      if (!response.ok) {
        setError(data.message || '好友分组加载失败')
        return
      }
      const incoming = Array.isArray(data.friends) ? data.friends as FriendDockUser[] : []
      if (Array.isArray(data.groups)) setFriendGroups(data.groups as FriendGroup[])
      if (Number.isSafeInteger(data.ungroupedCount) && data.ungroupedCount >= 0) setUngroupedCount(data.ungroupedCount)
      setGroupFriends((current) => ({
        ...current,
        [groupId]: mergeUniqueFriendPage(current[groupId] || [], incoming, append),
      }))
      setGroupPagination((current) => ({
        ...current,
        [groupId]: {
          page: Number.isSafeInteger(data.page) ? data.page : nextPage,
          total: Number.isSafeInteger(data.total) ? data.total : incoming.length,
          hasMore: Boolean(data.hasMore),
        },
      }))
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      if (groupRequestRef.current.get(groupId) === requestId) {
        setError(loadError instanceof Error ? loadError.message : '好友分组加载失败')
      }
    } finally {
      if (groupRequestRef.current.get(groupId) === requestId) {
        setLoadingGroupIds((current) => {
          const next = new Set(current)
          next.delete(groupId)
          return next
        })
      }
    }
  }, [])

  const invalidateAllGroupCaches = useCallback(() => {
    groupRequestRef.current.forEach((requestId, groupId) => groupRequestRef.current.set(groupId, requestId + 1))
    setLoadingGroupIds(new Set())
    setGroupFriends({})
    setGroupPagination({})
  }, [])

  const loadFriends = useCallback(async (nextPage = 1, append = false, signal?: AbortSignal, silent = false) => {
    const requestId = ++friendListRequestRef.current
    if (!silent) setLoadingList(true)
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: '30' })
      const response = await fetch(`/api/friends/list?${params}`, { signal, cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (requestId !== friendListRequestRef.current) return
      if (!response.ok) {
        setError(data.message || '好友列表加载失败')
        return
      }
      const incoming = Array.isArray(data.friends) ? data.friends as FriendDockUser[] : []
      if (Array.isArray(data.groups)) setFriendGroups(data.groups as FriendGroup[])
      if (Number.isSafeInteger(data.ungroupedCount) && data.ungroupedCount >= 0) setUngroupedCount(data.ungroupedCount)
      if (Number.isSafeInteger(data.total) && data.total >= 0) setFriendTotal(data.total)
      setFriendListReady(true)
      const preserveLoadedPages = silent && friendListPageRef.current > 1 && !append
      if (preserveLoadedPages) {
        const current = friendsRef.current
        // A full first page means that the previously loaded later pages can
        // still be retained. If the page shrank (including to an empty list),
        // replace the local list so removed friends are not kept visible.
        const sameFirstPageOrder = incoming.length === 30
          && incoming.every((item, index) => current[index]?.id === item.id)
        if (sameFirstPageOrder) {
          const incomingById = new Map(incoming.map((item) => [item.id, item]))
          const merged = current.map((item) => incomingById.get(item.id) || item)
          friendsRef.current = merged
          setFriends(merged)
          return
        }
      }
      const nextFriends = append
        ? [...friendsRef.current, ...incoming.filter((item) => !friendsRef.current.some((existing) => existing.id === item.id))]
        : incoming
      friendsRef.current = nextFriends
      setFriends(nextFriends)
      friendListPageRef.current = nextPage
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      if (requestId === friendListRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : '好友列表加载失败')
      }
    } finally {
      if (!silent && requestId === friendListRequestRef.current) setLoadingList(false)
    }
  }, [])

  async function createFriendGroup() {
    const prompted = window.prompt('请输入分组名称（最多30个字符）')
    if (prompted === null) return
    const name = prompted.trim()
    if (!name) {
      setError('分组名不能为空')
      return
    }
    const response = await fetch('/api/friend-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.group) {
      setError(data.message || '新建分组失败')
      return
    }
    setFriendGroups((current) => [...current, data.group as FriendGroup])
    notifyClients('friends')
  }

  async function renameFriendGroup(group: FriendGroup) {
    const prompted = window.prompt('请输入新的分组名称（最多30个字符）', group.name)
    if (prompted === null) return
    const name = prompted.trim()
    if (!name) {
      setError('分组名不能为空')
      return
    }
    const response = await fetch(`/api/friend-groups/${group.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.message || '重命名分组失败')
      return
    }
    setFriendGroups((current) => current.map((item) => item.id === group.id ? { ...item, name } : item))
    notifyClients('friends')
  }

  async function deleteFriendGroup(group: FriendGroup) {
    if (!window.confirm('删除该分组后，其中好友将移回未分组，是否继续？')) return
    const response = await fetch(`/api/friend-groups/${group.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.message || '删除分组失败')
      return
    }
    const update = (items: FriendDockUser[]) => items.map((item) => item.groupId === group.id ? { ...item, groupId: null } : item)
    setFriends((current) => {
      const next = update(current)
      friendsRef.current = next
      return next
    })
    setSearchResults(update)
    setFriendGroups((current) => current.filter((item) => item.id !== group.id))
    setUngroupedCount((current) => current + group.count)
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      next.delete(group.id)
      return next
    })
    notifyClients('friends')
  }

  async function moveFriendToGroup(friend: FriendDockUser, nextGroupId: string | null) {
    const previousGroupId = friend.groupId || null
    if (previousGroupId === nextGroupId) return
    const response = await fetch(`/api/friends/${friend.id}/group`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: nextGroupId }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.message || '移动好友失败')
      return
    }
    const actualGroupId = typeof data.groupId === 'string' ? data.groupId : null
    const update = (items: FriendDockUser[]) => items.map((item) => item.id === friend.id ? { ...item, groupId: actualGroupId } : item)
    setFriends((current) => {
      const next = update(current)
      friendsRef.current = next
      return next
    })
    setSearchResults(update)
    setFriendGroups((current) => current.map((group) => ({
      ...group,
      count: group.count - (previousGroupId === group.id ? 1 : 0) + (actualGroupId === group.id ? 1 : 0),
    })))
    if (!previousGroupId && actualGroupId) setUngroupedCount((current) => Math.max(0, current - 1))
    if (previousGroupId && !actualGroupId) setUngroupedCount((current) => current + 1)
    notifyClients('friends')
  }

  function toggleFriendGroup(groupId: string) {
    const opening = collapsedGroupIds.has(groupId)
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
    if (opening && groupFriends[groupId] === undefined) void loadGroupFriends(groupId)
  }

  useEffect(() => {
    friendsRef.current = friends
  }, [friends])

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(`friend-dock:collapsed:${currentUserId}`) === '1')
  }, [currentUserId])

  useEffect(() => () => window.clearTimeout(backdropCloseTimerRef.current), [])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobileDrawer(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(`friend-dock:collapsed:${currentUserId}`, collapsed ? '1' : '0')
  }, [collapsed, currentUserId])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!open || chatFriend) return
    const controller = new AbortController()
    if (!debouncedQuery) {
      setSearchResults([])
      void loadFriends(1, false, controller.signal)
    } else {
      setLoadingList(true)
      const params = new URLSearchParams({ q: debouncedQuery })
      fetch(`/api/friends/list?${params}`, { signal: controller.signal, cache: 'no-store' })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.message || '搜索失败')
          setSearchResults(Array.isArray(data.results) ? data.results : [])
          setLoadingList(false)
        })
        .catch((fetchError) => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setLoadingList(false)
          setError(fetchError instanceof Error ? fetchError.message : '搜索失败')
        })
    }
    return () => controller.abort()
  }, [open, chatFriend, debouncedQuery, loadFriends])

  useEffect(() => {
    if (!open || chatFriend || debouncedQuery || !friendListReady) return
    const scopes = [
      { id: UNGROUPED_FRIEND_GROUP_ID, count: ungroupedCount },
      ...friendGroups.map((group) => ({ id: group.id, count: group.count })),
    ]
    scopes.forEach((scope) => {
      if (collapsedGroupIds.has(scope.id) || groupFriends[scope.id] !== undefined || loadingGroupIds.has(scope.id)) return
      if (scope.count === 0) {
        setGroupFriends((current) => ({ ...current, [scope.id]: [] }))
        setGroupPagination((current) => ({ ...current, [scope.id]: { page: 1, total: 0, hasMore: false } }))
        return
      }
      void loadGroupFriends(scope.id)
    })
  }, [chatFriend, collapsedGroupIds, debouncedQuery, friendGroups, friendListReady, groupFriends, loadingGroupIds, loadGroupFriends, open, ungroupedCount])

  useEffect(() => {
    setOpen(false)
    setProfileFriend(null)
    resetChat()
  }, [pathname, currentUserId, resetChat])

  useEffect(() => {
    const openDock = () => openFriendList()
    const closeFromOtherOverlay = () => closeDock()
    const updateRemark = (event: Event) => {
      const detail = (event as CustomEvent<{ targetUserId?: string; displayName?: string }>).detail
      if (!detail?.targetUserId || typeof detail.displayName !== 'string') return
      const update = (items: FriendDockUser[]) => items.map((item) => item.id === detail.targetUserId
        ? { ...item, profile: item.profile ? { ...item.profile, displayName: detail.displayName! } : item.profile }
        : item)
      setFriends(update)
      setSearchResults(update)
      setChatFriend((current) => current && current.id === detail.targetUserId ? update([current])[0] : current)
      setProfileFriend((current) => current && current.id === detail.targetUserId ? update([current])[0] : current)
    }
    const refresh = (event?: Event) => {
      if (open && !chatFriend && !debouncedQuery) {
        const type = (event as CustomEvent<{ type?: string }> | undefined)?.detail?.type
        if (type !== 'unread') {
          invalidateAllGroupCaches()
          setFriendListReady(false)
        }
        void loadFriends(1)
      }
    }
    const refreshFromRealtime = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; changed?: string[]; source?: string }>).detail
      const changed = detail?.changed || []
      if (detail?.source === 'fallback' || detail?.type === 'notification-changed' || changed.includes('message') || changed.includes('friend-request')) refresh()
    }
    window.addEventListener('friend-dock:open', openDock)
    window.addEventListener('friend-dock:close', closeFromOtherOverlay)
    window.addEventListener('friend-remark:updated', updateRemark)
    window.addEventListener('friend-dock:refresh', refresh)
    window.addEventListener('realtime:event', refreshFromRealtime)
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel(`eason-private-sync:${currentUserId}`)
      : null
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.userId !== currentUserId) return
        if (event.data?.type === 'unread') {
          if (open && !chatFriend && !debouncedQuery) void loadFriends(1)
          return
        }
        refresh()
      }
    }
    return () => {
      channel?.close()
      window.removeEventListener('friend-dock:open', openDock)
      window.removeEventListener('friend-dock:close', closeFromOtherOverlay)
      window.removeEventListener('friend-remark:updated', updateRemark)
      window.removeEventListener('friend-dock:refresh', refresh)
      window.removeEventListener('realtime:event', refreshFromRealtime)
    }
  }, [currentUserId, open, chatFriend, debouncedQuery, invalidateAllGroupCaches, loadFriends, openFriendList, closeDock])

  useEffect(() => {
    if (!open || !isMobileDrawer) return
    let frame = 0
    const update = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const visualViewport = window.visualViewport
        setViewport({
          height: visualViewport?.height || window.innerHeight,
          top: visualViewport?.offsetTop || 0,
        })
      })
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      window.cancelAnimationFrame(frame)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open, isMobileDrawer])

  useEffect(() => {
    if (!open || !isMobileDrawer) return
    const root = document.documentElement
    const body = document.body
    const scrollY = window.scrollY
    const rootOverflow = root.style.overflow
    const bodyOverflow = body.style.overflow
    const bodyPosition = body.style.position
    const bodyTop = body.style.top
    const bodyWidth = body.style.width

    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'

    return () => {
      root.style.overflow = rootOverflow
      body.style.overflow = bodyOverflow
      body.style.position = bodyPosition
      body.style.top = bodyTop
      body.style.width = bodyWidth
      window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' })
    }
  }, [open, isMobileDrawer])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (profileFriend) {
        setProfileFriend(null)
        return
      }
      closeDock()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const mergeMessages = useCallback((incoming: Message[], peerLastReadAt?: string | null) => {
    let appendedIncoming = false
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]))
      incoming.forEach((message) => {
        const duplicate = [...byId.values()].find((item) =>
          item.id === message.id
          || Boolean(item.clientMessageId && message.clientMessageId && item.clientMessageId === message.clientMessageId))
        if (duplicate) byId.delete(duplicate.id)
        if (!duplicate && message.senderId !== currentUserId) appendedIncoming = true
        byId.set(message.id, { ...message, status: message.readAt ? 'READ' : 'SENT' })
      })
      const peerRead = peerLastReadAt ? new Date(peerLastReadAt).getTime() : 0
      return [...byId.values()]
        .map((message) => message.senderId === currentUserId && peerRead >= new Date(message.createdAt).getTime()
          ? { ...message, readAt: peerLastReadAt || message.readAt, status: 'READ' as const }
          : message)
        .sort(compareMessages)
    })
    if (appendedIncoming) {
      if (nearBottomRef.current) window.requestAnimationFrame(() => scrollToBottom('smooth'))
      else setNewMessageNotice(true)
    }
  }, [currentUserId])

  const markConversationRead = useCallback(async (id: string, messageId: string) => {
    if (!id || !messageId || document.visibilityState === 'hidden') return
    const response = await fetch(`/api/direct-conversations/${id}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
      cache: 'no-store',
    })
    if (!response.ok) return
    setFriends((current) => current.map((friend) => friend.conversationId === id ? { ...friend, unreadCount: 0 } : friend))
    setGroupFriends((current) => Object.fromEntries(
      Object.entries(current).map(([groupId, items]) => [
        groupId,
        items.map((friend) => friend.conversationId === id ? { ...friend, unreadCount: 0 } : friend),
      ]),
    ))
    notifyClients('unread')
  }, [notifyClients])

  const syncOpenConversation = useCallback(async (id: string) => {
    if (!id || document.visibilityState === 'hidden') return
    const chatSession = chatSessionRef.current
    const controller = new AbortController()
    try {
      const params = cursorRef.current ? `?after=${encodeURIComponent(cursorRef.current)}` : ''
      const response = await fetch(`/api/direct-conversations/${id}/messages${params}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) return
      const data = await response.json()
      if (chatSession !== chatSessionRef.current) return
      mergeMessages(Array.isArray(data.messages) ? data.messages : [], data.peerLastReadAt)
      if (data.cursor) cursorRef.current = data.cursor
      if (Array.isArray(data.messages) && data.messages.some((message: Message) => message.senderId !== currentUserId)) {
        const lastVisibleMessage = data.messages[data.messages.length - 1] as Message | undefined
        if (lastVisibleMessage) await markConversationRead(id, lastVisibleMessage.id)
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.warn('[friend-dock.realtime-sync]', error)
    } finally {
      controller.abort()
    }
  }, [currentUserId, markConversationRead, mergeMessages])

  useEffect(() => {
    if (!open || !conversationId) return
    const onRealtimeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; changed?: string[]; conversationIds?: string[]; source?: string }>).detail
      const changed = detail?.changed || []
      const matchesConversation = !detail?.conversationIds?.length || detail.conversationIds.includes(conversationId)
      if (matchesConversation && (detail?.source === 'fallback' || detail?.type === 'notification-changed' || changed.includes('message'))) void syncOpenConversation(conversationId)
    }
    window.addEventListener('realtime:event', onRealtimeEvent)
    return () => {
      window.removeEventListener('realtime:event', onRealtimeEvent)
    }
  }, [conversationId, open, syncOpenConversation])

  function consumeBackdropEvent(event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  function handleBackdropPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!consumeBackdropEvent(event)) return
    // Keep the backdrop mounted through the browser's compatibility click.
    // If that click is suppressed by preventDefault, this fallback still closes it.
    backdropCloseTimerRef.current = window.setTimeout(closeDock, 0)
  }

  function handleBackdropClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!consumeBackdropEvent(event)) return
    closeDock()
  }

  function leaveChat() {
    resetChat()
  }

  async function clearChatHistory() {
    if (!conversationId || clearingChat) return
    if (!window.confirm('确定删除与该好友的全部聊天记录吗？删除后不可恢复。')) return
    const chatSession = ++chatSessionRef.current
    setClearingChat(true)
    setSending(false)
    setLoadingOlder(false)
    setError('')
    try {
      const response = await fetch(`/api/direct-conversations/${conversationId}/clear`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '删除聊天记录失败')
        return
      }
      if (chatSession !== chatSessionRef.current) return
      setMessages([])
      setHasOlderMessages(false)
      setNewMessageNotice(false)
      cursorRef.current = ''
      beforeCursorRef.current = ''
      setChatActionsOpen(false)
      setFriends((current) => {
        const next = current.map((friend) => friend.conversationId === conversationId
          ? { ...friend, lastMessage: null, lastMessageAt: null, unreadCount: 0 }
          : friend)
        friendsRef.current = next
        return next
      })
      notifyClients('messages')
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '删除聊天记录失败')
    } finally {
      setClearingChat(false)
    }
  }

  async function openChat(friend: FriendDockUser) {
    const chatSession = ++chatSessionRef.current
    setError('')
    setProfileFriend(null)
    const response = await fetch('/api/direct-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUid: friend.uid }),
    })
    const data = await response.json().catch(() => ({}))
    if (chatSession !== chatSessionRef.current) return
    if (!response.ok) {
      setError(data.message || '无法打开会话')
      return
    }
    const nextConversationId = data.conversation.id as string
    setChatFriend(friend)
    setChatActionsOpen(false)
    setConversationId(nextConversationId)
    setMessages([])
    cursorRef.current = ''
    beforeCursorRef.current = ''
    const messagesResponse = await fetch(`/api/direct-conversations/${nextConversationId}/messages`, { cache: 'no-store' })
    const messagesData = await messagesResponse.json().catch(() => ({}))
    if (chatSession !== chatSessionRef.current) return
    if (!messagesResponse.ok) {
      setError(messagesData.message || '消息加载失败')
      return
    }
    const initial = Array.isArray(messagesData.messages) ? messagesData.messages as Message[] : []
    setMessages(initial.map((message) => ({ ...message, status: message.readAt ? 'READ' : 'SENT' })))
    cursorRef.current = messagesData.cursor || ''
    beforeCursorRef.current = messagesData.beforeCursor || ''
    setHasOlderMessages(Boolean(messagesData.hasOlder))
    const lastVisibleMessage = initial[initial.length - 1]
    if (lastVisibleMessage) await markConversationRead(nextConversationId, lastVisibleMessage.id)
    window.requestAnimationFrame(() => scrollToBottom('auto'))
  }

  function promoteFriendConversation(id: string, message: Message) {
    setFriends((current) => {
      const index = current.findIndex((friend) => friend.conversationId === id)
      if (index < 0) return current
      const friend = current[index]
      const updated = {
        ...friend,
        lastMessageAt: message.createdAt,
        lastMessage: {
          id: message.id,
          content: message.content,
          createdAt: message.createdAt,
          senderId: message.senderId,
          type: message.type || (message.stickerId ? 'STICKER' : 'TEXT'),
        },
      }
      const next = [updated, ...current.slice(0, index), ...current.slice(index + 1)]
      friendsRef.current = next
      return next
    })
  }

  async function sendMessage(input: { content: string; clientMessageId: string; optimisticId?: string; stickerId?: string; stickerUrl?: string | null }) {
    if (!conversationId || clearingChat || sendingMessageIdsRef.current.has(input.clientMessageId)) return false
    const chatSession = chatSessionRef.current
    sendingMessageIdsRef.current.add(input.clientMessageId)
    setSending(true)
    const optimisticId = input.optimisticId || `pending:${input.clientMessageId}`
    const optimistic: Message = {
      id: optimisticId,
      content: input.content,
      senderId: currentUserId,
      createdAt: new Date().toISOString(),
      clientMessageId: input.clientMessageId,
      readAt: null,
      status: 'SENDING',
      stickerId: input.stickerId || null,
      stickerUrl: input.stickerUrl || null,
    }
    setMessages((current) => current.some((item) => item.id === optimisticId)
      ? current.map((item) => item.id === optimisticId ? optimistic : item)
      : [...current, optimistic])
    window.requestAnimationFrame(() => scrollToBottom('smooth'))
    try {
      const response = await fetch(`/api/direct-conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: input.content,
          clientMessageId: input.clientMessageId,
          ...(input.stickerId ? { stickerId: input.stickerId } : {}),
        }),
      })
      let data: { success?: boolean; error?: string; message?: Message | string } | null = null
      try {
        data = await response.json()
      } catch {
        throw new Error(response.ok ? '服务器返回格式异常，消息未确认发送' : `发送失败（HTTP ${response.status}）`)
      }
      if (chatSession !== chatSessionRef.current) return false
      if (!response.ok) {
        console.error('[friend-dock.send]', { status: response.status, response: data })
        setMessages((current) => current.map((message) => message.id === optimisticId ? { ...message, status: 'FAILED' } : message))
        setError(data?.error || (typeof data?.message === 'string' ? data.message : '') || `发送失败（HTTP ${response.status}），可点击消息重试`)
        return false
      }
      if (!data?.success || !data.message || typeof data.message === 'string' || !data.message.id) {
        throw new Error('服务器未返回有效消息，消息未确认发送')
      }
      mergeMessages([data.message])
      promoteFriendConversation(conversationId, data.message)
      notifyClients('messages')
      return true
    } catch (sendError) {
      console.error('[friend-dock.send]', sendError)
      if (chatSession !== chatSessionRef.current) return false
      setMessages((current) => current.map((message) => message.id === optimisticId ? { ...message, status: 'FAILED' } : message))
      setError(sendError instanceof TypeError
        ? '网络连接中断，消息未确认发送，可点击消息重试'
        : sendError instanceof Error ? sendError.message : '发送失败，可点击消息重试')
      return false
    } finally {
      sendingMessageIdsRef.current.delete(input.clientMessageId)
      if (chatSession === chatSessionRef.current) setSending(sendingMessageIdsRef.current.size > 0)
    }
  }

  function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (sending || clearingChat || sendingMessageIdsRef.current.size > 0) return
    setError('')
    let clientMessageId = ''
    try {
      clientMessageId = createMessageId()
    } catch (messageIdError) {
      console.error('[friend-dock.message-id]', messageIdError)
      setError('发送失败，请稍后重试')
      return
    }
    if (pendingSticker) {
      const sticker = pendingSticker
      void sendMessage({ content: '', clientMessageId, stickerId: sticker.id, stickerUrl: sticker.url }).then((success) => {
        if (success) { setPendingSticker(null); setContent('') }
      })
      return
    }
    const trimmed = content.trim()
    if (!trimmed) return
    void sendMessage({ content: trimmed, clientMessageId }).then((success) => {
      if (success) setContent((current) => current.trim() === trimmed ? '' : current)
    })
  }

  async function loadOlderMessages() {
    if (!conversationId || !beforeCursorRef.current || loadingOlder) return
    const chatSession = chatSessionRef.current
    const list = messageListRef.current
    const previousHeight = list?.scrollHeight || 0
    setLoadingOlder(true)
    const response = await fetch(`/api/direct-conversations/${conversationId}/messages?before=${encodeURIComponent(beforeCursorRef.current)}`, { cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    setLoadingOlder(false)
    if (chatSession !== chatSessionRef.current) return
    if (!response.ok) {
      setError(data.message || '更早消息加载失败')
      return
    }
    mergeMessages(Array.isArray(data.messages) ? data.messages : [], data.peerLastReadAt)
    beforeCursorRef.current = data.beforeCursor || beforeCursorRef.current
    setHasOlderMessages(Boolean(data.hasOlder))
    window.requestAnimationFrame(() => {
      if (list) list.scrollTop = list.scrollHeight - previousHeight
    })
  }

  async function sendFriendRequest(friend: FriendDockUser) {
    const response = await fetch('/api/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: friend.uid }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok && response.status !== 409) {
      setError(data.message || '好友申请发送失败')
      return
    }
    setSearchResults((current) => current.map((item) => item.id === friend.id
      ? { ...item, relationshipStatus: data.status === 'INCOMING_PENDING' ? 'INCOMING_PENDING' : data.status === 'FRIEND' ? 'FRIEND' : 'OUTGOING_PENDING' }
      : item))
    notifyClients('friends')
  }

  async function decideRequest(friend: FriendDockUser, action: 'accept' | 'reject') {
    if (!friend.requestId) return
    const response = await fetch(`/api/friends/requests/${friend.requestId}/${action}`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message || '好友申请处理失败')
      return
    }
    setSearchResults((current) => current.map((item) => item.id === friend.id
      ? { ...item, relationshipStatus: action === 'accept' ? 'FRIEND' : 'NONE', requestId: null }
      : item))
    notifyClients('friends')
  }

  function scrollToBottom(behavior: ScrollBehavior) {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior })
    nearBottomRef.current = true
    setNewMessageNotice(false)
  }

  const visibleUsers = debouncedQuery ? searchResults : friends
  const groupedFriendSections = useMemo<Array<FriendGroup & { friends: FriendDockUser[] }>>(() => [
    {
      id: UNGROUPED_FRIEND_GROUP_ID,
      name: '未分组',
      sortOrder: -1,
      count: ungroupedCount,
      friends: groupFriends[UNGROUPED_FRIEND_GROUP_ID] || [],
    },
    ...friendGroups.map((group) => ({
      ...group,
      friends: groupFriends[group.id] || [],
    })),
  ], [friendGroups, groupFriends, ungroupedCount])
  const groupedMessages = useMemo(() => groupMessages(messages), [messages])
  const overlay = open && typeof document !== 'undefined' ? createPortal(
    <>
      {isMobileDrawer ? (
        <div
          className="friend-dock-backdrop"
          aria-hidden="true"
          onPointerDown={consumeBackdropEvent}
          onPointerUp={handleBackdropPointerUp}
          onClick={handleBackdropClick}
        />
      ) : null}
      <section
        ref={panelRef}
        className={`friend-dock-panel ${chatFriend ? 'is-chat' : 'is-list'}`}
        style={{
          '--friend-dock-viewport-height': `${viewport.height || window.innerHeight}px`,
          '--friend-dock-viewport-top': `${viewport.top}px`,
        } as React.CSSProperties}
        aria-label="好友与私信"
      >
        <header className="friend-dock-header">
          {chatFriend ? (
            <>
              <button type="button" onClick={leaveChat} aria-label="返回好友列表">←</button>
              <button type="button" className="friend-dock-chat-person" onClick={() => setProfileFriend(chatFriend)}>
                <SafeAvatar src={profileImageUrl(chatFriend.profile?.avatarUrl || chatFriend.avatarUrl)} name={chatFriend.profile?.displayName || chatFriend.nickname} className="h-8 w-8" />
                <span><strong>{chatFriend.profile?.displayName || chatFriend.nickname}</strong><small>{chatFriend.isOnline ? '在线' : chatFriend.levelName}</small></span>
              </button>
            </>
          ) : <strong className="friend-dock-title">好友与私信</strong>}
          {!chatFriend ? <span className="friend-dock-count">{friendTotal}个病友</span> : null}
          <div className="friend-dock-header-actions">
            {chatFriend ? (
              <div className="friend-dock-chat-actions">
                <button
                  type="button"
                  onClick={() => setChatActionsOpen((value) => !value)}
                  aria-label="私信更多操作"
                  aria-haspopup="menu"
                  aria-expanded={chatActionsOpen}
                  title="更多操作"
                >
                  ⋯
                </button>
                {chatActionsOpen ? (
                  <div className="friend-dock-chat-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => void clearChatHistory()} disabled={clearingChat}>
                      {clearingChat ? '删除中…' : '删除聊天记录'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!chatFriend ? (
              <Link
                className="friend-dock-notifications-link"
                href="/notifications"
                aria-label={unreadSummary.total > 0 ? `通知中心，${unreadSummary.total}条未读` : '通知中心'}
              >
                <span>通知中心</span>
                {unreadSummary.total > 0 ? (
                  <b className="friend-dock-notification-badge">
                    {unreadSummary.total > 99 ? '99+' : unreadSummary.total}
                  </b>
                ) : null}
              </Link>
            ) : null}
            <button type="button" onClick={closeDock} aria-label="关闭好友窗口">×</button>
          </div>
        </header>

        <div className="friend-dock-body">
          {chatFriend ? (
            <div className="friend-chat-layout">
            <div
              ref={messageListRef}
              className="friend-chat-messages"
              onScroll={(event) => {
                const element = event.currentTarget
                nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
                if (nearBottomRef.current) setNewMessageNotice(false)
              }}
            >
              {hasOlderMessages ? <button type="button" className="friend-chat-load-older" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? '加载中…' : '加载更早消息'}</button> : null}
              {groupedMessages.map((group) => (
                <div key={group.label} className="friend-chat-day">
                  <div className="friend-chat-date">{group.label}</div>
                  {group.messages.map((message) => {
                    const mine = message.senderId === currentUserId
                    // 表情包消息：直接展示图片，不套用文字气泡（无 border/background/白框/padding）。
                    const stickerImg = message.stickerUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={publicImageVariantUrl(message.stickerUrl, 'thumb-md') || message.stickerUrl}
                        alt={message.content || '表情'}
                        className="max-w-[120px] max-h-[120px] rounded-lg object-contain sm:max-w-[150px] sm:max-h-[150px]"
                      />
                    ) : null
                    return (
                      <div key={message.id} className={`friend-chat-message ${mine ? 'is-mine' : 'is-peer'}`}>
                        {message.stickerUrl ? (
                          // 仅发送失败（FAILED）时才用无样式按钮包裹，点击重试；成功消息直接展示图片。
                          message.status === 'FAILED' ? (
                            <button
                              type="button"
                              className="friend-chat-sticker-message"
                              onClick={() => {
                                if (message.clientMessageId) {
                                  void sendMessage({
                                    content: message.content,
                                    clientMessageId: message.clientMessageId,
                                    optimisticId: message.id,
                                    stickerId: message.stickerId ?? undefined,
                                    stickerUrl: message.stickerUrl ?? null,
                                  })
                                }
                              }}
                              title="点击重试"
                            >
                              {stickerImg}
                            </button>
                          ) : (
                            stickerImg
                          )
                        ) : (
                          <button
                            type="button"
                            className="friend-chat-bubble"
                            disabled={message.status !== 'FAILED'}
                            onClick={() => {
                              if (message.status === 'FAILED' && message.clientMessageId) {
                                void sendMessage({
                                  content: message.content,
                                  clientMessageId: message.clientMessageId,
                                  optimisticId: message.id,
                                })
                              }
                            }}
                            title={message.status === 'FAILED' ? '点击重试' : undefined}
                          >
                            {message.content}
                          </button>
                        )}
                        <div className="friend-chat-message-meta">
                          <time>{formatMessageTime(message.createdAt)}</time>
                          {mine ? <MessageTicks status={message.status || (message.readAt ? 'READ' : 'SENT')} /> : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
              {!messages.length ? <p className="friend-chat-empty">还没有消息，打个招呼吧。</p> : null}
            </div>
            {newMessageNotice ? <button type="button" className="friend-chat-new-message" onClick={() => scrollToBottom('smooth')}>有新消息 ↓</button> : null}
            <form className="friend-chat-composer" onSubmit={submitMessage}>
              <button
                type="button"
                className="friend-chat-sticker-btn"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setPickerOpen((value) => !value)}
                disabled={sending}
                aria-label="选择表情包"
                aria-expanded={pickerOpen}
                title="表情包"
              >
                😊
              </button>
              {pendingSticker ? (
                <span className="friend-chat-sticker-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={publicImageVariantUrl(pendingSticker.url, 'thumb-sm') || pendingSticker.url} alt={pendingSticker.name || '表情'} />
                  <button
                    type="button"
                    className="friend-chat-sticker-remove"
                    onClick={() => setPendingSticker(null)}
                    aria-label="移除表情"
                  >
                    ×
                  </button>
                </span>
              ) : null}
              <textarea
                ref={messageInputRef}
                value={content}
                maxLength={1000}
                rows={1}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder="输入私信…"
                aria-label="私信内容"
              />
              <button type="submit" disabled={(!content.trim() && !pendingSticker) || sending}>{sending ? '发送中…' : '发送'}</button>
            </form>
            <div className="relative">
              <StickerPicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onSelectSticker={(sticker) => {
                  setPendingSticker(sticker)
                  setPickerOpen(false)
                }}
                onSelectEmoji={insertEmoji}
                composerRef={messageInputRef}
                mobileColumns={5}
                desktopColumns={5}
                mobileCellPx={64}
                desktopCellPx={64}
              />
            </div>
            </div>
          ) : (
            <div className="friend-list-layout">
            <div className="friend-dock-search">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索好友或其他用户" aria-label="搜索好友或其他用户" />
              {query ? <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">×</button> : null}
            </div>
            {!debouncedQuery ? (
              <div className="friend-dock-group-toolbar">
                <span>好友分组</span>
                <button type="button" onClick={() => void createFriendGroup()}>新建分组</button>
              </div>
            ) : null}
            <div className="friend-dock-list">
              {debouncedQuery ? visibleUsers.map((friend) => (
                <FriendRow
                  key={friend.id}
                  friend={friend}
                  groups={friendGroups}
                  searching
                  onProfile={() => setProfileFriend(friend)}
                  onChat={() => void openChat(friend)}
                  onMove={(groupId) => void moveFriendToGroup(friend, groupId)}
                  onAdd={() => void sendFriendRequest(friend)}
                  onDecide={(action) => void decideRequest(friend, action)}
                />
              )) : groupedFriendSections.map((group) => {
                const collapsed = collapsedGroupIds.has(group.id)
                return (
                  <section key={group.id} className="friend-dock-group">
                    <div className="friend-dock-group-header">
                      <button type="button" className="friend-dock-group-toggle" onClick={() => toggleFriendGroup(group.id)} aria-expanded={!collapsed}>
                        <span>{group.name} ({group.count})</span>
                        <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
                      </button>
                      {group.id !== '__ungrouped__' ? (
                        <div className="friend-dock-group-actions">
                          <button type="button" onClick={() => void renameFriendGroup(group)} aria-label={`重命名${group.name}`}>重命名</button>
                          <button type="button" onClick={() => void deleteFriendGroup(group)} aria-label={`删除${group.name}`}>删除</button>
                        </div>
                      ) : null}
                    </div>
                    {!collapsed ? group.friends.map((friend) => (
                      <FriendRow
                        key={friend.id}
                        friend={friend}
                        groups={friendGroups}
                        searching={false}
                        onProfile={() => setProfileFriend(friend)}
                        onChat={() => void openChat(friend)}
                        onMove={(groupId) => void moveFriendToGroup(friend, groupId)}
                        onAdd={() => void sendFriendRequest(friend)}
                        onDecide={(action) => void decideRequest(friend, action)}
                      />
                    )) : null}
                    {!collapsed && groupFriends[group.id] === undefined && loadingGroupIds.has(group.id) ? <p className="friend-dock-empty">加载分组成员中…</p> : null}
                    {!collapsed && groupFriends[group.id] === undefined && !loadingGroupIds.has(group.id) && group.count > 0 ? (
                      <button type="button" className="friend-dock-load-more" onClick={() => void loadGroupFriends(group.id)}>
                        加载分组成员
                      </button>
                    ) : null}
                    {!collapsed && groupPagination[group.id]?.hasMore ? (
                      <button
                        type="button"
                        className="friend-dock-load-more"
                        onClick={() => void loadGroupFriends(group.id, groupPagination[group.id].page + 1, true)}
                        disabled={loadingGroupIds.has(group.id)}
                      >
                        {loadingGroupIds.has(group.id) ? '加载中…' : `加载更多${group.name}好友`}
                      </button>
                    ) : null}
                  </section>
                )
              })}
              {loadingList ? <p className="friend-dock-empty">加载中…</p> : null}
              {!loadingList && !visibleUsers.length ? <p className="friend-dock-empty">{debouncedQuery ? '没有找到匹配用户' : '暂无好友'}</p> : null}
              <div className="friend-dock-list-end" aria-hidden="true" />
            </div>
            </div>
          )}
        </div>
        {error ? <p className="friend-dock-error">{error}<button type="button" onClick={() => setError('')}>×</button></p> : null}
        {profileFriend ? <FriendProfileCard
          friend={profileFriend}
          onClose={() => setProfileFriend(null)}
          onNavigate={closeDock}
          onMessage={() => void openChat(profileFriend)}
        /> : null}
      </section>
    </>,
    document.body,
  ) : null

  return (
    <div className={`friend-dock ${collapsed ? 'is-collapsed' : ''}`} data-friend-dock-open={open || undefined}>
      {overlay}
      {!open && collapsed ? (
        <button ref={toggleRef} type="button" className="friend-dock-toggle is-handle" onClick={() => setCollapsed(false)} aria-label="展开好友入口">
          ‹{unreadSummary.total > 0 ? <span className="friend-dock-unread-dot" /> : null}
        </button>
      ) : !open || !isMobileDrawer ? (
        <div className="friend-dock-actions">
          <button ref={toggleRef} type="button" className="friend-dock-toggle" onClick={open ? closeDock : openFriendList} aria-label={open ? '关闭好友窗口' : '打开好友窗口'} aria-expanded={open}>
            好友{unreadSummary.total > 0 ? <b>{unreadSummary.total > 99 ? '99+' : unreadSummary.total}</b> : null}
          </button>
          <button type="button" className="friend-dock-collapse" onClick={() => { closeDock(); setCollapsed(true) }} aria-label="收起好友入口">›</button>
        </div>
      ) : null}
    </div>
  )
}

function FriendRow({
  friend,
  groups,
  searching,
  onProfile,
  onChat,
  onMove,
  onAdd,
  onDecide,
}: {
  friend: FriendDockUser
  groups: FriendGroup[]
  searching: boolean
  onProfile: () => void
  onChat: () => void
  onMove: (groupId: string | null) => void
  onAdd: () => void
  onDecide: (action: 'accept' | 'reject') => void
}) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const name = friend.profile?.displayName || friend.nickname
  const avatar = profileImageUrl(friend.profile?.avatarUrl || friend.avatarUrl)
  const status = friend.relationshipStatus || 'FRIEND'
  const canOpenProfile = status === 'FRIEND'
  return (
    <article className={`friend-dock-row ${friend.unreadCount ? 'has-unread' : ''}`}>
      <button type="button" className="friend-dock-avatar-button" onClick={canOpenProfile ? onProfile : undefined} disabled={!canOpenProfile} aria-label={canOpenProfile ? `查看${name}的资料卡` : undefined}>
        <SafeAvatar src={avatar} name={name} className="h-full w-full" />
      </button>
      <div className="friend-dock-row-main">
        <button type="button" className="friend-dock-row-name" onClick={status === 'FRIEND' ? onChat : undefined} disabled={status !== 'FRIEND'}>
          <strong>{name}</strong>
          <small>UID {formatUid(friend.uid)} · {friend.levelName || '初入E院'}</small>
        </button>
        {!searching ? (
          <button type="button" className="friend-dock-conversation-preview" onClick={onChat}>
            <span>{!friend.lastMessage ? '暂无私信' : (friend.lastMessage.type === 'STICKER' ? '[表情]' : friend.lastMessage.content)}</span>
            {friend.lastMessageAt ? <time>{formatConversationTime(friend.lastMessageAt)}</time> : null}
          </button>
        ) : <RelationshipActions status={status} onChat={onChat} onAdd={onAdd} onDecide={onDecide} />}
      </div>
      {friend.unreadCount ? <b className="friend-dock-row-unread">{friend.unreadCount > 99 ? '99+' : friend.unreadCount}</b> : null}
      {status === 'FRIEND' ? (
        <div className="friend-dock-row-actions">
          <button type="button" onClick={() => setActionsOpen((value) => !value)} aria-label={`更多${name}的操作`} aria-expanded={actionsOpen}>⋯</button>
          {actionsOpen ? (
            <label className="friend-dock-move-menu">
              <span>移动到分组</span>
              <select
                value={friend.groupId || ''}
                onChange={(event) => {
                  onMove(event.target.value || null)
                  setActionsOpen(false)
                }}
                aria-label={`移动${name}到分组`}
              >
                <option value="">未分组</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function RelationshipActions({
  status,
  onChat,
  onAdd,
  onDecide,
}: {
  status: RelationshipStatus
  onChat: () => void
  onAdd: () => void
  onDecide: (action: 'accept' | 'reject') => void
}) {
  if (status === 'FRIEND') return <div className="friend-relationship-actions"><span>已是好友</span><button type="button" onClick={onChat}>发私信</button></div>
  if (status === 'OUTGOING_PENDING') return <div className="friend-relationship-actions"><span>还不是好友</span><button type="button" disabled>已发送</button></div>
  if (status === 'INCOMING_PENDING') return <div className="friend-relationship-actions"><span>对方申请添加你</span><button type="button" onClick={() => onDecide('accept')}>同意</button><button type="button" onClick={() => onDecide('reject')}>拒绝</button></div>
  if (status === 'SELF') return <div className="friend-relationship-actions"><span>这是你自己</span></div>
  if (status === 'BLOCKED') return <div className="friend-relationship-actions"><span>无法添加</span></div>
  return <div className="friend-relationship-actions"><span>还不是好友</span><button type="button" onClick={onAdd}>添加好友</button></div>
}

function MessageTicks({ status }: { status: MessageStatus }) {
  if (status === 'SENDING') return <span title="发送中" aria-label="发送中">…</span>
  if (status === 'FAILED') return <span className="is-failed" title="发送失败，点击重试" aria-label="发送失败">!</span>
  if (status === 'READ') return <span className="is-read" title="对方已读" aria-label="对方已读">✓✓</span>
  return <span title="服务端已保存，对方未读" aria-label="已发送，对方未读">✓</span>
}

function compareMessages(a: Message, b: Message) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id)
}

function groupMessages(messages: Message[]) {
  const groups = new Map<string, Message[]>()
  messages.forEach((message) => {
    const label = formatDateGroup(message.createdAt)
    groups.set(label, [...(groups.get(label) || []), message])
  })
  return [...groups.entries()].map(([label, rows]) => ({ label, messages: rows }))
}

function formatDateGroup(value: string) {
  const date = new Date(value)
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  const key = formatter.format(date)
  const today = formatter.format(now)
  const yesterday = formatter.format(new Date(now.getTime() - 86_400_000))
  if (key === today) return '今天'
  if (key === yesterday) return '昨天'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function formatMessageTime(value: string) {
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).format(new Date(value))

  return formatted.replace(/^24:/, '00:')
}

function formatConversationTime(value: string) {
  const date = new Date(value)
  const now = new Date()
  return date.toDateString() === now.toDateString()
    ? formatMessageTime(value)
    : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).format(date)
}
