'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { AddFriendButton } from '@/components/FriendRequestActions'
import { FriendFollowButton } from '@/components/FriendFollowButton'
import { formatUid } from '@/lib/uid'

type FriendStatus = 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED'

const messageActionClass = 'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-2.5 text-sm font-black text-[var(--primary-foreground)] transition hover:opacity-90 sm:px-4'
const liveActionClass = 'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-black text-[var(--primary)] transition hover:bg-[var(--surface-subtle)] sm:px-4'
const destructiveActionClass = 'inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-[var(--danger)] bg-transparent px-3 py-2.5 text-sm font-black text-[var(--danger)] transition hover:bg-[var(--surface-subtle)] sm:px-4'

export function FriendProfileActions({
  targetUserId,
  targetUid,
  publicLiveCount,
  hasViewer,
  initialIsFriend,
  initialIsBlocked,
  initialIsFollowed,
  friendStatus,
}: Readonly<{
  targetUserId: string
  targetUid: number
  publicLiveCount: number
  hasViewer: boolean
  initialIsFriend: boolean
  initialIsBlocked: boolean
  initialIsFollowed: boolean
  friendStatus: FriendStatus
}>) {
  const router = useRouter()
  const [isFriend, setIsFriend] = useState(initialIsFriend)
  const [isFollowed, setIsFollowed] = useState(initialIsFollowed)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  async function deleteFriend() {
    if (isDeleting) return
    setError('')
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/friends/${encodeURIComponent(targetUserId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '删除好友失败，请稍后重试')

      setIsFriend(false)
      setIsFollowed(false)
      setConfirmOpen(false)
      window.dispatchEvent(new Event('friend-dock:refresh'))
      window.dispatchEvent(new Event('unread-summary:refresh'))
      router.refresh()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除好友失败，请稍后重试')
    } finally {
      setIsDeleting(false)
    }
  }

  function scrollToMessageWall() {
    document.getElementById('profile-wall')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <div className="profile-actions-groups flex min-w-full items-start justify-between gap-3">
        <div className="profile-actions-main flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button type="button" onClick={scrollToMessageWall} className={messageActionClass} aria-controls="profile-wall">
            去留言
          </button>
          {hasViewer && isFriend && !initialIsBlocked ? (
            <FriendFollowButton
              userId={targetUserId}
              initialFollowed={isFollowed}
              onChanged={setIsFollowed}
              buttonClassName="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-black text-[var(--primary)] transition hover:bg-[var(--surface-subtle)] disabled:cursor-wait disabled:opacity-60 sm:px-4"
            />
          ) : null}
          {hasViewer && !isFriend && !initialIsBlocked ? <AddFriendButton uid={targetUid} initialStatus={isFriend ? 'FRIEND' : friendStatus === 'FRIEND' ? 'NONE' : friendStatus} buttonClassName="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-2.5 text-sm font-black text-[var(--primary-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70 sm:px-4" /> : null}
          {!hasViewer ? <Link href="/login" className={liveActionClass}>登录后添加好友</Link> : null}
          {publicLiveCount > 0 ? <Link href={`/user/${formatUid(targetUid)}/live`} className={liveActionClass}>TA的现场</Link> : null}
          {error ? <p role="alert" className="w-full basis-full text-xs font-bold text-[var(--danger)]">{error}</p> : null}
        </div>
        {hasViewer && isFriend && !initialIsBlocked ? (
          <div className="profile-actions-danger shrink-0">
            <button
              type="button"
              onClick={() => {
                setError('')
                setConfirmOpen(true)
              }}
              className={destructiveActionClass}
            >
              删除好友
            </button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="确定删除该好友吗？"
        description="删除后你们将不再出现在彼此的好友列表中。"
        confirmLabel="删除好友"
        loading={isDeleting}
        onConfirm={() => void deleteFriend()}
        onCancel={() => {
          if (!isDeleting) setConfirmOpen(false)
        }}
      />
    </>
  )
}
