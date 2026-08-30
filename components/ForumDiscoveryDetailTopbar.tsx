'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode } from 'react'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'
import type { ShareCardData } from '@/lib/share-card'
import { ShareButton } from '@/components/share/ShareButton'

export function ForumDiscoveryDetailTopbar({ authorName, authorAvatar, authorUid, authorBadge, postActions, shareTitle, shareText, shareCardData }: Readonly<{
  authorName: string
  authorAvatar: string | null
  authorUid: number
  authorBadge?: EquippedBadgeView | null
  postActions?: ReactNode
  shareTitle: string
  shareText: string
  shareCardData: ShareCardData
}>) {
  const router = useRouter()

  function goBack() {
    if (window.history.length > 1) router.back()
    else router.push('/forum')
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
      <ShareButton
        data={shareCardData}
        linkTitle={shareTitle}
        linkText={shareText}
        triggerClassName="forum-discovery-detail-share shrink-0 whitespace-nowrap"
        messageClassName="forum-discovery-share-message"
        ariaLabel="分享帖子"
      />
    </header>
  )
}
