'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { TopicActivityImagePicker } from '@/components/activities/TopicActivityImagePicker'
import type { TopicActivityUploadedAsset } from '@/lib/content-image-browser'
import type { TopicActivityFormField, TopicActivityFormSchema } from '@/lib/topic-activity-form'

type FormSubmission = {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  submittedAt: string
  rejectReason: string | null
  formSchemaSnapshot: TopicActivityFormSchema
  answersSnapshot: Array<{ fieldId: string; label: string; type: string; value: string | string[] | TopicActivityUploadedAsset[]; displayValue?: string }>
  replies: Array<{ id: string; content: string | null; createdAt: string; sender: { nickname: string }; images: TopicActivityUploadedAsset[] }>
}

function statusLabel(status: string) { return status === 'APPROVED' ? '已通过' : status === 'REJECTED' ? '未通过' : '待管理员审核' }

export function TopicActivityFormParticipation({ activityId, isAuthenticated }: { activityId: string; isAuthenticated: boolean }) {
  const [schema, setSchema] = useState<TopicActivityFormSchema | null>(null)
  const [values, setValues] = useState<Record<string, string | string[]>>({})
  const [imageAssets, setImageAssets] = useState<Record<string, TopicActivityUploadedAsset[]>>({})
  const [history, setHistory] = useState<FormSubmission[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [focusSubmissionId, setFocusSubmissionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const loadHistory = useCallback(async (page = 1, append = false) => {
    if (!isAuthenticated) return
    const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/my-form-submissions?page=${page}&pageSize=20`, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) {
      if (!append) setError('我的提交暂时无法加载，请稍后重试')
      return
    }
    const data = await response.json().catch(() => null)
    let rows: FormSubmission[] = Array.isArray(data?.submissions) ? data.submissions : []
    const targetId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('submissionId') : null
    if (page === 1 && targetId) {
      setFocusSubmissionId(targetId)
      if (!rows.some((row) => row.id === targetId)) {
        try {
          const targetResponse = await fetch(`/api/topic-activity-form-submissions/${encodeURIComponent(targetId)}`, { credentials: 'same-origin', cache: 'no-store' })
          const targetData = await targetResponse.json().catch(() => null)
          if (targetResponse.ok && targetData?.submission?.activityId === activityId) rows = [targetData.submission as FormSubmission, ...rows]
        } catch { /* Keep the regular list available if the notification target is stale. */ }
      }
      rows = [...rows].sort((a, b) => Number(b.id === targetId) - Number(a.id === targetId))
    }
    setHistory((current) => append ? [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))] : rows)
    setHistoryPage(Number(data?.page) || page)
    setHistoryHasMore(data?.hasMore === true)
  }, [activityId, isAuthenticated])
  useEffect(() => {
    let active = true
    void fetch(`/api/activities/${encodeURIComponent(activityId)}/form`, { cache: 'no-store' }).then(async (response) => {
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '参与表单暂时无法加载')
      if (active) setSchema(data?.schema || null)
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '参与表单暂时无法加载') })
    void loadHistory()
    return () => { active = false }
  }, [activityId, loadHistory])

  useEffect(() => {
    if (!focusSubmissionId) return
    document.getElementById(`form-submission-${focusSubmissionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusSubmissionId, history])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!schema || busy) return
    const missing = schema.fields.find((field) => {
      if (!field.required) return false
      const value = values[field.id]
      return Array.isArray(value) ? value.length === 0 : typeof value !== 'string' || !value.trim()
    })
    if (missing) { setError(`请完成必填项：${missing.label}`); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/form-submissions`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: values }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '提交失败，请稍后重试')
      setValues({})
      setImageAssets({})
      setMessage('提交成功，待管理员审核')
      await loadHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提交失败，请稍后重试') }
    finally { setBusy(false) }
  }

  async function loadMoreHistory() {
    if (loadingMore || !historyHasMore) return
    setLoadingMore(true)
    try { await loadHistory(historyPage + 1, true) }
    finally { setLoadingMore(false) }
  }

  function renderField(field: TopicActivityFormField) {
    const value = values[field.id] ?? (field.type === 'MULTI_SELECT' || field.type === 'IMAGE' ? [] : '')
    if (field.type === 'IMAGE') {
      return <TopicActivityImagePicker key={field.id} activityId={activityId} purpose="FORM_ANSWER" assets={imageAssets[field.id] || []} maxImages={field.maxImages} onChange={(next) => { setImageAssets((current) => ({ ...current, [field.id]: next })); setValues((current) => ({ ...current, [field.id]: next.map((asset) => asset.assetId) })) }} />
    }
    if (field.type === 'SINGLE_SELECT') return <select required={field.required} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"><option value="">请选择</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    if (field.type === 'MULTI_SELECT') return <div className="mt-3 grid gap-2">{field.options.map((option) => { const current = Array.isArray(value) ? value : []; return <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm"><input type="checkbox" checked={current.includes(option.value)} onChange={(event) => setValues((state) => ({ ...state, [field.id]: event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value) }))} /><span className="min-w-0 break-words">{option.label}</span></label> })}</div>
    const common = { required: field.required, value: String(value), maxLength: field.type === 'TEXTAREA' ? 8000 : 500, placeholder: field.placeholder || '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [field.id]: event.target.value })), className: 'mt-2 min-h-11 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--foreground-muted)]' }
    return field.type === 'TEXTAREA' ? <textarea {...common} rows={4} /> : <input {...common} />
  }

  return <section id={`topic-activity-form-${activityId}`} className="topic-activity-participation-form mt-5 w-full min-w-0 space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
    <div className="border-b border-[var(--border)] pb-4"><p className="text-xs font-black tracking-[0.14em] text-[var(--primary)]">参与活动</p><h2 className="mt-1 text-xl font-black text-[var(--foreground)]">填写参与表单</h2><p className="mt-1 text-sm leading-6 text-[var(--foreground-muted)]">每次提交都会单独审核；同一活动的参与奖励最多计入一次。</p></div>
    {!isAuthenticated ? <p className="text-sm font-bold text-[var(--foreground-muted)]">登录后即可填写表单。</p> : schema ? <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-5">{schema.fields.map((field) => <fieldset key={field.id} className="min-w-0"><legend className="max-w-full break-words text-sm font-black text-[var(--foreground)]">{field.label}{field.required ? <span className="ml-1 text-[var(--danger)]">*</span> : null}</legend>{field.placeholder ? <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">{field.placeholder}</p> : null}<div className="min-w-0">{renderField(field)}</div></fieldset>)}<button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-[var(--primary)] px-5 text-sm font-black text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50">{busy ? '提交中…' : '提交参与内容'}</button></form> : error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : <p className="text-sm text-[var(--foreground-muted)]">正在加载表单…</p>}
    {message ? <p role="status" className="text-sm font-bold text-emerald-700">{message}</p> : null}{error && schema ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    {history.length ? <div className="border-t border-[var(--border)] pt-4"><h3 className="font-black">我的提交</h3><div className="mt-3 space-y-3">{history.map((submission) => <article key={submission.id} id={`form-submission-${submission.id}`} className={`rounded-lg p-3 ${submission.id === focusSubmissionId ? 'outline outline-2 outline-[var(--primary)]' : 'bg-[var(--background)]'}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{statusLabel(submission.status)}</strong><time className="text-xs text-[var(--foreground-muted)]">{new Date(submission.submittedAt).toLocaleString()}</time></div>{submission.answersSnapshot.map((answer) => <div key={answer.fieldId} className="mt-2 text-sm"><span className="font-bold">{answer.label}：</span>{answer.type === 'IMAGE' && Array.isArray(answer.value) ? answer.value.map((item) => typeof item === 'string' ? null : <img key={item.assetId} src={item.thumbnailUrl} alt="表单附件" className="mr-2 mt-2 inline-block size-20 rounded object-cover" />) : answer.displayValue || (Array.isArray(answer.value) ? answer.value.join('、') : answer.value)}</div>)}{submission.rejectReason ? <p className="mt-2 text-sm text-red-700">原因：{submission.rejectReason}</p> : null}{submission.replies.map((reply) => <div key={reply.id} className="mt-3 rounded-lg border border-[var(--border)] p-3"><p className="text-xs font-bold text-[var(--foreground-muted)]">管理员回复 · {new Date(reply.createdAt).toLocaleString()}</p>{reply.content ? <p className="mt-1 whitespace-pre-wrap text-sm">{reply.content}</p> : null}<div className="mt-2 flex gap-2">{reply.images.map((image) => <img key={image.assetId} src={image.thumbnailUrl} alt="管理员回复附件" className="size-20 rounded object-cover" />)}</div></div>)}</article>)}</div>{historyHasMore ? <button type="button" onClick={() => void loadMoreHistory()} disabled={loadingMore} className="mt-3 min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-bold disabled:opacity-50">{loadingMore ? '加载中…' : '加载更多提交'}</button> : null}</div> : null}
  </section>
}
