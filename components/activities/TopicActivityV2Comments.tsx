'use client'

import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import { useSearchParams } from 'next/navigation'
import { PostRepliesSection } from '@/components/PostRepliesSection'
import { parsePostReplyDirection, parsePostReplySort } from '@/lib/post-replies'

type ReplyProps = ComponentProps<typeof PostRepliesSection>
type Reply = ReplyProps['initialReplies'][number] & { replies?: Reply[] }
type ResponseBody = { replies: Reply[]; pinned: Reply | null; total: number; page: number; pageSize: number; totalPages: number; hasMore: boolean;
  topicActivity: { canReview?: boolean; allowImageAttachments?: boolean; reviewCounts?: ReplyProps['initialTopicReviewCounts'] } | null }

export function TopicActivityV2Comments({ postId, postAuthorId, activityId, currentUserId, allowDiscussion, platformTabs = [] }: { postId: string; postAuthorId: string; activityId: string; currentUserId?: string; allowDiscussion: boolean; platformTabs?: Array<{ platformKey: string; platformName: string }> }) {
  const params = useSearchParams()
  const sort = parsePostReplySort(params.get('sort')), direction = parsePostReplyDirection(params.get('direction'), params.get('sort'))
  const page = Math.max(1, Math.trunc(Number(params.get('commentPage') || params.get('page')) || 1))
  const rawStatus = params.get('topicStatus')
  const platform = params.get('topicPlatform') || undefined
  const tab = platform ? 'PLATFORM' as const : params.get('topicTab') === 'discussion' ? 'DISCUSSION' as const : 'ALL' as const
  const status: ReplyProps['topicReviewFilter'] = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(rawStatus || '') ? rawStatus as ReplyProps['topicReviewFilter'] : 'ALL'
  const [value, setValue] = useState<ResponseBody | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const query = new URLSearchParams({ page: String(page), sort, direction })
      if (status !== 'ALL') query.set('topicStatus', status!)
      if (tab === 'DISCUSSION') query.set('topicTab', 'discussion')
      if (tab === 'PLATFORM' && platform) query.set('topicPlatform', platform)
      const response = await fetch('/api/posts/' + encodeURIComponent(postId) + '/replies?' + query, { cache: 'no-store', credentials: 'same-origin', signal })
      const body = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(body?.replies)) throw new Error(body?.message || '评论加载失败')
      setValue(body as ResponseBody); setError(''); setVersion((current) => current + 1)
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : '评论加载失败') }
  }, [postId, page, sort, direction, status, tab, platform])
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const refresh = () => { void load(controller.signal) }
    window.addEventListener('topic-activity-v2-changed', refresh)
    return () => { controller.abort(); window.removeEventListener('topic-activity-v2-changed', refresh) }
  }, [load])
  if (!value) return <div role={error ? 'alert' : 'status'}>{error || '正在加载活动主帖评论…'}{error ? <button type="button" onClick={() => void load()} className="ml-3 underline">重试</button> : null}</div>
  const roots = [...(value.pinned ? [value.pinned] : []), ...value.replies]
  const replies = [...new Map(roots.flatMap((reply) => [reply, ...(reply.replies || [])]).map((reply) => [reply.id, reply])).values()]
  return <div className="border-t border-[var(--border)] pt-4">{error ? <p role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p> : null}<PostRepliesSection key={version} postId={postId} postAuthorId={postAuthorId} initialReplies={replies} initialReplyCount={value.total}
    currentUserId={currentUserId} canInteract={allowDiscussion} canManageReplies={false} sort={sort} direction={direction}
    pagination={{ page: value.page, pageSize: value.pageSize, total: value.total, totalPages: value.totalPages }}
    topicActivityId={activityId} canReviewTopicActivity={Boolean(value.topicActivity?.canReview)} initialTopicReviewCounts={value.topicActivity?.reviewCounts}
    topicCommentTab={tab} topicPlatformFilter={platform} topicPlatformTabs={platformTabs}
    topicReviewFilter={status} topicAllowImageAttachments={value.topicActivity?.allowImageAttachments !== false} /></div>
}
