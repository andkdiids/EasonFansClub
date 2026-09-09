'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UiIcon } from '@/components/UiIcon'
import { getFriendDisplayName } from '@/lib/friend-display-name'
import { groupFriendsByLetter, type FriendDirectoryLetter } from '@/lib/friend-directory'
import type { ShareCardData } from '@/lib/share-card'

type RecentFriend = {
  id: string
  uid: number
  nickname: string
  displayName: string
  avatarUrl: string | null
  lastMessageAt: string
}

type ContactFriend = {
  id: string
  uid: number
  nickname: string
  displayName?: string | null
  friendRemark?: string | null
  avatarUrl: string | null
  relationshipStatus?: string | null
  groupId?: string | null
}

type ShareRecipient = {
  id: string
  uid: number
  displayName: string
  avatarUrl: string | null
}

type FriendGroup = {
  id: string
  name: string
  count?: number
}

type Props = Readonly<{
  open: boolean
  data: ShareCardData
  canSaveCard?: boolean
  onClose: () => void
  onCreateCard: () => void
  onCopyLink: () => void
  onShareSuccess: (displayName: string) => void
}>

type ShareResponse = {
  message?: string
  recentFriends?: RecentFriend[]
}

function createClientMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getContactName(friend: ContactFriend) {
  return friend.displayName?.trim() || getFriendDisplayName({
    nickname: friend.nickname,
    friendRemark: friend.friendRemark,
    isFriendContext: true,
  })
}

function isFriendResult(friend: ContactFriend) {
  return !friend.relationshipStatus || friend.relationshipStatus === 'FRIEND'
}

