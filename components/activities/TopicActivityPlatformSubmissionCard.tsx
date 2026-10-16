'use client'

import { useEffect, useState } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import { SafeAvatar } from '@/components/SafeAvatar'
import { TopicActivityV2TaskReview } from '@/components/activities/TopicActivityV2TaskReview'
import { normalizeTopicActivityV2Entries, normalizeTopicActivityV2Progress, type TopicActivityV2TaskSubmission } from '@/components/activities/topic-activity-v2-types'
import { profileImageUrl } from '@/lib/images'
import { formatDate } from '@/lib/format'

export function TopicActivityPlatformSubmissionCard({ activityId, commentId, submission, author, createdAt, currentUserId, canReview, onReviewed }: {
  activityId: string
  commentId: string
  submission: TopicActivityV2TaskSubmission & { canViewPrivate?: boolean }
  author: { id: string; uid: number; nickname: string; avatarUrl?: string | null; profile?: { avatarUrl: string | null } | null }
  createdAt: Date | string
  currentUserId?: string
  canReview: boolean
  onReviewed?: (status: 'APPROVED' | 'REJECTED') => void
}) {
  const isOwner = Boolean(currentUserId && currentUserId === author.id)
  // The server removes private assets for other viewers. Never reconstruct an
  // asset URL from its ID or expose a URL when the explicit grant is false.
  const canViewPrivate = submission.canViewPrivate !== false && (isOwner || canReview)
  const [canResubmit, setCanResubmit] = useState(false)
  useEffect(() => {
    setCanResubmit(false)
    if (!isOwner || submission.status !== 'REJECTED' || submission.granted || !submission.rewardEntryId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/v2`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        const entry = normalizeTopicActivityV2Entries(data?.entries).find((item) => item.id === submission.rewardEntryId)
        const progress = normalizeTopicActivityV2Progress(data?.myProgress).find((item) => item.rewardEntryId === submission.rewardEntryId)
        const now = Date.now()
        const inWindow = (start?: string | null, end?: string | null) => (!start || now >= Date.parse(start)) && (!end || now <= Date.parse(end))
        if (!controller.signal.aborted) setCanResubmit(Boolean(entry?.enabled && entry.allowResubmit && progress?.status === 'REJECTED' && progress.submissionId === submission.id
          && data?.program?.enabled && data.program.platformRewards?.enabled && data?.activity?.status === 'PUBLISHED'
          && inWindow(data.activity.startsAt, data.activity.endsAt) && inWindow(entry.startsAt, entry.endsAt)
          && (entry.maxImages === 0 || data.activity.allowImageAttachments)))
      } catch { /* A missing receipt must not unlock submission. */ }
    })()
    return () => controller.abort()
  }, [activityId, isOwner, submission.id, submission.status, submission.rewardEntryId, submission.granted])
  const platformName = submission.rewardSnapshotSafe?.platformName || '平台'
  const assets = canViewPrivate ? (submission.taskAssets || []) : []
  return <article id={`reply-${commentId}`} data-platform-submission={submission.id} className="min-w-0 scroll-mt-20 space-y-3 border border-[var(--border)] p-3 sm:p-4">
    <header className="flex min-w-0 items-center gap-2">
      <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full"><SafeAvatar src={profileImageUrl(author.profile?.avatarUrl || author.avatarUrl)} name={author.nickname} uid={author.uid} /></span>
      <span className="min-w-0 flex-1 truncate text-sm font-bold">{author.nickname}</span>
      <time dateTime={new Date(createdAt).toISOString()} className="shrink-0 text-xs text-[var(--foreground-muted)]">{formatDate(new Date(createdAt))}</time>
    </header>
    <p className="text-sm font-bold">{platformName}</p>
    {assets.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{assets.map((asset, index) => {
      const src = asset.thumbnailAccessUrl || asset.previewAccessUrl || asset.thumbnailUrl || asset.url
      if (!src) return null
      return <ImageViewer key={asset.assetId} src={src} previewSrc={asset.previewAccessUrl || src} originalUrl={asset.originalDownloadUrl ? `${asset.originalDownloadUrl}?view=1` : null} downloadUrl={asset.originalDownloadUrl || undefined} alt={`${platformName}提交截图 ${index + 1}`} imageClassName="aspect-square w-full object-cover" />
    })}</div> : !canViewPrivate ? <p className="text-xs text-[var(--foreground-muted)]">截图仅提交者和审核人员可见</p> : null}
    <TopicActivityV2TaskReview activityId={activityId} submission={canViewPrivate ? submission : { ...submission, rejectReason: null }} canReview={canReview} onReviewed={onReviewed} />
    {isOwner && canResubmit ? <button type="button" className="border border-[var(--border)] px-3 py-1 text-xs font-bold" onClick={() => window.dispatchEvent(new CustomEvent('topic-activity-v2-open-task', { detail: { activityId, rewardEntryId: submission.rewardEntryId } }))}>重新提交</button> : null}
  </article>
}
