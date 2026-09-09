'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection, type ActivityImageUploadStatus } from '@/components/activities/ActivityImageUploader'

type NotificationBatch = {
  id: string
  activityId: string
  title: string
  content: string
  imageUrl: string | null
  status: string
  recipientCount: number
  sentCount: number
  skippedCount: number
  createdAt: string
  createdBy: { uid: number; nickname: string } | null
}

type NotificationOverview = {
  activity: { id: string; title: string; status: string }
  recipientCount: number
  registrationCount: number
  history: NotificationBatch[]
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `activity-notification-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
}

function statusLabel(status: string) {
  if (status === 'SENT') return '已发送'
  if (status === 'PARTIAL') return '部分发送'
  if (status === 'FAILED') return '发送失败'
  return '处理中'
}

export function ActivityTargetedNotificationPanel({ activityId, activityTitle, onClose }: Readonly<{
  activityId: string
  activityTitle: string
  onClose: () => void
}>) {
  const [overview, setOverview] = useState<NotificationOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageStatus, setImageStatus] = useState<ActivityImageUploadStatus>('idle')
  const [imageError, setImageError] = useState('')
  const [resetSignal, setResetSignal] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const idempotencyKeyRef = useRef(newIdempotencyKey())

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/notifications`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null) as NotificationOverview & { message?: string } | null
      if (!response.ok || !data) throw new Error(data?.message || '活动通知数据加载失败')
      setOverview(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '活动通知数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [activityId])

  useEffect(() => { void loadOverview() }, [loadOverview])

  async function handleImageSelection(selection: ActivityImageSelection) {
    setImageError('')
    if (!selection.file) {
      setImageUrl(null)
      setImageStatus('idle')
      return
    }
    setImageStatus('uploading')
    try {
      const uploadedUrl = await uploadActivityImage(selection.file)
      setImageUrl(uploadedUrl)
      setImageStatus('success')
    } catch (uploadError) {
      setImageUrl(null)
      setImageStatus('error')
      setImageError(uploadError instanceof Error ? uploadError.message : '图片上传失败，请稍后重试')
    }
  }

  function prepareSend() {
    setMessage('')
    setError('')
    if (!overview || overview.recipientCount === 0) {
      setError('当前没有可接收通知的报名用户')
      return
    }
    if (!title.trim()) { setError('通知标题不能为空'); return }
    if (!content.trim()) { setError('通知正文不能为空'); return }
    if (imageStatus === 'uploading') { setError('图片仍在上传，请稍候'); return }
    setConfirmOpen(true)
  }

  async function confirmSend() {
    if (!overview || sending) return
    setSending(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/notifications`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, imageUrl, idempotencyKey: idempotencyKeyRef.current }),
      })
      const data = await response.json().catch(() => null) as { message?: string; batch?: NotificationBatch } | null
      if (!response.ok) throw new Error(data?.message || '活动通知发送失败，请稍后重试')
      setConfirmOpen(false)
      setMessage(data?.message || '活动通知发送成功')
      setTitle('')
      setContent('')
      setImageUrl(null)
      setImageStatus('idle')
      setResetSignal((value) => value + 1)
      idempotencyKeyRef.current = newIdempotencyKey()
      await loadOverview()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '活动通知发送失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  const recipientCount = overview?.recipientCount || 0
  return (
    <section className="rounded-[28px] border border-violet-200 bg-white/95 p-5 shadow-sm dark:border-violet-900/60 dark:bg-slate-900/95 sm:p-7" aria-label="活动定向通知">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-black tracking-[0.18em] text-violet-700 dark:text-violet-300">活动通知</p><h2 className="mt-1 text-2xl font-black text-brand-950 dark:text-slate-100">发送通知</h2><p className="mt-1 text-sm font-bold text-slate-500">仅发送给报名「{activityTitle}」的有效报名用户</p></div>
        <button type="button" onClick={onClose} disabled={sending} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">关闭</button>
      </div>

      {loading ? <p className="mt-5 text-sm font-bold text-slate-500">正在读取报名人数…</p> : null}
      {!loading && overview ? <>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-violet-50 p-4 dark:bg-violet-950/30"><span className="text-xs font-black text-violet-700 dark:text-violet-300">预计接收人数</span><strong className="mt-1 block text-2xl font-black text-violet-950 dark:text-violet-100">{recipientCount} 人</strong></div>
          <div className="rounded-2xl bg-sky-50 p-4 dark:bg-slate-800"><span className="text-xs font-black text-sky-700 dark:text-sky-300">活动状态</span><strong className="mt-1 block text-base font-black text-brand-950 dark:text-slate-100">{overview.activity.status === 'CANCELLED' ? '已取消（可发送说明）' : overview.activity.status === 'DRAFT' ? '草稿' : '正常'}</strong></div>
          <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800"><span className="text-xs font-black text-slate-500">报名记录</span><strong className="mt-1 block text-base font-black text-slate-800 dark:text-slate-100">{overview.registrationCount} 条</strong></div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-4">
            <label className="block text-sm font-black text-slate-700 dark:text-slate-200">标题<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="例如：活动集合时间调整" className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
            <label className="block text-sm font-black text-slate-700 dark:text-slate-200">正文<textarea value={content} maxLength={5000} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="请输入要发送给报名用户的内容" className="mt-1 w-full resize-y rounded-xl border border-sky-100 bg-white px-3 py-3 font-bold leading-6 text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /><span className="mt-1 block text-right text-xs font-bold text-slate-400">{content.length}/5000</span></label>
            <ActivityImageUploader label="通知图片（可选，最多 1 张）" resetSignal={resetSignal} disabled={sending} status={imageStatus} errorMessage={imageError} onSelectionChange={(selection) => { void handleImageSelection(selection) }} />
            {message ? <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p> : null}
            {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-black text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p> : null}
            <button type="button" onClick={prepareSend} disabled={sending || loading || recipientCount === 0} className="min-h-11 rounded-full bg-violet-700 px-5 py-2 text-sm font-black text-white disabled:opacity-50">发送通知</button>
            {recipientCount === 0 ? <p className="text-xs font-bold text-amber-700 dark:text-amber-300">当前没有可接收通知的报名用户</p> : <p className="text-xs font-bold text-slate-500">发送前会再次确认：将发送给 {recipientCount} 名报名用户。</p>}
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <p className="text-xs font-black tracking-[0.15em] text-sky-700 dark:text-sky-300">发送预览</p>
            {imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={imageUrl} alt="通知图片预览" className="mt-3 max-h-48 w-full rounded-xl object-contain" />
            ) : null}
            <h3 className="mt-3 break-words text-lg font-black text-brand-950 dark:text-slate-100">{title.trim() || '通知标题'}</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-700 dark:text-slate-300">{content.trim() || '通知正文'}</p>
            <p className="mt-4 border-t border-sky-100 pt-3 text-xs font-black text-slate-500 dark:border-slate-700">活动：{activityTitle}</p>
            <p className="mt-1 text-xs font-bold text-slate-400">点击后进入活动详情</p>
          </div>
        </div>

        <div className="mt-7 border-t border-sky-100 pt-5 dark:border-slate-700">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-black tracking-[0.15em] text-slate-500">发送历史</p><h3 className="mt-1 text-lg font-black text-brand-950 dark:text-slate-100">本活动通知记录</h3></div><span className="text-xs font-bold text-slate-400">已发送内容不可编辑</span></div>
          <div className="mt-3 space-y-2">
            {overview.history.length ? overview.history.map((batch) => <article key={batch.id} className="rounded-2xl border border-sky-100 p-3 dark:border-slate-700"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words font-black text-brand-950 dark:text-slate-100">{batch.title}</h4><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs font-bold text-slate-600 dark:text-slate-300">{batch.content}</p></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{statusLabel(batch.status)}</span></div><p className="mt-2 text-[11px] font-bold text-slate-400">{formatDateTime(batch.createdAt)} · 目标 {batch.recipientCount} 人 · 成功 {batch.sentCount} 人{batch.skippedCount ? ` · 跳过 ${batch.skippedCount} 人` : ''}{batch.createdBy ? ` · 操作人 ${batch.createdBy.nickname}（UID ${batch.createdBy.uid}）` : ''}</p></article>) : <p className="rounded-xl bg-slate-50 p-4 text-center text-sm font-bold text-slate-500 dark:bg-slate-800">暂无发送记录</p>}
          </div>
        </div>
      </> : null}

      <ConfirmDialog open={confirmOpen} title="确认发送活动通知？" description={`确认向「${activityTitle}」${recipientCount} 名已报名用户发送此通知？发送后内容不可编辑。`} confirmLabel="确认发送" loading={sending} onConfirm={() => void confirmSend()} onCancel={() => { if (!sending) setConfirmOpen(false) }} />
    </section>
  )
}
