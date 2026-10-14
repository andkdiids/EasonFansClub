'use client'

import { useRef, useState } from 'react'
import { ReviewConfirmDialog, type ReviewConfirmAction } from '@/components/activities/ReviewConfirmDialog'
import { TopicActivityAssetImage } from '@/components/activities/TopicActivityAssetImage'
import type { TopicActivityV2TaskSubmission } from '@/components/activities/topic-activity-v2-types'

type TopicActivityV2TaskReviewProps = {
  activityId: string
  submission: TopicActivityV2TaskSubmission
  canReview: boolean
  onReviewed?: (status: 'APPROVED' | 'REJECTED') => void
}

function assetUrl(asset: NonNullable<TopicActivityV2TaskSubmission['taskAssets']>[number]) {
  return asset.thumbnailAccessUrl || asset.previewAccessUrl || asset.thumbnailUrl || asset.url || ''
}

export function TopicActivityV2TaskReview({ activityId, submission, canReview, onReviewed }: Readonly<TopicActivityV2TaskReviewProps>) {
  const [action, setAction] = useState<ReviewConfirmAction | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const busy = useRef(false)
  const [history, setHistory] = useState<Array<{ id: string; fromStatus: string; toStatus: string; reviewedAt: string; reason: string | null; ReviewedBy: { nickname: string } | null }> | null>(null)
  const entry = submission.rewardSnapshotSafe
  const taskAssets = submission.taskAssets || []
  const isPending = submission.status === 'PENDING'

  function open(actionValue: ReviewConfirmAction) {
    if (!canReview || !isPending || loading) return
    setError('')
    setRejectReason('')
    setAction(actionValue)
  }

  async function confirm() {
    if (!action || busy.current || !canReview || !isPending) return
    busy.current = true
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/v2/submissions/${encodeURIComponent(submission.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action, ...(rejectReason.trim() ? { rejectReason: rejectReason.trim() } : {}) }),
      })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '任务审核失败，请稍后重试')
      const reviewedAction = action
      setAction(null)
      setRejectReason('')
      onReviewed?.(reviewedAction)
      window.dispatchEvent(new Event('topic-activity-v2-changed'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务审核失败，请稍后重试')
    } finally {
      setLoading(false)
      busy.current = false
    }
  }

  async function loadHistory() {
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/v2/submissions/${encodeURIComponent(submission.id)}`, { cache: 'no-store', credentials: 'same-origin' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(data?.history)) throw new Error(data?.message || '审核记录加载失败')
      setHistory(data.history)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核记录加载失败') }
  }

  return <div className="flex flex-wrap items-center gap-2" data-topic-v2-task-review={submission.id}>
    {entry ? <span className="text-xs font-black text-[var(--foreground-muted)]">{entry.platformName || '平台任务'}{typeof entry.points === 'number' ? ` · ${entry.points} 挂号费` : ''}</span> : <span className="text-xs font-black text-[var(--foreground-muted)]">平台任务</span>}
    {entry?.title ? <p className="basis-full text-sm font-bold">{entry.title}</p> : null}
    {entry?.instructions ? <p className="basis-full whitespace-pre-wrap text-xs">{entry.instructions}</p> : null}
    {taskAssets.length ? <div className="basis-full space-y-2"><span className="text-xs">截图 {taskAssets.length} 张</span><div className="flex flex-wrap gap-2">{taskAssets.map((asset) => { const src = assetUrl(asset); return src ? <div key={asset.assetId}><a href={asset.originalDownloadUrl ? asset.originalDownloadUrl + '?view=1' : src} target="_blank" rel="noopener noreferrer"><TopicActivityAssetImage src={src} alt="任务截图预览" className="h-24 w-24 object-cover" /></a>{asset.originalDownloadUrl ? <a className="block text-xs underline" href={asset.originalDownloadUrl}>下载原图</a> : null}</div> : null })}</div></div> : null}
    {submission.granted ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">奖励已发放</span> : null}
    {isPending && canReview ? <><button type="button" onClick={() => open('APPROVED')} disabled={loading} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 disabled:opacity-50">{loading && action === 'APPROVED' ? '处理中…' : '通过任务'}</button><button type="button" onClick={() => open('REJECTED')} disabled={loading} className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700 disabled:opacity-50">拒绝任务</button></> : <span className={`rounded-full px-3 py-1 text-xs font-black ${submission.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : submission.status === 'REJECTED' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{submission.status === 'APPROVED' ? '任务已通过' : submission.status === 'REJECTED' ? '任务未通过' : submission.status === 'WITHDRAWN' ? '任务已撤回' : '任务待审核'}</span>}
    {submission.status === 'REJECTED' && submission.rejectReason ? <span className="basis-full text-xs font-bold text-rose-700">拒绝原因：{submission.rejectReason}</span> : null}
    {canReview ? <button type="button" onClick={() => void loadHistory()} className="text-xs underline">查看审核历史</button> : null}
    {history ? <ol className="basis-full space-y-1 text-xs">{history.length ? history.map((item) => <li key={item.id}>{item.fromStatus} → {item.toStatus} · {item.ReviewedBy?.nickname || '历史审核人'} · {new Date(item.reviewedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}{item.reason ? ' · ' + item.reason : ''}</li>) : <li>暂无审核记录</li>}</ol> : null}
    {error && !action ? <p role="alert" className="basis-full text-xs text-red-600">{error}</p> : null}
    <ReviewConfirmDialog
      open={Boolean(action)}
      action={action || 'APPROVED'}
      rejectReason={rejectReason}
      onRejectReasonChange={setRejectReason}
      loading={loading}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => { if (!loading) { setError(''); setAction(null) } }}
    />
  </div>
}
