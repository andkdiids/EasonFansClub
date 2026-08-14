'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { AddFriendButton } from '@/components/FriendRequestActions'
import { FriendFollowButton } from '@/components/FriendFollowButton'
import { formatUid } from '@/lib/uid'

type FriendStatus = 'NONE' | 'PENDING' | 'FRIEND' | 'RECEIVED'

const liveActionClass = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm font-black text-[var(--primary)] shadow-sm transition hover:bg-[var(--accent)]'

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

  return (
    <>
      {hasViewer && isFriend && !initialIsBlocked ? (
        <>
          <button
            type="button"
            onClick={() => {
              setError('')
              setConfirmOpen(true)
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--danger)] bg-transparent px-4 py-2.5 text-sm font-black text-[var(--danger)] shadow-sm transition hover:bg-[var(--accent)]"
          >
            删除好友
          </button>
          <FriendFollowButton userId={targetUserId} initialFollowed={isFollowed} onChanged={setIsFollowed} />
        </>
      ) : null}
      {hasViewer && !isFriend && !initialIsBlocked ? <AddFriendButton uid={targetUid} initialStatus={isFriend ? 'FRIEND' : friendStatus === 'FRIEND' ? 'NONE' : friendStatus} /> : null}
      {!hasViewer ? <Link href="/login" className={liveActionClass}>登录后添加好友</Link> : null}
      {publicLiveCount > 0 ? <Link href={`/user/${formatUid(targetUid)}/live`} className={liveActionClass}>TA的现场</Link> : null}
      {error ? <p role="alert" className="w-full basis-full text-xs font-bold text-[var(--danger)]">{error}</p> : null}
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
