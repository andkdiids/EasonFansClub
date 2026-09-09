'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode } from 'react'
import type { ShareCardData } from '@/lib/share-card'
import { ShareButton } from '@/components/share/ShareButton'

export function ForumDiscoveryDetailTopbar({ postActions, shareTitle, shareText, shareCardData, canShare }: Readonly<{
  postActions?: ReactNode
  shareTitle: string
  shareText: string
  shareCardData: ShareCardData
  canShare?: boolean
}>) {
  const router = useRouter()

  function goBack() {
    if (window.history.length > 1) router.back()
    else router.push('/forum')
  }

  return (
    <header className="forum-discovery-detail-topbar">
      <button type="button" onClick={goBack} className="forum-discovery-detail-back" aria-label="返回广场">‹</button>
      <div className="forum-discovery-detail-actions">
        {postActions ? <span className="forum-discovery-detail-post-actions">{postActions}</span> : null}
        {canShare !== false ? <ShareButton
          data={shareCardData}
          linkTitle={shareTitle}
          linkText={shareText}
          triggerClassName="forum-discovery-detail-share shrink-0 whitespace-nowrap"
          messageClassName="forum-discovery-share-message"
          ariaLabel="分享帖子"
        /> : null}
      </div>
    </header>
  )
}