export function PostShareSheet({ open, data, canSaveCard = true, onClose, onCreateCard, onCopyLink, onShareSuccess }: Props) {
  const postId = data.contentId || ''
  const [view, setView] = useState<'recent' | 'contacts'>('recent')
  const [recentFriends, setRecentFriends] = useState<RecentFriend[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentError, setRecentError] = useState('')
  const [contacts, setContacts] = useState<ContactFriend[]>([])
  const [groups, setGroups] = useState<FriendGroup[]>([])
  const [contactHasMore, setContactHasMore] = useState(false)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsError, setContactsError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedLetter, setSelectedLetter] = useState<FriendDirectoryLetter | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [selectedFriend, setSelectedFriend] = useState<ShareRecipient | null>(null)
  const [shareError, setShareError] = useState('')
  const requestIdRef = useRef(0)
  const contactsRequestIdRef = useRef(0)
  const contactPageRef = useRef(1)
  const sendingIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, open])

  const loadRecentFriends = useCallback(async () => {
    if (!postId) return
    const requestId = ++requestIdRef.current
    setRecentLoading(true)
    setRecentError('')
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/share`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const result = await response.json().catch(() => ({})) as ShareResponse
      if (requestId !== requestIdRef.current) return
      if (!response.ok) throw new Error(result.message || '最近聊天好友加载失败')
      setRecentFriends(Array.isArray(result.recentFriends) ? result.recentFriends : [])
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setRecentFriends([])
        setRecentError(error instanceof Error ? error.message : '最近聊天好友加载失败')
      }
    } finally {
      if (requestId === requestIdRef.current) setRecentLoading(false)
    }
  }, [postId])

  const loadContacts = useCallback(async (append = false) => {
    const requestId = ++contactsRequestIdRef.current
    const nextPage = append ? contactPageRef.current + 1 : 1
    const params = new URLSearchParams({ page: String(nextPage), pageSize: '30' })
    const trimmedQuery = query.trim()
    if (trimmedQuery.length >= 2) params.set('q', trimmedQuery)
    if (selectedGroupId && trimmedQuery.length < 2) params.set('groupId', selectedGroupId)
    setContactsLoading(true)
    setContactsError('')
    try {
      const response = await fetch(`/api/friends/list?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const result = await response.json().catch(() => ({})) as {
        friends?: ContactFriend[]
        results?: ContactFriend[]
        groups?: FriendGroup[]
        hasMore?: boolean
        page?: number
      }
      if (requestId !== contactsRequestIdRef.current) return
      if (!response.ok) throw new Error(typeof result === 'object' && result && 'message' in result ? String((result as { message?: unknown }).message || '好友列表加载失败') : '好友列表加载失败')
      const incoming = (Array.isArray(result.friends) ? result.friends : Array.isArray(result.results) ? result.results : []).filter(isFriendResult)
      setContacts((current) => {
        if (!append) return incoming
        const existing = new Set(current.map((friend) => friend.id))
        return [...current, ...incoming.filter((friend) => !existing.has(friend.id))]
      })
      if (Array.isArray(result.groups)) setGroups(result.groups)
      const resolvedPage = Number.isSafeInteger(result.page) ? Number(result.page) : nextPage
      contactPageRef.current = resolvedPage
      setContactHasMore(Boolean(result.hasMore))
    } catch (error) {
      if (requestId === contactsRequestIdRef.current) setContactsError(error instanceof Error ? error.message : '好友列表加载失败')
    } finally {
      if (requestId === contactsRequestIdRef.current) setContactsLoading(false)
    }
  }, [query, selectedGroupId])

  useEffect(() => {
    if (!open) return undefined
    requestIdRef.current += 1
    setView('recent')
    setQuery('')
    setSelectedGroupId('')
    setSelectedLetter(null)
    setSelectedFriend(null)
    setShareError('')
    setContacts([])
    setGroups([])
    contactPageRef.current = 1
    setContactHasMore(false)
    setContactsError('')
    void loadRecentFriends()
    return undefined
  }, [loadRecentFriends, open])

  useEffect(() => {
    if (!open || view !== 'contacts') return undefined
    const timer = window.setTimeout(() => { void loadContacts(false) }, 220)
    return () => window.clearTimeout(timer)
  }, [loadContacts, open, query, selectedGroupId, view])

  const contactSections = useMemo(() => groupFriendsByLetter(contacts, getContactName), [contacts])
  const availableLetters = useMemo(() => contactSections.map((section) => section.letter), [contactSections])
  const visibleContacts = useMemo(() => {
    const flattened = contactSections.flatMap((section) => section.friends)
    const trimmedQuery = query.trim().toLocaleLowerCase()
    return flattened.filter((friend) => {
      if (selectedLetter && friend.indexLetter !== selectedLetter) return false
      if (selectedGroupId && friend.groupId !== selectedGroupId) return false
      if (trimmedQuery.length !== 1) return true
      const displayName = getContactName(friend).toLocaleLowerCase()
      return displayName.includes(trimmedQuery) || String(friend.uid).includes(trimmedQuery)
    })
  }, [contactSections, query, selectedGroupId, selectedLetter])

  async function shareWithFriend(friend: ShareRecipient) {
    if (!postId || sendingId || sendingIdRef.current) return
    sendingIdRef.current = friend.id
    setSendingId(friend.id)
    setShareError('')
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/share`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ recipientId: friend.id, clientMessageId: createClientMessageId() }),
      })
      const result = await response.json().catch(() => ({})) as { message?: unknown; error?: unknown }
      if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : typeof result.error === 'string' ? result.error : '分享失败，请稍后重试')
      setSelectedFriend(null)
      onShareSuccess(friend.displayName)
    } catch (error) {
      const message = error instanceof Error ? error.message : '分享失败，请稍后重试'
      setShareError(message)
      setContactsError(message)
      setRecentError(message)
    } finally {
      sendingIdRef.current = null
      setSendingId(null)
    }
  }

  function selectFriend(friend: ShareRecipient) {
    if (sendingId || sendingIdRef.current) return
    setShareError('')
    setSelectedFriend(friend)
  }

  function cancelFriendShare() {
    if (sendingId) return
    setSelectedFriend(null)
    setShareError('')
  }

  function openContacts() {
    setView('contacts')
    setSelectedLetter(null)
    setShareError('')
  }

  function returnToRecent() {
    setView('recent')
    setContactsError('')
    setRecentError('')
    setShareError('')
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="post-share-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section className="post-share-sheet" role="dialog" aria-modal="true" aria-labelledby="post-share-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="post-share-header">
          <div>
            {view === 'contacts' ? <button type="button" className="post-share-back" onClick={returnToRecent}>← 返回</button> : null}
            <h2 id="post-share-title">{view === 'contacts' ? '选择好友' : '分享给'}</h2>
          </div>
          <button type="button" className="share-method-close" onClick={onClose} aria-label="关闭分享面板">×</button>
        </header>

        {view === 'recent' ? (
          <div className="post-share-recent-section">
            <div className="post-share-section-heading"><strong>最近聊天好友</strong><small>直接分享给好友</small></div>
            {recentLoading ? <p className="post-share-status">加载中…</p> : null}
            {recentError ? <p className="post-share-error" role="alert">{recentError}</p> : null}
            {!recentLoading && !recentFriends.length && !recentError ? <p className="post-share-status">暂无最近好友</p> : null}
            {recentFriends.length ? (
              <div className="post-share-recent-list" aria-label="最近聊天好友">
                {recentFriends.map((friend) => (
                  <button key={friend.id} type="button" className="post-share-recent-friend" onClick={() => selectFriend(friend)} disabled={Boolean(sendingId)}>
                    <span className="post-share-avatar"><SafeAvatar src={friend.avatarUrl} name={friend.displayName} uid={friend.uid} className="h-full w-full" /></span>
                    <span title={friend.displayName}>{friend.displayName}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" className="post-share-contact-entry" onClick={openContacts} disabled={Boolean(sendingId)}>
              <span className="post-share-contact-icon" aria-hidden="true"><UiIcon name="friends" /></span>
              <span><strong>私信好友</strong><small>从通讯录选择好友</small></span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        ) : (
          <div className="post-share-contacts-section">
            <label className="post-share-search">
              <span className="sr-only">搜索好友</span>
              <input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedLetter(null) }} placeholder="搜索昵称、备注或 UID" autoFocus />
              {query ? <button type="button" onClick={() => setQuery('')} aria-label="清除搜索">×</button> : null}
            </label>
            {groups.length ? (
              <div className="post-share-group-filters" aria-label="好友分组">
                <button type="button" className={!selectedGroupId ? 'is-active' : undefined} onClick={() => { setSelectedGroupId(''); setSelectedLetter(null) }}>全部</button>
                {groups.map((group) => <button key={group.id} type="button" className={selectedGroupId === group.id ? 'is-active' : undefined} onClick={() => { setSelectedGroupId(group.id); setSelectedLetter(null) }}>{group.name}</button>)}
              </div>
            ) : null}
            {availableLetters.length > 1 ? (
              <div className="post-share-letter-index" aria-label="按首字母筛选">
                <button type="button" className={!selectedLetter ? 'is-active' : undefined} onClick={() => setSelectedLetter(null)}>全部</button>
                {availableLetters.map((letter) => <button key={letter} type="button" className={selectedLetter === letter ? 'is-active' : undefined} onClick={() => setSelectedLetter(letter)}>{letter}</button>)}
              </div>
            ) : null}
            {contactsLoading && !contacts.length ? <p className="post-share-status">加载好友中…</p> : null}
            {contactsError ? <p className="post-share-error" role="alert">{contactsError}</p> : null}
            {!contactsLoading && !visibleContacts.length && !contactsError ? <p className="post-share-status">没有找到可分享的好友</p> : null}
            <div className="post-share-contact-list">
              {visibleContacts.map((friend) => {
                const displayName = getContactName(friend)
                return (
                  <button key={friend.id} type="button" className="post-share-contact-friend" onClick={() => selectFriend({ id: friend.id, uid: friend.uid, displayName, avatarUrl: friend.avatarUrl })} disabled={Boolean(sendingId)}>
                    <span className="post-share-avatar"><SafeAvatar src={friend.avatarUrl} name={displayName} uid={friend.uid} className="h-full w-full" /></span>
                    <span className="post-share-contact-copy"><strong>{displayName}</strong><small>UID {friend.uid}</small></span>
                    <span className="post-share-contact-send">分享</span>
                  </button>
                )
              })}
            </div>
            {contactHasMore && !query.trim() && !selectedGroupId ? <button type="button" className="post-share-load-more" onClick={() => { void loadContacts(true) }} disabled={contactsLoading}>{contactsLoading ? '加载中…' : '加载更多好友'}</button> : null}
          </div>
        )}

        <footer className="post-share-footer">
          <button type="button" className="post-share-footer-action" onClick={onCreateCard} disabled={!canSaveCard || Boolean(sendingId)}>
            <span aria-hidden="true">▧</span>生成分享卡片
          </button>
          <button type="button" className="post-share-footer-action" onClick={onCopyLink} disabled={Boolean(sendingId)}>
            <span aria-hidden="true">⧉</span>复制链接
          </button>
        </footer>
      </section>
      {selectedFriend ? (
        <div
          className="post-share-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) cancelFriendShare() }}
        >
          <section
            className="post-share-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="post-share-confirm-title"
            aria-describedby="post-share-confirm-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="post-share-confirm-header">
              <h2 id="post-share-confirm-title">确认分享</h2>
            </header>
            <div className="post-share-confirm-recipient">
              <span className="post-share-avatar"><SafeAvatar src={selectedFriend.avatarUrl} name={selectedFriend.displayName} uid={selectedFriend.uid} className="h-full w-full" /></span>
              <div>
                <strong>{selectedFriend.displayName}</strong>
                <small>好友</small>
              </div>
            </div>
            <p id="post-share-confirm-description" className="post-share-confirm-copy">确定要把这篇帖子分享给该好友吗？</p>
            {data.title ? <p className="post-share-confirm-title">「{data.title}」</p> : null}
            {shareError ? <p className="post-share-confirm-error" role="alert">{shareError}</p> : null}
            <footer className="post-share-confirm-actions">
              <button type="button" className="post-share-confirm-action" onClick={cancelFriendShare} disabled={Boolean(sendingId)}>取消</button>
              <button type="button" className="post-share-confirm-action post-share-confirm-action-primary" onClick={() => { void shareWithFriend(selectedFriend) }} disabled={Boolean(sendingId)}>
                {sendingId ? '发送中…' : '发送'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
