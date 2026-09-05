'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { StickerPicker, type PickerSticker } from '@/components/StickerPicker'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FriendGroupDialog, type FriendGroupDialogMode } from '@/components/FriendGroupDialog'
import { FriendAlphabetIndex } from '@/components/FriendAlphabetIndex'
import { FriendProfileCard } from '@/components/FriendProfileCard'
import { AddFriendButton } from '@/components/FriendRequestActions'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { FriendDockUser, RelationshipStatus, UndercoverPresence } from '@/lib/friend-types'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { mergeUniqueFriendPage, UNGROUPED_FRIEND_GROUP_ID } from '@/lib/friend-grouping'
import { getFriendDisplayName, normalizeFriendRemark } from '@/lib/friend-display-name'
import {
  groupFriendsByLetter,
  resolveFriendIndexTarget,
  type FriendDirectoryLetter,
} from '@/lib/friend-directory'
import {
  calculateFriendListRestoredScrollTop,
  createFriendListReturnState,
  FRIEND_LIST_RETURN_STATE_KEY,
  parseFriendListReturnState,
  type FriendListReturnState,
} from '@/lib/friend-list-return-state'
import type { UnreadSummary } from '@/lib/notifications'
import { formatUid } from '@/lib/uid'
import { UserDisplayName } from '@/components/UserDisplayName'

type MessageStatus = 'SENDING' | 'SENT' | 'READ' | 'FAILED'
type FriendListViewMode = 'alphabetical' | 'groups'
type FriendDockTab = 'chat' | 'contacts'
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

type ConversationSummary = {
  id: string
  lastMessageAt: string | null
  otherUser: FriendDockUser
  latestMessage: {
    id: string
    content: string
    createdAt: string
    senderId: string
    type?: string | null
    preview?: string
  } | null
  unreadCount: number
}

