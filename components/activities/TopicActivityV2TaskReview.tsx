'use client'

import { useRef, useState } from 'react'
import { ReviewConfirmDialog, type ReviewConfirmAction } from '@/components/activities/ReviewConfirmDialog'
import type { TopicActivityV2TaskSubmission } from '@/components/activities/topic-activity-v2-types'

type TopicActivityV2TaskReviewProps = {
  activityId: string
  submission: TopicActivityV2TaskSubmission
  canReview: boolean
  onReviewed?: (status: 'APPROVED' | 'REJECTED') => void
}

export function TopicActivityV2TaskReview({ activityId, submission, canReview, onReviewed }: Readonly<TopicActivityV2TaskReviewProps>) {
  const [action, setAction] = useState<ReviewConfirmAction | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const busy = useRef(false)
  const [history, setHistory] = useState<Array<{ id: string; fromStatus: string; toStatus: string; reviewedAt: string; reason: string | null; ReviewedBy: { nickname: string } | null }> | null>(null)
  const entry = submission.rewardSnapshotSafe
  const [historyOpen, setHistoryOpen] = useState(false)
  const isPending = submission.status === 'PENDING'

  function open(actionValue: ReviewConfirmAction) {
    if (!canReview || !isPending || loading) return
    setError('')
    setRejectReason('')
    setAction(actionValue)
  }

  async function confirm() {
    if (!action || busy.current || !canReview || !isPending) return
    if (action === 'REJECTED' && (rejectReason.trim().length < 2 || rejectReason.trim().length > 200)) {
      setError('请填写 2–200 字拒绝原因')
      return
    }
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
    if (!canReview) return
    if (historyOpen) { setHistoryOpen(false); return }
    setHistoryOpen(true)
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/v2/submissions/${encodeURIComponent(submission.id)}`, { cache: 'no-store', credentials: 'same-origin' })
      const data = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(data?.history)) throw new Error(data?.message || '审核记录加载失败')
      setHistory(data.history)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核记录加载失败') }
  }

  return <div className="flex flex-wrap items-center gap-2" data-topic-v2-task-review={submission.id}>
    {submission.granted ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">奖励已发放</span> : null}
    <span className="text-xs font-bold">{submission.status === 'APPROVED' ? '✓ 已通过' : submission.status === 'REJECTED' ? '未通过' : submission.status === 'WITHDRAWN' ? '已撤回' : '待审核'}</span>
    {isPending && canReview ? <><button type="button" onClick={() => open('APPROVED')} disabled={loading} className="border px-2 py-1 text-xs font-bold text-emerald-700 disabled:opacity-50">通过</button><button type="button" onClick={() => open('REJECTED')} disabled={loading} className="border px-2 py-1 text-xs font-bold text-rose-700 disabled:opacity-50">拒绝</button></> : null}
    {submission.status === 'REJECTED' && submission.rejectReason ? <span className="basis-full text-xs font-bold text-rose-700">拒绝原因：{submission.rejectReason}</span> : null}
    {canReview ? <button type="button" aria-expanded={historyOpen} onClick={() => void loadHistory()} className="text-xs underline">审核记录</button> : null}
    {historyOpen && history ? <ol className="basis-full space-y-1 text-xs">{history.length ? history.map((item) => <li key={item.id}>{item.fromStatus} → {item.toStatus} · {item.ReviewedBy?.nickname || '历史审核人'} · {new Date(item.reviewedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}{item.reason ? ' · ' + item.reason : ''}</li>) : <li>暂无审核记录</li>}</ol> : null}
    {error && !action ? <p role="alert" className="basis-full text-xs text-red-600">{error}</p> : null}
    <ReviewConfirmDialog
      open={Boolean(action)}
      action={action || 'APPROVED'}
      rejectReasonRequired
      titleOverride={action === 'REJECTED' ? `拒绝${entry?.platformName || '平台'}任务` : undefined}
      rejectReason={rejectReason}
      onRejectReasonChange={setRejectReason}
      loading={loading}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={() => { if (!loading) { setError(''); setAction(null) } }}
    />
  </div>
}
