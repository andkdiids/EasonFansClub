'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { AddFriendButton, FriendRequestDecision } from '@/components/FriendRequestActions'
import type { FriendDockUser } from '@/lib/friend-types'
import type { RelationshipStatus } from '@/lib/friend-types'
import { profileImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import { UserDisplayName } from '@/components/UserDisplayName'
import { getFriendDisplayName } from '@/lib/friend-display-name'

const FRIEND_PROFILE_HISTORY_KEY = '__easonFriendProfileCard'
const FRIEND_REQUEST_REASON_OPEN_KEY = '__easonFriendRequestReasonDialogOpen'

export function FriendProfileCard({
  friend,
  onClose,
  onMessage,
  onNavigate,
  showMessage = true,
  unavailableMessage,
  loading = false,
  error,
  onRetry,
  onRelationshipChange,
}: Readonly<{
  friend: FriendDockUser
  onClose: () => void
  onMessage?: () => void
  onNavigate: () => void
  showMessage?: boolean
  unavailableMessage?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onRelationshipChange?: (status: RelationshipStatus) => void
}>) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const previousHistoryStateRef = useRef<unknown>(null)
  onCloseRef.current = onClose
  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousState = window.history.state
    previousHistoryStateRef.current = previousState
    window.history.pushState({
      ...(previousState && typeof previousState === 'object' ? previousState : {}),
      [FRIEND_PROFILE_HISTORY_KEY]: true,
    }, '')
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if ((window as Window & { [FRIEND_REQUEST_REASON_OPEN_KEY]?: boolean })[FRIEND_REQUEST_REASON_OPEN_KEY]) return
      onCloseRef.current()
    }
    const handlePopState = () => {
      if ((window as Window & { [FRIEND_REQUEST_REASON_OPEN_KEY]?: boolean })[FRIEND_REQUEST_REASON_OPEN_KEY]) return
      onCloseRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('popstate', handlePopState)
      if (window.history.state?.[FRIEND_PROFILE_HISTORY_KEY]) {
        window.history.replaceState(previousHistoryStateRef.current, '')
      }
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [friend.id])

  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const scrollY = window.scrollY
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPosition = body.style.position
    const previousBodyTop = body.style.top
    const previousBodyWidth = body.style.width
    const shouldFixBody = window.matchMedia?.('(max-width: 767px)').matches === true && body.style.position !== 'fixed'

    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    if (shouldFixBody) {
      body.style.position = 'fixed'
      body.style.top = `-${scrollY}px`
      body.style.width = '100%'
    }

    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
      body.style.position = previousBodyPosition
      body.style.top = previousBodyTop
      body.style.width = previousBodyWidth
      if (shouldFixBody) window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' })
    }
  }, [friend.id])

  const status = friend.relationshipStatus || 'FRIEND'
  const name = getFriendDisplayName({ nickname: friend.nickname, friendRemark: friend.friendRemark, isFriendContext: status === 'FRIEND' })
  const avatar = profileImageUrl(friend.profile?.avatarUrl || friend.avatarUrl)
  const bio = friend.profile?.bio || friend.bio || '这个成员还没有填写个人简介。'
  const statusLabel = status === 'SELF'
    ? '本人'
    : status === 'FRIEND'
      ? '好友'
      : status === 'OUTGOING_PENDING'
        ? '已发送好友申请'
        : status === 'INCOMING_PENDING'
          ? '收到好友申请'
          : status === 'BLOCKED'
            ? '已屏蔽'
            : '非好友'
  const reportRelationshipChange = (next: 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED') => {
    onRelationshipChange?.(next === 'PENDING' ? 'OUTGOING_PENDING' : next === 'RECEIVED' ? 'INCOMING_PENDING' : next)
  }

  const content = (
    <div
      className="friend-profile-card-layer"
      role="presentation"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="friend-profile-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friend-profile-card-name"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" className="friend-profile-card-close" onClick={onClose} aria-label="关闭好友资料卡">×</button>
        <div className="friend-profile-card-avatar">
          <SafeAvatar src={avatar} name={name} uid={friend.uid} className="h-full w-full" />
        </div>
        <h2 id="friend-profile-card-name"><UserDisplayName name={name} uid={friend.uid} badge={friend.equippedBadge} showBadgeName /></h2>
        <p className="friend-profile-card-meta">
          <span>UID {formatUid(friend.uid)}</span>
          <span>{friend.levelName || '初入E院'}</span>
        </p>
        {loading ? <p className="friend-profile-card-state" role="status" aria-live="polite">加载用户资料…</p> : error ? <>
          <p className="friend-profile-card-state is-error" role="alert">{error}</p>
          {onRetry ? <button type="button" className="friend-profile-card-retry" onClick={onRetry}>重试</button> : null}
        </> : unavailableMessage ? <p className="friend-profile-card-bio">{unavailableMessage}</p> : <>
          <p className="friend-profile-card-bio">{bio}</p>
          <p className="friend-profile-card-status">{statusLabel}</p>
          <div className={`friend-profile-card-actions${status === 'INCOMING_PENDING' && friend.requestId ? ' is-three-actions' : ''}`}>
            <Link className="friend-profile-card-action friend-profile-card-action-secondary" href={`/user/${formatUid(friend.uid)}`} onClick={onNavigate}>查看主页</Link>
            {status === 'FRIEND' && showMessage && onMessage ? <button className="friend-profile-card-action friend-profile-card-action-primary" type="button" onClick={onMessage}>发私信</button> : null}
            {status === 'NONE' ? (
              <AddFriendButton
                uid={friend.uid}
                initialStatus="NONE"
                targetName={name}
                buttonClassName="friend-profile-card-action friend-profile-card-action-primary"
                onStatusChange={reportRelationshipChange}
              />
            ) : null}
            {status === 'OUTGOING_PENDING' ? (
              <button className="friend-profile-card-action friend-profile-card-action-pending" type="button" disabled aria-label="已发送好友申请，等待对方接受">等待对方接受</button>
            ) : null}
            {status === 'INCOMING_PENDING' ? (
              friend.requestId ? (
                <FriendRequestDecision requestId={friend.requestId} layout="inline" onCompleted={(action) => {
                  onRelationshipChange?.(action === 'accept' ? 'FRIEND' : 'NONE')
                }} />
              ) : (
                <Link href="/friends?requestType=received#received-requests" onClick={onNavigate}>查看好友申请</Link>
              )
            ) : null}
          </div>
        </>}
      </section>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(content, document.body)
}