const emptySummary: UnreadSummary = {
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
  review: 0,
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
  unreadSummaryAvailable = true,
}: {
  currentUserId: string
  unreadSummary?: UnreadSummary
  unreadSummaryAvailable?: boolean
}) {
  // Chat unread state is maintained by the conversation system. Keep it on
  // the friend entry badge, while the notification-center link continues to
  // use `unreadSummary.total` so private messages are not double-counted as
  // notifications. When the notification summary is unavailable, use the
  // conversation list once it has loaded instead of displaying a fabricated 0.
  const pathname = usePathname()
  const router = useRouter()
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
  const [friendListViewMode, setFriendListViewMode] = useState<FriendListViewMode>('alphabetical')
  const [activeTab, setActiveTab] = useState<FriendDockTab>('chat')
  const [activeAlphabetLetter, setActiveAlphabetLetter] = useState<FriendDirectoryLetter | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [friendTotal, setFriendTotal] = useState(0)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationsLoaded, setConversationsLoaded] = useState(false)
  const conversationUnreadCount = useMemo(
    () => conversations.reduce((total, conversation) => total + Math.max(0, conversation.unreadCount || 0), 0),
    [conversations],
  )
  const friendDockUnreadCount = unreadSummaryAvailable
    ? unreadSummary.total + unreadSummary.directMessages
    : conversationsLoaded
      ? conversationUnreadCount
      : null
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [chatListError, setChatListError] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [refreshingFriendList, setRefreshingFriendList] = useState(false)
  const [profileFriend, setProfileFriend] = useState<FriendDockUser | null>(null)
  const [conversationId, setConversationId] = useState('')
  const [chatFriend, setChatFriend] = useState<FriendDockUser | null>(null)
  const [chatActionsOpen, setChatActionsOpen] = useState(false)
  const [clearingChat, setClearingChat] = useState(false)
  const [deleteChatTarget, setDeleteChatTarget] = useState<ConversationSummary | null>(null)
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [pendingSticker, setPendingSticker] = useState<PickerSticker | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [friendGroupDialog, setFriendGroupDialog] = useState<{ mode: FriendGroupDialogMode; group: FriendGroup | null } | null>(null)
  const [friendGroupDialogName, setFriendGroupDialogName] = useState('')
  const [friendGroupDialogError, setFriendGroupDialogError] = useState('')
  const [friendGroupDialogBusy, setFriendGroupDialogBusy] = useState(false)
  const [deleteFriendGroupTarget, setDeleteFriendGroupTarget] = useState<FriendGroup | null>(null)
  const [deletingFriendGroupId, setDeletingFriendGroupId] = useState<string | null>(null)
  const [newMessageNotice, setNewMessageNotice] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [viewport, setViewport] = useState({ height: 0, top: 0 })
  const [isMobileDrawer, setIsMobileDrawer] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const friendListRef = useRef<HTMLDivElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)
  const cursorRef = useRef('')
  const beforeCursorRef = useRef('')
  const nearBottomRef = useRef(true)
  const backdropCloseTimerRef = useRef(0)
  const sendingMessageIdsRef = useRef(new Set<string>())
  const chatSessionRef = useRef(0)
  const friendListRequestRef = useRef(0)
  const conversationRequestRef = useRef(0)
  const friendsRef = useRef<FriendDockUser[]>([])
  const friendListPageRef = useRef(1)
  const friendListRestorePendingRef = useRef(false)
  const friendListReturnStateRef = useRef<FriendListReturnState | null>(null)
  const friendListScrollTopByModeRef = useRef<Record<FriendListViewMode, number>>({ alphabetical: 0, groups: 0 })
  const chatListScrollTopRef = useRef(0)
  const previousFriendListViewModeRef = useRef<FriendListViewMode>('alphabetical')
  const groupRequestRef = useRef(new Map<string, number>())
  const friendGroupDialogSubmittingRef = useRef(false)
  const friendGroupDialogComposingRef = useRef(false)
  const openChatRef = useRef<(friend: FriendDockUser) => void>(() => {})
  const isSearchMode = query.trim().length > 0

  const clearFriendListReturnState = useCallback(() => {
    friendListRestorePendingRef.current = false
    friendListReturnStateRef.current = null
    try {
      window.sessionStorage.removeItem(FRIEND_LIST_RETURN_STATE_KEY)
    } catch {
      // Private browsing and blocked storage should not affect the chat flow.
    }
  }, [])

  const saveFriendListReturnState = useCallback((friendId: string) => {
    const list = friendListRef.current
    const row = list
      ? Array.from(list.querySelectorAll<HTMLElement>('[data-friend-id]')).find((item) => item.dataset.friendId === friendId)
      : null
    const listTop = list?.getBoundingClientRect().top || 0
    const rowTop = row?.getBoundingClientRect().top
    const state = createFriendListReturnState({
      friendId,
      scrollTop: list?.scrollTop || 0,
      scrollY: window.scrollY,
      viewportOffset: typeof rowTop === 'number' ? rowTop - listTop : null,
      query: debouncedQuery,
    })
    friendListReturnStateRef.current = state
    try {
      window.sessionStorage.setItem(FRIEND_LIST_RETURN_STATE_KEY, JSON.stringify(state))
    } catch {
      // The in-memory snapshot still lets same-mount navigation restore.
    }
    friendListRestorePendingRef.current = false
  }, [debouncedQuery])

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
    conversationRequestRef.current += 1
    clearFriendListReturnState()
    setOpen(false)
    setProfileFriend(null)
    setFriendGroupDialog(null)
    setFriendGroupDialogName('')
    setFriendGroupDialogError('')
    setDeleteFriendGroupTarget(null)
    setDeleteChatTarget(null)
    resetChat()
    window.requestAnimationFrame(() => toggleRef.current?.focus())
  }, [clearFriendListReturnState, resetChat])

  const openFriendList = useCallback(() => {
    clearFriendListReturnState()
    conversationRequestRef.current += 1
    resetChat()
    setProfileFriend(null)
    setCollapsed(false)
    setFriendListReady(false)
    groupRequestRef.current.forEach((requestId, groupId) => groupRequestRef.current.set(groupId, requestId + 1))
    setLoadingGroupIds(new Set())
    setGroupFriends({})
    setGroupPagination({})
    setFriendGroupDialog(null)
    setFriendGroupDialogName('')
    setFriendGroupDialogError('')
    setDeleteFriendGroupTarget(null)
    setDeleteChatTarget(null)
    setActiveTab('chat')
    setConversations([])
    setConversationsLoaded(false)
    setLoadingConversations(false)
    setChatListError('')
    chatListScrollTopRef.current = 0
    setQuery('')
    setDebouncedQuery('')
    setOpen(true)
  }, [clearFriendListReturnState, resetChat])

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
      const response = await fetch(`/api/friends/list?${params}`, { credentials: 'same-origin', cache: 'no-store' })
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

  const refreshLoadedFriendGroups = useCallback(async () => {
    const jobs = Object.entries(groupFriends)
      .filter(([groupId, items]) => !collapsedGroupIds.has(groupId) && items.length > 0)
      .map(([groupId]) => {
        const pagination = groupPagination[groupId]
        const lastLoadedPage = Math.max(1, pagination?.page || 1)
        const pageAfterLoadedRange = pagination?.hasMore ? lastLoadedPage + 1 : lastLoadedPage
        return (async () => {
          await loadGroupFriends(groupId, 1, false)
          for (let page = 2; page <= pageAfterLoadedRange; page += 1) {
            await loadGroupFriends(groupId, page, true)
          }
        })()
      })
    if (!jobs.length) return
    setRefreshingFriendList(true)
    await Promise.allSettled(jobs)
    setRefreshingFriendList(false)
  }, [collapsedGroupIds, groupFriends, groupPagination, loadGroupFriends])

  const invalidateAllGroupCaches = useCallback(() => {
    groupRequestRef.current.forEach((requestId, groupId) => groupRequestRef.current.set(groupId, requestId + 1))
    setLoadingGroupIds(new Set())
    setGroupFriends({})
    setGroupPagination({})
  }, [])

  const loadFriends = useCallback(async (nextPage = 1, append = false, signal?: AbortSignal, silent = false, directory = false) => {
    const requestId = ++friendListRequestRef.current
    if (!silent) setLoadingList(true)
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: '30' })
      if (directory) params.set('directory', '1')
      const response = await fetch(`/api/friends/list?${params}`, { signal, credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (requestId !== friendListRequestRef.current) return
      if (!response.ok) {
        setError(data.message || '好友列表加载失败')
        return
      }
      const incoming = Array.isArray(data.friends) ? data.friends as FriendDockUser[] : []
      if (Array.isArray(data.groups)) setFriendGroups(data.groups as FriendGroup[])
      if (Number.isSafeInteger(data.ungroupedCount) && data.ungroupedCount >= 0) setUngroupedCount(data.ungroupedCount)
      if (Number.isSafeInteger(data.friendTotal) && data.friendTotal >= 0) setFriendTotal(data.friendTotal)
      else if (Number.isSafeInteger(data.total) && data.total >= 0) setFriendTotal(data.total)
      setFriendListReady(true)
      const preserveLoadedPages = !directory && silent && friendListPageRef.current > 1 && !append
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
      friendListPageRef.current = directory ? 1 : nextPage
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      if (requestId === friendListRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : '好友列表加载失败')
      }
    } finally {
      if (!silent && requestId === friendListRequestRef.current) setLoadingList(false)
    }
  }, [])

  const loadConversations = useCallback(async (silent = false) => {
    const requestId = ++conversationRequestRef.current
    if (!silent) setLoadingConversations(true)
    setChatListError('')
    try {
      const response = await fetch('/api/direct-conversations', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (requestId !== conversationRequestRef.current) return false
      if (!response.ok) {
        setChatListError(data.message || '聊天列表加载失败')
        return false
      }
      const incoming = Array.isArray(data.conversations)
        ? data.conversations.filter((item: unknown): item is ConversationSummary => {
            if (!item || typeof item !== 'object') return false
            const candidate = item as Partial<ConversationSummary>
            return typeof candidate.id === 'string' && Boolean(candidate.otherUser) && Boolean(candidate.latestMessage)
          })
        : []
      setConversations(incoming)
      setConversationsLoaded(true)
      if (Number.isSafeInteger(data.friendTotal) && data.friendTotal >= 0) setFriendTotal(data.friendTotal)
      return true
    } catch (loadError) {
      if (requestId === conversationRequestRef.current) {
        setChatListError(loadError instanceof Error ? loadError.message : '聊天列表加载失败')
      }
      return false
    } finally {
      if (requestId === conversationRequestRef.current) setLoadingConversations(false)
    }
  }, [])

  function openFriendGroupDialog(mode: FriendGroupDialogMode, group: FriendGroup | null = null) {
    setError('')
    setFriendGroupDialogError('')
    setFriendGroupDialogName(mode === 'rename' ? group?.name || '' : '')
    friendGroupDialogComposingRef.current = false
    setFriendGroupDialog({ mode, group })
  }

  function closeFriendGroupDialog() {
    if (friendGroupDialogBusy || friendGroupDialogSubmittingRef.current) return
    setFriendGroupDialog(null)
    setFriendGroupDialogName('')
    setFriendGroupDialogError('')
    friendGroupDialogComposingRef.current = false
  }

  function handleFriendGroupDialogCompositionStart() {
    friendGroupDialogComposingRef.current = true
  }

  function handleFriendGroupDialogCompositionEnd() {
    friendGroupDialogComposingRef.current = false
  }

  function handleFriendGroupDialogKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || friendGroupDialogComposingRef.current)) event.preventDefault()
  }

  async function submitFriendGroupDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const dialog = friendGroupDialog
    if (!dialog || friendGroupDialogSubmittingRef.current) return
    const name = friendGroupDialogName.trim()
    if (!name) {
      setFriendGroupDialogError('请输入分组名称')
      return
    }
    if (name.length > 30) {
      setFriendGroupDialogError('分组名称最多 30 个字符')
      return
    }

    friendGroupDialogSubmittingRef.current = true
    setFriendGroupDialogBusy(true)
    setFriendGroupDialogError('')
    const isCreate = dialog.mode === 'create'
    const group = dialog.group
    try {
      const response = await fetch(isCreate ? '/api/friend-groups' : `/api/friend-groups/${group?.id || ''}`, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ name }),
      })
      const data = await response.json().catch(() => ({})) as { group?: FriendGroup; message?: string }
      if (!response.ok || !data.group) {
        setFriendGroupDialogError(data.message || (isCreate ? '创建失败，请重试' : '保存失败，请重试'))
        return
      }
      if (isCreate) {
        setFriendGroups((current) => current.some((item) => item.id === data.group?.id) ? current : [...current, data.group as FriendGroup])
      } else if (group) {
        setFriendGroups((current) => current.map((item) => item.id === group.id ? { ...item, name: data.group?.name || name } : item))
      }
      setFriendGroupDialog(null)
      setFriendGroupDialogName('')
      setFriendGroupDialogError('')
      friendGroupDialogComposingRef.current = false
      notifyClients('friends')
    } catch (requestError) {
      setFriendGroupDialogError(requestError instanceof TypeError ? '网络连接中断，请重试' : '操作失败，请稍后重试')
    } finally {
      friendGroupDialogSubmittingRef.current = false
      setFriendGroupDialogBusy(false)
    }
  }

  async function deleteFriendGroup(group: FriendGroup) {
    if (deletingFriendGroupId) return
    setDeletingFriendGroupId(group.id)
    setError('')
    try {
      const response = await fetch(`/api/friend-groups/${group.id}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) {
        setError(data.message || '删除分组失败，请重试')
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
      setDeleteFriendGroupTarget(null)
      notifyClients('friends')
    } catch (requestError) {
      setError(requestError instanceof TypeError ? '网络连接中断，请重试' : '删除分组失败，请稍后重试')
    } finally {
      setDeletingFriendGroupId(null)
    }
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

  const updateActiveAlphabetLetter = useCallback(() => {
    const list = friendListRef.current
    if (!list || activeTab !== 'contacts' || friendListViewMode !== 'alphabetical' || isSearchMode) {
      setActiveAlphabetLetter(null)
      return
    }

    const sections = Array.from(list.querySelectorAll<HTMLElement>('[data-friend-section]'))
    if (!sections.length) {
      setActiveAlphabetLetter(null)
      return
    }

    const listTop = list.getBoundingClientRect().top
    let currentLetter = sections[0].dataset.friendSection as FriendDirectoryLetter | undefined
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= listTop + 12) {
        currentLetter = section.dataset.friendSection as FriendDirectoryLetter
      } else {
        break
      }
    }
    setActiveAlphabetLetter((current) => current === currentLetter ? current : currentLetter || null)
  }, [activeTab, friendListViewMode, isSearchMode])

  const handleFriendListScroll = useCallback(() => {
    const list = friendListRef.current
    if (!list) return
    friendListScrollTopByModeRef.current[friendListViewMode] = list.scrollTop
    updateActiveAlphabetLetter()
  }, [friendListViewMode, updateActiveAlphabetLetter])

  const changeFriendListViewMode = useCallback((mode: FriendListViewMode) => {
    if (mode === friendListViewMode) return
    const list = friendListRef.current
    if (list) friendListScrollTopByModeRef.current[friendListViewMode] = list.scrollTop
    setFriendListReady(false)
    setLoadingList(true)
    setActiveAlphabetLetter(null)
    setFriendListViewMode(mode)
    try {
      window.localStorage.setItem(FRIEND_LIST_VIEW_MODE_STORAGE_KEY, mode)
    } catch {
      // A blocked storage area should not disable the view switch.
    }
  }, [friendListViewMode])

  const handleFriendSearchChange = useCallback((nextValue: string) => {
    setQuery(nextValue)
    setSearchResults([])
    setError('')
    setLoadingList(Boolean(nextValue.trim()))
  }, [])

  const changeFriendDockTab = useCallback((tab: FriendDockTab) => {
    setActiveTab(tab)
    setError('')
    if (tab === 'contacts') {
      setFriendListReady(false)
      setActiveAlphabetLetter(null)
    } else {
      setChatListError('')
    }
  }, [])

  useEffect(() => {
    friendsRef.current = friends
  }, [friends])

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(`friend-dock:collapsed:${currentUserId}`) === '1')
  }, [currentUserId])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FRIEND_LIST_VIEW_MODE_STORAGE_KEY)
      if (stored === 'alphabetical' || stored === 'groups') setFriendListViewMode(stored)
    } catch {
      // A blocked storage area keeps the default A-Z view.
    }
  }, [currentUserId])

  useEffect(() => {
    const list = friendListRef.current
    if (!list) return
    list.addEventListener('scroll', handleFriendListScroll, { passive: true })
    return () => list.removeEventListener('scroll', handleFriendListScroll)
  }, [handleFriendListScroll])

  useEffect(() => {
    const previousMode = previousFriendListViewModeRef.current
    previousFriendListViewModeRef.current = friendListViewMode
    if (previousMode === friendListViewMode || !open || chatFriend || activeTab !== 'contacts' || isSearchMode) return
    const frame = window.requestAnimationFrame(() => {
      const list = friendListRef.current
      if (!list) return
      list.scrollTop = friendListScrollTopByModeRef.current[friendListViewMode]
      updateActiveAlphabetLetter()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, chatFriend, friendListViewMode, isSearchMode, open, updateActiveAlphabetLetter])

  useEffect(() => {
    if (!open || chatFriend || activeTab !== 'contacts') return
    const frame = window.requestAnimationFrame(updateActiveAlphabetLetter)
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, chatFriend, friends, friendListViewMode, isSearchMode, open, updateActiveAlphabetLetter])

  useEffect(() => {
    if (!open || chatFriend || activeTab !== 'chat') return
    void loadConversations()
  }, [activeTab, chatFriend, loadConversations, open])

  useEffect(() => {
    if (!open || chatFriend || activeTab !== 'chat' || loadingConversations) return
    const frame = window.requestAnimationFrame(() => {
      if (chatListRef.current) chatListRef.current.scrollTop = chatListScrollTopRef.current
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, chatFriend, conversations, loadingConversations, open])

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
    // Keep rapid typing below the friends-list rate-limit window while the
    // server remains the final authority for abuse protection.
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 600)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!open || chatFriend || activeTab !== 'contacts') return
    const controller = new AbortController()
    if (!debouncedQuery) {
      setSearchResults([])
      void loadFriends(1, false, controller.signal, false, friendListViewMode === 'alphabetical')
    } else if (debouncedQuery.length < 2) {
      setSearchResults([])
      setLoadingList(false)
    } else {
      setLoadingList(true)
      const params = new URLSearchParams({ q: debouncedQuery })
      fetch(`/api/friends/list?${params}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
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
  }, [activeTab, open, chatFriend, debouncedQuery, friendListViewMode, loadFriends])

  useEffect(() => {
    if (!open || chatFriend || activeTab !== 'contacts' || isSearchMode || friendListViewMode !== 'groups' || !friendListReady) return
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
  }, [activeTab, chatFriend, collapsedGroupIds, friendGroups, friendListReady, friendListViewMode, groupFriends, isSearchMode, loadingGroupIds, loadGroupFriends, open, ungroupedCount])

  useEffect(() => {
    if (!open || chatFriend || activeTab !== 'contacts' || loadingList || loadingGroupIds.size > 0 || refreshingFriendList || !friendListRestorePendingRef.current) return
    if (isSearchMode) return
    let state: ReturnType<typeof parseFriendListReturnState> = null
    try {
      const raw = window.sessionStorage.getItem(FRIEND_LIST_RETURN_STATE_KEY)
      state = parseFriendListReturnState(raw)
      if (!state && friendListReturnStateRef.current) {
        state = parseFriendListReturnState(JSON.stringify(friendListReturnStateRef.current))
      }
    } catch {
      state = friendListReturnStateRef.current
        ? parseFriendListReturnState(JSON.stringify(friendListReturnStateRef.current))
        : null
    }
    if (!state) {
      clearFriendListReturnState()
      return
    }
    if (state.query !== debouncedQuery) {
      clearFriendListReturnState()
      return
    }

    const groupScopes = [
      { id: UNGROUPED_FRIEND_GROUP_ID, count: ungroupedCount },
      ...friendGroups.map((group) => ({ id: group.id, count: group.count })),
    ]
    const listDataReady = debouncedQuery
      ? true
      : friendListViewMode === 'alphabetical'
        ? friendListReady
        : friendListReady && groupScopes.every((scope) => (
          collapsedGroupIds.has(scope.id) || scope.count === 0 || groupFriends[scope.id] !== undefined
        ))
    if (!listDataReady) return

    let frame = 0
    let attempts = 0
    const restore = () => {
      const list = friendListRef.current
      if (!list) return
      const row = Array.from(list.querySelectorAll<HTMLElement>('[data-friend-id]')).find((item) => item.dataset.friendId === state?.friendId) || null
      const listRect = list.getBoundingClientRect()
      const rowRect = row?.getBoundingClientRect()
      const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
      list.scrollTop = calculateFriendListRestoredScrollTop({
        currentScrollTop: list.scrollTop,
        fallbackScrollTop: state?.scrollTop || 0,
        maxScrollTop,
        containerTop: listRect.top,
        friendTop: rowRect?.top ?? null,
        savedViewportOffset: state?.viewportOffset ?? null,
      })
      if (!row && attempts < 4) {
        attempts += 1
        frame = window.requestAnimationFrame(restore)
        return
      }
      clearFriendListReturnState()
    }
    frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, chatFriend, clearFriendListReturnState, collapsedGroupIds, debouncedQuery, friendGroups, friendListReady, friendListViewMode, groupFriends, isSearchMode, loadingGroupIds, loadingList, open, refreshingFriendList, ungroupedCount])

  useEffect(() => {
    clearFriendListReturnState()
    setOpen(false)
    setProfileFriend(null)
    resetChat()
  }, [clearFriendListReturnState, pathname, currentUserId, resetChat])

  useEffect(() => {
    const openDock = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; friend?: FriendDockUser }>).detail
      openFriendList()
      if (detail?.action === 'chat' && detail.friend) void openChatRef.current(detail.friend)
    }
    const closeFromOtherOverlay = () => closeDock()
    const updateRemark = (event: Event) => {
      const detail = (event as CustomEvent<{ targetUserId?: string; remark?: string | null }>).detail
      if (!detail?.targetUserId) return
      const friendRemark = normalizeFriendRemark(detail.remark)
      const update = (items: FriendDockUser[]) => items.map((item) => item.id === detail.targetUserId
        ? {
            ...item,
            friendRemark,
            displayName: getFriendDisplayName({
              nickname: item.nickname,
              friendRemark,
              isFriendContext: item.relationshipStatus === undefined || item.relationshipStatus === 'FRIEND',
            }),
          }
        : item)
      const updatedFriends = update(friendsRef.current)
      friendsRef.current = updatedFriends
      setFriends(updatedFriends)
      setSearchResults(update)
      setGroupFriends((groups) => Object.fromEntries(
        Object.entries(groups).map(([groupId, items]) => [groupId, update(items)]),
      ))
      setConversations((current) => current.map((conversation) => conversation.otherUser.id === detail.targetUserId
        ? {
            ...conversation,
            otherUser: {
              ...conversation.otherUser,
              friendRemark,
              displayName: getFriendDisplayName({ nickname: conversation.otherUser.nickname, friendRemark, isFriendContext: true }),
            },
          }
        : conversation))
      setChatFriend((current) => current && current.id === detail.targetUserId ? update([current])[0] : current)
      setProfileFriend((current) => current && current.id === detail.targetUserId ? update([current])[0] : current)
    }
    const refresh = (event?: Event) => {
      if (!open || chatFriend) return
      const type = (event as CustomEvent<{ type?: string }> | undefined)?.detail?.type
      if (activeTab === 'chat') {
        void loadConversations(true)
        return
      }
      if (!isSearchMode) {
        if (type !== 'unread') {
          invalidateAllGroupCaches()
          setFriendListReady(false)
        }
        void loadFriends(1, false, undefined, false, friendListViewMode === 'alphabetical')
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
          if (open && !chatFriend && (activeTab === 'chat' || !isSearchMode)) {
            if (activeTab === 'chat') void loadConversations(true)
            else void loadFriends(1, false, undefined, false, friendListViewMode === 'alphabetical')
          }
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
  }, [activeTab, currentUserId, open, chatFriend, friendListViewMode, invalidateAllGroupCaches, isSearchMode, loadConversations, loadFriends, openFriendList, closeDock])

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
      if (friendGroupDialog) {
        closeFriendGroupDialog()
        return
      }
      if (deleteChatTarget) {
        if (!deletingChatId) setDeleteChatTarget(null)
        return
      }
      if (deleteFriendGroupTarget) {
        if (!deletingFriendGroupId) setDeleteFriendGroupTarget(null)
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
    setConversations((current) => current.map((conversation) => conversation.id === id
      ? { ...conversation, unreadCount: 0 }
      : conversation))
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
    void refreshLoadedFriendGroups()
    resetChat()
  }

  function clearChatHistory() {
    if (!conversationId || !chatFriend || clearingChat || deletingChatId) return
    const existing = conversations.find((conversation) => conversation.id === conversationId)
    setDeleteChatTarget(existing || {
      id: conversationId,
      lastMessageAt: null,
      otherUser: chatFriend,
      latestMessage: null,
      unreadCount: 0,
    })
    setChatActionsOpen(false)
  }

  async function deleteConversation(target: ConversationSummary) {
    if (deletingChatId) return
    const requestSession = chatSessionRef.current
    const isOpenConversation = target.id === conversationId
    setDeletingChatId(target.id)
    if (isOpenConversation) {
      setClearingChat(true)
      setSending(false)
      setLoadingOlder(false)
    }
    setError('')
    try {
      // The existing clear endpoint persists a per-user clearedAt marker. It
      // never deletes the shared DirectMessage rows, so the other participant
      // keeps their history and a newer message can recreate this list item.
      const response = await fetch(`/api/direct-conversations/${target.id}/clear`, { method: 'POST', cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '删除聊天记录失败')
        return
      }
      setConversations((current) => current.filter((conversation) => conversation.id !== target.id))
      setFriends((current) => {
        const next = current.map((friend) => friend.conversationId === target.id
          ? { ...friend, lastMessage: null, lastMessageAt: null, unreadCount: 0 }
          : friend)
        friendsRef.current = next
        return next
      })
      setGroupFriends((current) => Object.fromEntries(
        Object.entries(current).map(([groupId, items]) => [
          groupId,
          items.map((friend) => friend.conversationId === target.id
            ? { ...friend, lastMessage: null, lastMessageAt: null, unreadCount: 0 }
            : friend),
        ]),
      ))
      if (isOpenConversation && requestSession === chatSessionRef.current) {
        setMessages([])
        setHasOlderMessages(false)
        setNewMessageNotice(false)
        cursorRef.current = ''
        beforeCursorRef.current = ''
        setChatActionsOpen(false)
      }
      setDeleteChatTarget(null)
      notifyClients('messages')
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '删除聊天记录失败')
    } finally {
      setDeletingChatId(null)
      if (isOpenConversation) setClearingChat(false)
    }
  }

  async function openChat(friend: FriendDockUser, existingConversationId?: string) {
    const chatSession = ++chatSessionRef.current
    if (activeTab === 'contacts') saveFriendListReturnState(friend.id)
    else chatListScrollTopRef.current = chatListRef.current?.scrollTop || chatListScrollTopRef.current
    setError('')
    setProfileFriend(null)
    let nextConversationId = existingConversationId || ''
    if (!nextConversationId) {
      const response = await fetch('/api/direct-conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUid: friend.uid }),
      })
      const data = await response.json().catch(() => ({}))
      if (chatSession !== chatSessionRef.current) return
      if (!response.ok) {
        clearFriendListReturnState()
        setError(data.message || '无法打开会话')
        return
      }
      nextConversationId = data.conversation.id as string
    }
    setChatFriend(friend)
    if (activeTab === 'contacts') friendListRestorePendingRef.current = true
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

  // Keep the event listener stable while still invoking the latest chat
  // closure (which contains the current conversation/session state).
  openChatRef.current = openChat

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

  async function followFriendToRoom(friend: FriendDockUser) {
    const presence = friend.undercoverPresence
    if (!presence || presence.status !== 'WAITING' || !presence.canJoin) return
    setError('')
    let password = ''
    if (presence.requiresPassword) {
      const prompted = window.prompt(`输入「${getFriendDisplayName({ nickname: friend.nickname, friendRemark: friend.friendRemark, isFriendContext: true })}」的房间密码以加入`) as string | null
      if (prompted === null) return
      password = prompted
    }
    try {
      const response = await fetch('/api/entertainment/undercover-star/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: presence.roomCode, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || data.message || '加入好友房间失败')
        return
      }
      // 加入成功后直接进入卧底巨星大厅；客户端会自动恢复 activeRoom。
      router.push('/games/undercover-star')
    } catch (followError) {
      setError(followError instanceof Error ? followError.message : '加入好友房间失败')
    }
  }

  function updateFriendRelationship(friendId: string, relationshipStatus: RelationshipStatus) {
    const update = (items: FriendDockUser[]) => items.map((item) => item.id === friendId
      ? {
          ...item,
          relationshipStatus,
          requestId: relationshipStatus === 'INCOMING_PENDING' ? item.requestId || null : null,
        }
      : item)
    setFriends((current) => {
      const next = update(current)
      friendsRef.current = next
      return next
    })
    setSearchResults(update)
    setProfileFriend((current) => current && current.id === friendId
      ? { ...update([current])[0], relationshipStatus }
      : current)
  }

  async function decideRequest(friend: FriendDockUser, action: 'accept' | 'reject') {
    if (!friend.requestId) return
    const response = await fetch(`/api/friends/requests/${friend.requestId}/${action}`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message || '好友申请处理失败')
      return
    }
    updateFriendRelationship(friend.id, action === 'accept' ? 'FRIEND' : 'NONE')
    notifyClients('friends')
  }

  function scrollToBottom(behavior: ScrollBehavior) {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior })
    nearBottomRef.current = true
    setNewMessageNotice(false)
  }

  const visibleUsers = isSearchMode ? searchResults : friends
  const alphabeticalFriendSections = useMemo(() => groupFriendsByLetter(
    friends,
    (friend) => getFriendDisplayName({
      nickname: friend.nickname,
      friendRemark: friend.friendRemark,
      isFriendContext: friend.relationshipStatus === undefined || friend.relationshipStatus === 'FRIEND',
    }),
  ), [friends])
  const alphabeticalLetters = useMemo(
    () => alphabeticalFriendSections.map((section) => section.letter),
    [alphabeticalFriendSections],
  )
  const scrollToAlphabetLetter = useCallback((requestedLetter: FriendDirectoryLetter) => {
    const list = friendListRef.current
    const targetLetter = resolveFriendIndexTarget(requestedLetter, alphabeticalLetters)
    if (!list || !targetLetter) return
    const section = Array.from(list.querySelectorAll<HTMLElement>('[data-friend-section]'))
      .find((item) => item.dataset.friendSection === targetLetter)
    if (!section) return
    const listRect = list.getBoundingClientRect()
    const sectionRect = section.getBoundingClientRect()
    list.scrollTo({
      top: Math.max(0, list.scrollTop + sectionRect.top - listRect.top),
      left: 0,
      behavior: 'auto',
    })
    setActiveAlphabetLetter(targetLetter)
  }, [alphabeticalLetters])
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
                <SafeAvatar src={profileImageUrl(chatFriend.profile?.avatarUrl || chatFriend.avatarUrl)} name={getFriendDisplayName({ nickname: chatFriend.nickname, friendRemark: chatFriend.friendRemark, isFriendContext: true })} className="h-8 w-8" />
                <span><strong><UserDisplayName name={getFriendDisplayName({ nickname: chatFriend.nickname, friendRemark: chatFriend.friendRemark, isFriendContext: true })} uid={chatFriend.uid} badges={chatFriend.equippedBadges} badge={chatFriend.equippedBadge} compact /></strong><small>{chatFriend.isOnline ? '在线' : chatFriend.levelName}</small></span>
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
                aria-label={unreadSummaryAvailable && unreadSummary.total > 0 ? `通知中心，${unreadSummary.total}条未读` : '通知中心'}
              >
                <span>通知中心</span>
                {unreadSummaryAvailable && unreadSummary.total > 0 ? (
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
            <>
              <nav className="friend-dock-primary-tabs" role="tablist" aria-label="好友与私信栏目">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'chat'}
                  className={activeTab === 'chat' ? 'is-active' : undefined}
                  onClick={() => changeFriendDockTab('chat')}
                >聊天</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'contacts'}
                  className={activeTab === 'contacts' ? 'is-active' : undefined}
                  onClick={() => changeFriendDockTab('contacts')}
                >通讯录</button>
              </nav>
              {activeTab === 'chat' ? (
                <div className="friend-list-layout friend-chat-list-layout">
                  <div
                    ref={chatListRef}
                    className="friend-dock-list friend-chat-list"
                    onScroll={(event) => { chatListScrollTopRef.current = event.currentTarget.scrollTop }}
                  >
                    {loadingConversations ? <p className="friend-dock-empty">加载中…</p> : null}
                    {!loadingConversations && chatListError ? (
                      <div className="friend-chat-list-error" role="alert">
                        <p>{chatListError}</p>
                        <button type="button" onClick={() => void loadConversations()}>重试</button>
                      </div>
                    ) : null}
                    {!loadingConversations && !chatListError && conversationsLoaded && !conversations.length ? (
                      <div className="friend-chat-list-empty">
                        <p>暂无聊天</p>
                        <small>有新的私信后会显示在这里</small>
                      </div>
                    ) : null}
                    {!loadingConversations && !chatListError ? conversations.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        onOpen={() => void openChat(conversation.otherUser, conversation.id)}
                        onDelete={() => setDeleteChatTarget(conversation)}
                      />
                    )) : null}
                    <div className="friend-dock-list-end" aria-hidden="true" />
                  </div>
                </div>
              ) : (
            <div className="friend-list-layout">
            <div className="friend-dock-search">
              <input value={query} onChange={(event) => handleFriendSearchChange(event.target.value)} placeholder="搜索好友或其他用户" aria-label="搜索好友或其他用户" />
              {query ? <button type="button" onClick={() => handleFriendSearchChange('')} aria-label="清空搜索">×</button> : null}
            </div>
            {!isSearchMode ? (
              <div className="friend-dock-group-toolbar">
                <div className="friend-dock-view-switch" role="group" aria-label="好友列表查看方式">
                  <button
                    type="button"
                    className={friendListViewMode === 'alphabetical' ? 'is-active' : undefined}
                    aria-pressed={friendListViewMode === 'alphabetical'}
                    onClick={() => changeFriendListViewMode('alphabetical')}
                  >A-Z</button>
                  <button
                    type="button"
                    className={friendListViewMode === 'groups' ? 'is-active' : undefined}
                    aria-pressed={friendListViewMode === 'groups'}
                    onClick={() => changeFriendListViewMode('groups')}
                  >分组</button>
                </div>
                <button type="button" onClick={() => openFriendGroupDialog('create')}>新建分组</button>
              </div>
            ) : null}
            <div className="friend-dock-list-region">
            <div ref={friendListRef} className="friend-dock-list">
              {isSearchMode ? visibleUsers.map((friend) => (
                <FriendRow
                  key={friend.id}
                  friend={friend}
                  groups={friendGroups}
                  searching
                  onProfile={() => setProfileFriend(friend)}
                  onChat={() => void openChat(friend)}
                  onMove={(groupId) => void moveFriendToGroup(friend, groupId)}
                  onDecide={(action) => void decideRequest(friend, action)}
                  onRelationshipChange={(status) => updateFriendRelationship(friend.id, status)}
                  onFollow={() => void followFriendToRoom(friend)}
                />
              )) : friendListViewMode === 'alphabetical' ? (
                friendListReady ? alphabeticalFriendSections.map((section) => (
                <section key={section.letter} className="friend-dock-alpha-section" data-friend-section={section.letter}>
                  <h3 className="friend-dock-alpha-header">{section.letter}</h3>
                  {section.friends.map((friend) => (
                    <FriendRow
                      key={friend.id}
                      friend={friend}
                      groups={friendGroups}
                      searching={false}
                      onProfile={() => setProfileFriend(friend)}
                      onChat={() => void openChat(friend)}
                      onMove={(groupId) => void moveFriendToGroup(friend, groupId)}
                      onDecide={(action) => void decideRequest(friend, action)}
                      onRelationshipChange={(status) => updateFriendRelationship(friend.id, status)}
                      onFollow={() => void followFriendToRoom(friend)}
                    />
                  ))}
                </section>
                )) : null
              ) : groupedFriendSections.map((group) => {
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
                          <button type="button" onClick={() => openFriendGroupDialog('rename', group)} aria-label={`重命名${group.name}`}>重命名</button>
                          <button type="button" onClick={() => setDeleteFriendGroupTarget(group)} aria-label={`删除${group.name}`}>删除</button>
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
                        onDecide={(action) => void decideRequest(friend, action)}
                        onRelationshipChange={(status) => updateFriendRelationship(friend.id, status)}
                        onFollow={() => void followFriendToRoom(friend)}
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
              {!loadingList && !visibleUsers.length ? <p className="friend-dock-empty">{isSearchMode ? (query.trim().length < 2 ? '请输入至少 2 个字符' : '没有找到匹配用户') : '暂无好友'}</p> : null}
              <div className="friend-dock-list-end" aria-hidden="true" />
            </div>
            {!isSearchMode && friendListViewMode === 'alphabetical' && friendListReady && alphabeticalFriendSections.length ? (
              <FriendAlphabetIndex activeLetter={activeAlphabetLetter} onSelect={scrollToAlphabetLetter} />
            ) : null}
            </div>
            </div>
              )}
            </>
          )}
        </div>
        {error ? <p className="friend-dock-error">{error}<button type="button" onClick={() => setError('')}>×</button></p> : null}
        {profileFriend ? <FriendProfileCard
          friend={profileFriend}
          onClose={() => setProfileFriend(null)}
          onNavigate={closeDock}
          onMessage={() => void openChat(profileFriend)}
          onRelationshipChange={(status) => updateFriendRelationship(profileFriend.id, status)}
        /> : null}
        <ConfirmDialog
          open={Boolean(deleteFriendGroupTarget)}
          title="删除分组？"
          description="删除分组不会删除好友，好友将移回未分组。"
          confirmLabel="确认删除"
          loading={Boolean(deletingFriendGroupId)}
          onConfirm={() => {
            if (deleteFriendGroupTarget) void deleteFriendGroup(deleteFriendGroupTarget)
          }}
          onCancel={() => {
            if (!deletingFriendGroupId) setDeleteFriendGroupTarget(null)
          }}
        />
        <ConfirmDialog
          open={Boolean(deleteChatTarget)}
          title="删除聊天？"
          description={deleteChatTarget
            ? `确认删除与「${getFriendDisplayName({ nickname: deleteChatTarget.otherUser.nickname, friendRemark: deleteChatTarget.otherUser.friendRemark, isFriendContext: true })}」的聊天吗？\n删除后，你这边的聊天记录将一并删除，无法恢复。`
            : undefined}
          confirmLabel="确认删除"
          loading={Boolean(deletingChatId)}
          onConfirm={() => {
            if (deleteChatTarget) void deleteConversation(deleteChatTarget)
          }}
          onCancel={() => {
            if (!deletingChatId) setDeleteChatTarget(null)
          }}
        />
      </section>
      <FriendGroupDialog
        open={Boolean(friendGroupDialog)}
        mode={friendGroupDialog?.mode || 'create'}
        name={friendGroupDialogName}
        error={friendGroupDialogError}
        busy={friendGroupDialogBusy}
        onNameChange={(event) => {
          setFriendGroupDialogName(event.target.value)
          if (friendGroupDialogError) setFriendGroupDialogError('')
        }}
        onSubmit={(event) => void submitFriendGroupDialog(event)}
        onCancel={closeFriendGroupDialog}
        onCompositionStart={handleFriendGroupDialogCompositionStart}
        onCompositionEnd={handleFriendGroupDialogCompositionEnd}
        onKeyDown={handleFriendGroupDialogKeyDown}
      />
    </>,
    document.body,
  ) : null

  return (
    <div className={`friend-dock ${collapsed ? 'is-collapsed' : ''}`} data-friend-dock-open={open || undefined}>
      {overlay}
      {!open && collapsed ? (
        <button ref={toggleRef} type="button" className="friend-dock-toggle is-handle" onClick={() => setCollapsed(false)} aria-label="展开好友入口">
          ‹{friendDockUnreadCount !== null && friendDockUnreadCount > 0 ? <span className="friend-dock-unread-dot" /> : null}
        </button>
      ) : !open || !isMobileDrawer ? (
        <div className="friend-dock-actions">
          <button ref={toggleRef} type="button" className="friend-dock-toggle" onClick={open ? closeDock : openFriendList} aria-label={open ? '关闭好友窗口' : '打开好友窗口'} aria-expanded={open}>
            好友{friendDockUnreadCount !== null && friendDockUnreadCount > 0 ? <b>{friendDockUnreadCount > 99 ? '99+' : friendDockUnreadCount}</b> : null}
          </button>
          <button type="button" className="friend-dock-collapse" onClick={() => { closeDock(); setCollapsed(true) }} aria-label="收起好友入口">›</button>
        </div>
      ) : null}
    </div>
  )
}

