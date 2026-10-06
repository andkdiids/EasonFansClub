'use client'

import { useCallback, useEffect, useState } from 'react'
import { TopicActivityImagePicker } from '@/components/activities/TopicActivityImagePicker'
import type { TopicActivityUploadedAsset } from '@/lib/content-image-browser'

type Submission = {
  id: string
  user?: { id: string; nickname: string; avatarUrl: string | null }
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
  submittedAt: string
  rejectReason: string | null
  answersSnapshot: Array<{ fieldId: string; label: string; type: string; value: string | string[] | TopicActivityUploadedAsset[]; displayValue?: string }>
  replies: Array<{ id: string; content: string | null; createdAt: string; images: TopicActivityUploadedAsset[] }>
}

type SubmissionCounts = { commentSubmissions: number; formSubmissions: number; pendingForms: number; approvedForms: number; rejectedForms: number; withdrawnForms: number; approvedUsers: number }

export function TopicActivityFormSubmissionManager({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [counts, setCounts] = useState<SubmissionCounts | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [alreadyCountedId, setAlreadyCountedId] = useState<string | null>(null)
  const [pendingReview, setPendingReview] = useState<{ submissionId: string; status: 'APPROVED' | 'REJECTED' } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [images, setImages] = useState<TopicActivityUploadedAsset[]>([])
  const [filter, setFilter] = useState('PENDING')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async (nextPage = 1, append = false) => {
    if (!append) setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/form-submissions?status=${filter}&page=${nextPage}&pageSize=20`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '表单提交暂时无法加载')
      const rows: Submission[] = Array.isArray(data?.submissions) ? data.submissions : []
      setSubmissions((current) => append ? [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))] : rows)
      setCounts(data?.counts || null)
      setPage(Number(data?.page) || nextPage)
      setHasMore(data?.hasMore === true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '表单提交暂时无法加载') }
    finally { if (!append) setLoading(false) }
  }, [activityId, filter])
  useEffect(() => { void load() }, [load])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try { await load(page + 1, true) }
    finally { setLoadingMore(false) }
  }

  async function review(submissionId: string, status: 'APPROVED' | 'REJECTED', reason = '') {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/admin/topic-activity-form-submissions/${encodeURIComponent(submissionId)}/review`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, rejectReason: status === 'REJECTED' ? reason : '' }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '审核失败')
      setAlreadyCountedId(data?.alreadyCounted === true ? submissionId : null)
      setPendingReview(null); setRejectReason('')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审核失败') }
    finally { setBusy(false) }
  }

  async function reply(submissionId: string) {
    if (!content.trim() && !images.length) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/admin/topic-activity-form-submissions/${encodeURIComponent(submissionId)}/replies`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, assetIds: images.map((image) => image.assetId) }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '回复失败')
      setContent(''); setImages([]); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '回复失败') }
    finally { setBusy(false) }
  }

  return <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black tracking-[0.15em] text-emerald-700 dark:text-emerald-300">TOPIC ACTIVITY</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-slate-100">参与表单审核</h2></div><button type="button" onClick={onClose} className="rounded-full border px-4 py-2 text-sm font-bold">关闭</button></div>
    {counts ? <p className="mt-3 text-xs font-bold text-slate-500">评论提交 {counts.commentSubmissions} · 表单提交 {counts.formSubmissions}（待审核 {counts.pendingForms} / 通过 {counts.approvedForms} / 拒绝 {counts.rejectedForms} / 撤回 {counts.withdrawnForms}）· 通过用户 {counts.approvedUsers}</p> : null}<div className="mt-4 flex flex-wrap gap-2">{[['PENDING','待审核'],['APPROVED','已通过'],['REJECTED','已拒绝'],['WITHDRAWN','已撤回'],['ALL','全部']].map(([value,label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-2 text-sm font-bold ${filter === value ? 'bg-emerald-700 text-white' : 'border border-slate-200 dark:border-slate-700'}`}>{label}</button>)}</div>
    {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}{loading ? <p className="py-8 text-center text-sm text-slate-500">正在加载…</p> : !submissions.length ? <p className="py-8 text-center text-sm text-slate-500">暂无表单提交</p> : <div className="mt-4 space-y-3">{submissions.map((submission) => { const expanded = selectedId === submission.id; const statusLabel = submission.status === 'PENDING' ? '待审核' : submission.status === 'APPROVED' ? '已通过' : submission.status === 'WITHDRAWN' ? '已撤回' : '已拒绝'; return <article key={submission.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{submission.user?.avatarUrl ? <img src={submission.user.avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 font-black dark:bg-slate-800">{(submission.user?.nickname || '用').slice(0, 1)}</span>}<div className="min-w-0"><p className="break-words font-black">{submission.user?.nickname || '用户'} <span className="ml-2 text-xs font-bold text-slate-500">提交 #{submission.id.slice(-6)} · {statusLabel}</span></p><time className="mt-1 block text-xs text-slate-500">{new Date(submission.submittedAt).toLocaleString()}</time></div></div><button type="button" onClick={() => { setSelectedId(expanded ? null : submission.id); setContent(''); setImages([]) }} className="rounded-lg border px-3 py-2 text-sm font-bold">{expanded ? '收起详情' : '查看详情 / 回复'}</button></div>
      {expanded ? <><div className="mt-4 space-y-3">{submission.answersSnapshot.map((answer) => <div key={answer.fieldId} className="text-sm"><p className="font-black">{answer.label}</p>{answer.type === 'IMAGE' && Array.isArray(answer.value) ? <div className="mt-1 flex flex-wrap gap-2">{answer.value.map((item) => typeof item === 'string' ? null : <img key={item.assetId} src={item.url} alt="用户表单附件" className="size-28 rounded-lg object-cover" />)}</div> : <p className="mt-1 whitespace-pre-wrap">{answer.displayValue || (Array.isArray(answer.value) ? answer.value.join('、') : answer.value)}</p>}</div>)}</div>
        <div className="mt-4 flex gap-2">{submission.status !== 'APPROVED' && submission.status !== 'WITHDRAWN' ? <button disabled={busy} type="button" onClick={() => setPendingReview({ submissionId: submission.id, status: 'APPROVED' })} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{submission.status === 'PENDING' ? '通过' : '改为通过'}</button> : submission.status === 'APPROVED' ? <span className="self-center text-xs font-bold text-slate-500">已通过</span> : null}{submission.status !== 'REJECTED' && submission.status !== 'WITHDRAWN' ? <button disabled={busy} type="button" onClick={() => { setRejectReason(''); setPendingReview({ submissionId: submission.id, status: 'REJECTED' }) }} className="rounded-lg bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-50">{submission.status === 'PENDING' ? '拒绝' : '改为未通过'}</button> : submission.status === 'REJECTED' ? <span className="self-center text-xs font-bold text-slate-500">已拒绝</span> : submission.status === 'WITHDRAWN' ? <span className="self-center text-xs font-bold text-slate-500">已撤回</span> : null}</div>
        {alreadyCountedId === submission.id ? <p className="mt-2 text-xs font-bold text-slate-500">该用户已计入本活动，本次通过不会重复累计活动次数或重复获得奖励。</p> : null}
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="text-sm font-black">管理员回复历史</h3>{submission.replies.map((replyItem) => <div key={replyItem.id} className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900"><time className="text-xs text-slate-500">{new Date(replyItem.createdAt).toLocaleString()}</time>{replyItem.content ? <p className="mt-1 whitespace-pre-wrap text-sm">{replyItem.content}</p> : null}<div className="mt-2 flex gap-2">{replyItem.images.map((image) => <img key={image.assetId} src={image.thumbnailUrl} alt="回复附件" className="size-20 rounded object-cover" />)}</div></div>)}<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} rows={3} placeholder="回复用户（可选）" className="mt-3 w-full rounded-lg border border-slate-200 bg-transparent p-3 text-sm dark:border-slate-700" /><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><TopicActivityImagePicker activityId={activityId} purpose="ADMIN_REPLY" assets={images} onChange={setImages} maxImages={9} disabled={busy} /><button disabled={busy || (!content.trim() && !images.length)} type="button" onClick={() => void reply(submission.id)} className="min-h-10 rounded-lg bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">{busy ? '发送中…' : '发送回复'}</button></div></div>
      </> : null}</article> })}{hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="min-h-10 rounded-lg border px-4 text-sm font-bold disabled:opacity-50">{loadingMore ? '加载中…' : '加载更多'}</button> : null}</div>}
    {pendingReview ? <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4" role="presentation"><section role="alertdialog" aria-modal="true" aria-labelledby="topic-form-review-confirm-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"><h3 id="topic-form-review-confirm-title" className="text-lg font-black">{pendingReview.status === 'APPROVED' ? '确认通过这份参与表单？' : '确认拒绝这份参与表单？'}</h3><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{pendingReview.status === 'APPROVED' ? '首次有效通过将按活动规则计入参与，并可能触发奖励；同一活动不会重复累计或重复发奖。' : '该表单状态将更新为未通过。拒绝原因可选，提交后用户可在自己的参与记录中查看。'}</p>{pendingReview.status === 'REJECTED' ? <label className="mt-4 block text-sm font-bold">拒绝原因（可选）<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={2000} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent p-3 text-sm dark:border-slate-600" /></label> : null}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setPendingReview(null)} className="min-h-10 rounded-lg border px-4 text-sm font-bold disabled:opacity-50">取消</button><button type="button" disabled={busy} onClick={() => void review(pendingReview.submissionId, pendingReview.status, rejectReason)} className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-50">{busy ? '处理中…' : pendingReview.status === 'APPROVED' ? '确认通过' : '确认拒绝'}</button></div></section></div> : null}
  </section>
}

export function TopicActivityFormSubmissionEntry({ activityId, count }: { activityId: string; count: number }) {
  const [open, setOpen] = useState(false)
  return <div className="mt-5">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-700 px-4 text-sm font-black text-emerald-800 dark:text-emerald-200">
      表单提交（{count}）
    </button>
    {open ? <div className="mt-4"><TopicActivityFormSubmissionManager activityId={activityId} onClose={() => setOpen(false)} /></div> : null}
  </div>
}
