'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { AddFriendButton, FriendRequestDecision } from '@/components/FriendRequestActions'
import type { FriendDockUser } from '@/lib/friend-types'
import type { RelationshipStatus } from '@/lib/friend-types'
import { profileImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'
import { UserDisplayName } from '@/components/UserDisplayName'

const FRIEND_PROFILE_HISTORY_KEY = '__easonFriendProfileCard'
const FRIEND_REQUEST_REASON_OPEN_KEY = '__easonFriendRequestReasonDialogOpen'

export function FriendProfileCard({
  friend,
  onClose,
  onMessage,
  onNavigate,
  showMessage = true,
  unavailableMessage,
  onRelationshipChange,
}: Readonly<{
  friend: FriendDockUser
  onClose: () => void
  onMessage?: () => void
  onNavigate: () => void
  showMessage?: boolean
  unavailableMessage?: string
  onRelationshipChange?: (status: RelationshipStatus) => void
}>) {
  const onCloseRef = useRef(onClose)
  const previousHistoryStateRef = useRef<unknown>(null)
  onCloseRef.current = onClose
  useEffect(() => {
    const previousState = window.history.state
    previousHistoryStateRef.current = previousState
    window.history.pushState({
      ...(previousState && typeof previousState === 'object' ? previousState : {}),
      [FRIEND_PROFILE_HISTORY_KEY]: true,
    }, '')
    const handlePopState = () => {
      if ((window as Window & { [FRIEND_REQUEST_REASON_OPEN_KEY]?: boolean })[FRIEND_REQUEST_REASON_OPEN_KEY]) return
      onCloseRef.current()
    }
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (window.history.state?.[FRIEND_PROFILE_HISTORY_KEY]) {
        window.history.replaceState(previousHistoryStateRef.current, '')
      }
    }
  }, [friend.id])

  const name = friend.friendRemark?.trim() || friend.displayName || friend.nickname || 'E院用户'
  const avatar = profileImageUrl(friend.profile?.avatarUrl || friend.avatarUrl)
  const bio = friend.profile?.bio || friend.bio || '这个成员还没有填写个人简介。'
  const status = friend.relationshipStatus || 'FRIEND'
  const statusLabel = status === 'SELF' ? '这是你' : status === 'FRIEND' ? '好友' : status === 'OUTGOING_PENDING' ? '已发送申请' : '其他用户'
  const reportRelationshipChange = (next: 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED') => {
    onRelationshipChange?.(next === 'PENDING' ? 'OUTGOING_PENDING' : next === 'RECEIVED' ? 'INCOMING_PENDING' : next)
  }

  return (
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
        <button type="button" className="friend-profile-card-close" onClick={onClose} aria-label="关闭好友资料卡">×</button>
        <div className="friend-profile-card-avatar">
          <SafeAvatar src={avatar} name={name} uid={friend.uid} className="h-full w-full" />
        </div>
        <h2 id="friend-profile-card-name"><UserDisplayName name={name} uid={friend.uid} badge={friend.equippedBadge} showBadgeName /></h2>
        <p className="friend-profile-card-meta">
          <span>UID {formatUid(friend.uid)}</span>
          <span>{friend.levelName || '初入E院'}</span>
        </p>
        {unavailableMessage ? <p className="friend-profile-card-bio">{unavailableMessage}</p> : <>
          <p className="friend-profile-card-bio">{bio}</p>
          <p className="friend-profile-card-status">{friend.isOnline ? '当前在线' : statusLabel}</p>
          <div className="friend-profile-card-actions">
            <Link href={`/user/${formatUid(friend.uid)}`} onClick={onNavigate}>进入个人主页</Link>
            {status === 'FRIEND' && showMessage && onMessage ? <button type="button" onClick={onMessage}>发私信</button> : null}
            {status === 'NONE' ? (
              <AddFriendButton
                uid={friend.uid}
                initialStatus="NONE"
                targetName={name}
                onStatusChange={reportRelationshipChange}
              />
            ) : null}
            {status === 'OUTGOING_PENDING' ? (
              <AddFriendButton uid={friend.uid} initialStatus="PENDING" targetName={name} />
            ) : null}
            {status === 'INCOMING_PENDING' ? (
              friend.requestId ? (
                <FriendRequestDecision requestId={friend.requestId} onCompleted={(action) => {
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
}