function ConversationRow({
  conversation,
  onOpen,
  onDelete,
}: {
  conversation: ConversationSummary
  onOpen: () => void
  onDelete: () => void
}) {
  const longPressTimerRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const peer = conversation.otherUser
  const name = getFriendDisplayName({ nickname: peer.nickname, friendRemark: peer.friendRemark, isFriendContext: true })
  const preview = conversation.latestMessage?.preview
    || (conversation.latestMessage?.type === 'STICKER' ? '[表情]' : conversation.latestMessage?.content || '[消息]')

  useEffect(() => () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
    pointerStartRef.current = null
  }, [])

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    pointerStartRef.current = null
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    cancelLongPress()
    if (event.pointerType !== 'touch') return
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      pointerStartRef.current = null
      longPressTriggeredRef.current = true
      onDelete()
    }, 600)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current
    if (!start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelLongPress()
  }

  const handleClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    onOpen()
  }

  return (
    <article data-conversation-id={conversation.id} className={`friend-chat-row ${conversation.unreadCount ? 'has-unread' : ''}`}>
      <button
        type="button"
        className="friend-chat-row-main"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onContextMenu={(event) => {
          event.preventDefault()
          onDelete()
        }}
        aria-label={`打开与${name}的聊天`}
      >
        <SafeAvatar src={profileImageUrl(peer.profile?.avatarUrl || peer.avatarUrl)} name={name} uid={peer.uid} className="friend-chat-row-avatar" />
        <span className="friend-chat-row-copy">
          <span className="friend-chat-row-heading">
            <strong><UserDisplayName name={name} uid={peer.uid} badges={peer.equippedBadges} badge={peer.equippedBadge} compact /></strong>
            {conversation.lastMessageAt ? <time>{formatConversationTime(conversation.lastMessageAt)}</time> : null}
          </span>
          <span className="friend-chat-row-preview">
            <span>{preview}</span>
            {conversation.unreadCount > 0 ? <b>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</b> : null}
          </span>
        </span>
      </button>
      <button type="button" className="friend-chat-row-actions" onClick={onDelete} aria-label={`删除与${name}的聊天`} title="删除聊天">⋯</button>
    </article>
  )
}

