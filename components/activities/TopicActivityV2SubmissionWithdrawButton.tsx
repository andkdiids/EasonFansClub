'use client'

import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function TopicActivityV2SubmissionWithdrawButton({ activityId, submissionId, onWithdrawn }: {
  activityId: string
  submissionId: string
  onWithdrawn?: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const busy = useRef(false)

  async function withdraw() {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/v2/submissions/${encodeURIComponent(submissionId)}/withdraw`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
      })
      const body = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) {
        if (response.status === 401) throw new Error('登录状态已过期，请重新登录后重试。')
        if (response.status === 409) throw new Error(body?.message || '提交状态已变化，请刷新后重试。')
        throw new Error(body?.message || '撤回失败，请稍后重试。')
      }
      setConfirm(false)
      setMessage('截图已撤回，可以重新上传。')
      onWithdrawn?.()
      window.dispatchEvent(new Event('topic-activity-v2-changed'))
    } catch (cause) {
      setError(cause instanceof TypeError ? '网络异常，撤回失败，请稍后重试。' : cause instanceof Error ? cause.message : '撤回失败，请稍后重试。')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  return <div className="flex flex-wrap items-center gap-2">
    {!message ? <button type="button" className="min-h-10 border border-rose-300 px-3 py-1 text-sm font-bold text-rose-700 disabled:opacity-50" disabled={loading} onClick={() => { setError(''); setConfirm(true) }}>
      {loading ? '正在撤回…' : '撤回截图'}
    </button> : <p role="status" className="text-sm font-bold text-emerald-700">{message}</p>}
    {error && !confirm ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    <ConfirmDialog open={confirm} title="确认撤回这张截图？" description="撤回后本次提交会保留为历史记录，不再进入审核；你可以重新上传并提交正确截图。撤回不会发放奖励。" confirmLabel="确认撤回截图" cancelLabel="保留当前提交" loading={loading} error={error} onCancel={() => { if (!busy.current) setConfirm(false) }} onConfirm={() => void withdraw()} />
  </div>
}
