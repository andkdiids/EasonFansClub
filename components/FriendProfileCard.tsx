'use client'

import Link from 'next/link'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { FriendDockUser } from '@/lib/friend-types'
import { publicImageUrl } from '@/lib/images'
import { formatUid } from '@/lib/uid'

export function FriendProfileCard({
  friend,
  onClose,
  onMessage,
  onNavigate,
}: Readonly<{
  friend: FriendDockUser
  onClose: () => void
  onMessage: () => void
  onNavigate: () => void
}>) {
  const name = friend.profile?.displayName || friend.nickname
  const avatar = publicImageUrl(friend.profile?.avatarUrl || friend.avatarUrl)
  const bio = friend.profile?.bio || friend.bio || '这个成员还没有填写个人简介。'

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
        <h2 id="friend-profile-card-name">{name}</h2>
        <p className="friend-profile-card-meta">
          <span>UID {formatUid(friend.uid)}</span>
          <span>{friend.levelName || '初入E院'}</span>
        </p>
        <p className="friend-profile-card-bio">{bio}</p>
        <p className="friend-profile-card-status">{friend.isOnline ? '当前在线' : '好友'}</p>
        <div className="friend-profile-card-actions">
          <Link href={`/user/${formatUid(friend.uid)}`} onClick={onNavigate}>个人主页</Link>
          <button type="button" onClick={onMessage}>发私信</button>
        </div>
      </section>
    </div>
  )
}
