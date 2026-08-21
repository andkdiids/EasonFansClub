'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'

export function ForumDiscoveryDetailTopbar({ authorName, authorAvatar, authorUid, authorBadge, postActions }: Readonly<{
  authorName: string
  authorAvatar: string | null
  authorUid: number
  authorBadge?: EquippedBadgeView | null
  postActions?: ReactNode
}>) {
  const router = useRouter()
  const [shareMessage, setShareMessage] = useState('')

  function goBack() {
    if (window.history.length > 1) router.back()
    else router.push('/forum')
  }

  async function sharePost() {
    const shareData = { title: document.title, url: window.location.href }
    try {
      if (navigator.share) await navigator.share(shareData)
      else {
        await navigator.clipboard?.writeText(window.location.href)
        setShareMessage('链接已复制')
        window.setTimeout(() => setShareMessage(''), 1800)
      }
    } catch {
      // Closing the native share sheet is not an error for the page.
    }
  }

  return (
    <header className="forum-discovery-detail-topbar">
      <button type="button" onClick={goBack} className="forum-discovery-detail-back" aria-label="返回广场">‹</button>
      <div className="forum-discovery-detail-author">
        <span className="forum-discovery-detail-avatar">
          {authorAvatar ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={authorAvatar} alt="" />
          ) : String(authorUid).slice(0, 1)}
        </span>
        <UserDisplayName name={authorName} uid={authorUid} badge={authorBadge} compact />
      </div>
      {postActions ? <span className="forum-discovery-detail-post-actions">{postActions}</span> : null}
      <button type="button" onClick={() => void sharePost()} className="forum-discovery-detail-share" aria-label="分享帖子">↗</button>
      {shareMessage ? <span className="forum-discovery-share-message" role="status">{shareMessage}</span> : null}
    </header>
  )
}