function FriendRow({
  friend,
  groups,
  searching,
  onProfile,
  onChat,
  onMove,
  onDecide,
  onRelationshipChange,
  onFollow,
}: {
  friend: FriendDockUser
  groups: FriendGroup[]
  searching: boolean
  onProfile: () => void
  onChat: () => void
  onMove: (groupId: string | null) => void
  onDecide: (action: 'accept' | 'reject') => void
  onRelationshipChange: (status: RelationshipStatus) => void
  onFollow: () => void
}) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const status = friend.relationshipStatus || 'FRIEND'
  const name = getFriendDisplayName({ nickname: friend.nickname, friendRemark: friend.friendRemark, isFriendContext: status === 'FRIEND' })
  const avatar = profileImageUrl(friend.profile?.avatarUrl || friend.avatarUrl)
  const presence = friend.undercoverPresence
  return (
    <article data-friend-id={friend.id} className={`friend-dock-row ${friend.unreadCount ? 'has-unread' : ''}`}>
      <button type="button" className="friend-dock-avatar-button" onClick={onProfile} aria-label={`查看${name}的资料卡`}>
        <SafeAvatar src={avatar} name={name} className="h-full w-full" />
      </button>
      <div className="friend-dock-row-main">
        <button type="button" className="friend-dock-row-name" onClick={status === 'FRIEND' ? onChat : onProfile}>
          <strong><UserDisplayName name={name} uid={friend.uid} badges={friend.equippedBadges} badge={friend.equippedBadge} compact /></strong>
          <small>UID {formatUid(friend.uid)} · {friend.levelName || '初入E院'}</small>
        </button>
        {!searching ? (
          presence ? (
            <UndercoverPresenceLine presence={presence} onFollow={onFollow} />
          ) : (
            <button type="button" className="friend-dock-conversation-preview" onClick={onChat}>
              <span>{!friend.lastMessage ? '暂无私信' : (friend.lastMessage.type === 'STICKER' ? '[表情]' : friend.lastMessage.content)}</span>
              {friend.lastMessageAt ? <time>{formatConversationTime(friend.lastMessageAt)}</time> : null}
            </button>
          )
        ) : <RelationshipActions uid={friend.uid} targetName={name} status={status} onChat={onChat} onDecide={onDecide} onStatusChange={onRelationshipChange} />}
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

function UndercoverPresenceLine({ presence, onFollow }: { presence: UndercoverPresence; onFollow: () => void }) {
  const isWaiting = presence.status === 'WAITING'
  return (
    <div className="friend-dock-presence">
      <span className="friend-dock-presence-label">{isWaiting ? '卧底巨星 · 房间中' : '卧底巨星 · 游戏中'}</span>
      {isWaiting ? (
        presence.canJoin ? (
          <button type="button" className="friend-dock-presence-follow" onClick={onFollow}>跟随进入</button>
        ) : (
          <span className="friend-dock-presence-full">房间已满</span>
        )
      ) : null}
    </div>
  )
}

function RelationshipActions({
  uid,
  targetName,
  status,
  onChat,
  onDecide,
  onStatusChange,
}: {
  uid: number
  targetName: string
  status: RelationshipStatus
  onChat: () => void
  onDecide: (action: 'accept' | 'reject') => void
  onStatusChange: (status: RelationshipStatus) => void
}) {
  if (status === 'FRIEND') return <div className="friend-relationship-actions"><span>已是好友</span><button type="button" onClick={onChat}>发私信</button></div>
  if (status === 'OUTGOING_PENDING') return <div className="friend-relationship-actions"><span>还不是好友</span><button type="button" disabled>已发送申请</button></div>
  if (status === 'INCOMING_PENDING') return <div className="friend-relationship-actions"><span>对方申请添加你</span><button type="button" onClick={() => onDecide('accept')}>同意</button><button type="button" onClick={() => onDecide('reject')}>拒绝</button></div>
  if (status === 'SELF') return <div className="friend-relationship-actions"><span>这是你自己</span></div>
  if (status === 'BLOCKED') return <div className="friend-relationship-actions"><span>无法添加</span></div>
  return <div className="friend-relationship-actions"><span>还不是好友</span><AddFriendButton uid={uid} targetName={targetName} initialStatus="NONE" onStatusChange={(next) => onStatusChange(next === 'PENDING' ? 'OUTGOING_PENDING' : next === 'RECEIVED' ? 'INCOMING_PENDING' : next)} /></div>
}

const FRIEND_LIST_VIEW_MODE_STORAGE_KEY = 'friendListViewMode'

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
