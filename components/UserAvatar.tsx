'use client'

import { useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { SessionUser } from '@/lib/auth'
import { getPublicUserDisplayNameFromNickname } from '@/lib/public-user-name'

type UserAvatarProps = {
  user: Pick<SessionUser, 'nickname' | 'avatarUrl' | 'uid'>
  className?: string
  textClassName?: string
}

export function getUserDisplayName(user: Pick<SessionUser, 'nickname'>) {
  return getPublicUserDisplayNameFromNickname(user.nickname)
}

export function UserAvatar({ user, className = 'h-full w-full', textClassName = 'text-sm' }: Readonly<UserAvatarProps>) {
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || null)
  const displayName = getUserDisplayName(user)

  useEffect(() => setAvatarUrl(user.avatarUrl || null), [user.avatarUrl])
  useEffect(() => {
    const updateAvatar = (event: Event) => {
      const nextUrl = (event as CustomEvent<{ avatarUrl?: string | null }>).detail?.avatarUrl
      if (nextUrl !== undefined) setAvatarUrl(nextUrl)
    }
    window.addEventListener('profile-avatar-updated', updateAvatar)
    return () => window.removeEventListener('profile-avatar-updated', updateAvatar)
  }, [])

  return <SafeAvatar src={avatarUrl} name={displayName} uid={user.uid} className={className} textClassName={textClassName} />
}
