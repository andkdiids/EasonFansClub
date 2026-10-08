'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { TopicActivityImagePicker } from '@/components/activities/TopicActivityImagePicker'
import { TopicActivityOriginalImage } from '@/components/activities/TopicActivityOriginalImage'
import type { TopicActivityUploadedAsset } from '@/lib/content-image-browser'
import { validateTopicActivityFormAnswers, type TopicActivityFormField, type TopicActivityFormSchema } from '@/lib/topic-activity-form'

export const TOPIC_ACTIVITY_FORM_SUBMITTED_EVENT = 'ecfc:topic-activity-form-submitted'
export const TOPIC_ACTIVITY_OPEN_FORM_EVENT = 'ecfc:topic-activity-open-form'

type FormAnswer = {
  fieldId: string
  label: string
  type: string
  value: string | string[] | TopicActivityUploadedAsset[]
  displayValue?: string
}

type FormReply = {
  id: string
  content: string | null
  createdAt: string
  sender?: { nickname: string }
  images?: TopicActivityUploadedAsset[]
  attachments?: TopicActivityUploadedAsset[]
  originalDownloadBaseUrl?: string
}

type FormSubmission = {
  id: string
  status: 'SUBMITTED' | 'REPLIED'
  submittedAt: string
  formSchemaSnapshot?: TopicActivityFormSchema
  answersSnapshot: FormAnswer[]
  attachments?: TopicActivityUploadedAsset[]
  replies: FormReply[]
}

type FormActivityMetadata = { startsAt: string | null; endsAt: string | null; activityPostId: string | null }

function statusLabel(status: FormSubmission['status']) { return status === 'REPLIED' ? '管理员已回复' : '已提交' }

function assetUrl(asset: TopicActivityUploadedAsset) { return asset.thumbnailUrl || asset.url }

export function TopicActivityFormParticipation({ activityId, isAuthenticated, activityPostId = null }: { activityId: string; isAuthenticated: boolean; activityPostId?: string | null }) {
  const [schema, setSchema] = useState<TopicActivityFormSchema | null>(null)
  const [formActivity, setFormActivity] = useState<FormActivityMetadata>({ startsAt: null, endsAt: null, activityPostId })
  const [allowImageAttachments, setAllowImageAttachments] = useState(false)
  const [values, setValues] = useState<Record<string, string | string[]>>({})
  const [imageAssets, setImageAssets] = useState<Record<string, TopicActivityUploadedAsset[]>>({})
  const [attachmentAssets, setAttachmentAssets] = useState<TopicActivityUploadedAsset[]>([])
  const [history, setHistory] = useState<FormSubmission[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [focusSubmissionId, setFocusSubmissionId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploadingPickers, setUploadingPickers] = useState<Record<string, boolean>>({})
  const [formError, setFormError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [message, setMessage] = useState('')
  const [now, setNow] = useState<number | null>(null)
  const submitLockRef = useRef(false)
  const loadForm = useCallback(async () => {
    setFormError('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/form`, { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '参与表单暂时无法加载')
      const responseActivity = data?.activity && typeof data.activity === 'object' ? data.activity as Record<string, unknown> : {}
      setSchema(data?.schema || null)
      setAllowImageAttachments(data?.allowImageAttachments === true || responseActivity.allowImageAttachments === true)
      setFormActivity({
        startsAt: typeof responseActivity.startsAt === 'string' ? responseActivity.startsAt : null,
        endsAt: typeof responseActivity.endsAt === 'string' ? responseActivity.endsAt : null,
        activityPostId: typeof responseActivity.activityPostId === 'string' ? responseActivity.activityPostId : activityPostId,
      })
    } catch (cause) {
      setSchema(null)
      setAllowImageAttachments(false)
      setFormError(cause instanceof Error ? cause.message : '参与表单暂时无法加载')
    }
  }, [activityId, activityPostId])

  const loadHistory = useCallback(async (page = 1, append = false) => {
    if (!isAuthenticated) return
    if (!append) setHistoryError('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/my-form-submissions?page=${page}&pageSize=20`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '我的提交暂时无法加载')
      let rows: FormSubmission[] = Array.isArray(data?.submissions) ? data.submissions : []
      const targetId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('submissionId') : null
      if (page === 1 && targetId) {
        setFocusSubmissionId(targetId)
        setExpanded(true)
        if (!rows.some((row) => row.id === targetId)) {
          try {
            const targetResponse = await fetch(`/api/topic-activity-form-submissions/${encodeURIComponent(targetId)}`, { credentials: 'same-origin', cache: 'no-store' })
            const targetData = await targetResponse.json().catch(() => null)
            if (targetResponse.ok && targetData?.submission?.activityId === activityId) rows = [targetData.submission as FormSubmission, ...rows]
          } catch {
            // Keep the regular history available if the notification target is stale.
          }
        }
        rows = [...rows].sort((a, b) => Number(b.id === targetId) - Number(a.id === targetId))
      }
      setHistory((current) => append ? [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))] : rows)
      setHasSubmitted((current) => current || rows.length > 0 || Number(data?.total) > 0)
      setHistoryReady(true)
      setHistoryPage(Number(data?.page) || page)
      setHistoryHasMore(data?.hasMore === true)
    } catch (cause) {
      if (!append) setHistoryError(cause instanceof Error ? cause.message : '我的提交暂时无法加载')
    }
  }, [activityId, isAuthenticated])

  useEffect(() => {
    setHistoryReady(false)
    setHasSubmitted(false)
    setHistory([])
    void loadForm()
    void loadHistory()
  }, [loadForm, loadHistory])

  useEffect(() => {
    if (!formActivity.endsAt) {
      setNow(null)
      return
    }
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 30_000)
    return () => window.clearInterval(timer)
  }, [formActivity.endsAt])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const targetId = new URLSearchParams(window.location.search).get('submissionId')
    if (targetId) {
      setFocusSubmissionId(targetId)
      setExpanded(true)
    }
  }, [activityId])

  useEffect(() => {
    const openForm = (event: Event) => {
      const detail = (event as CustomEvent<{ activityId?: unknown }>).detail
      if (detail?.activityId !== activityId) return
      setExpanded(true)
      setMessage('')
      window.requestAnimationFrame(() => document.getElementById(`topic-activity-form-${activityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
    window.addEventListener(TOPIC_ACTIVITY_OPEN_FORM_EVENT, openForm)
    return () => window.removeEventListener(TOPIC_ACTIVITY_OPEN_FORM_EVENT, openForm)
  }, [activityId])

  useEffect(() => {
    if (!focusSubmissionId) return
    document.getElementById(`form-submission-${focusSubmissionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusSubmissionId, history])

  const formEnded = Boolean(formActivity.endsAt && now !== null && new Date(formActivity.endsAt).getTime() <= now)
  const discussionPostId = formActivity.activityPostId || activityPostId
  const discussionHref = discussionPostId ? `/posts/${encodeURIComponent(discussionPostId)}#post-comments-${encodeURIComponent(discussionPostId)}` : null
  const uploading = Object.values(uploadingPickers).some(Boolean)

  function setPickerUploading(key: string, value: boolean) {
    setUploadingPickers((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!schema || busy || uploading || submitLockRef.current || hasSubmitted || !historyReady) return
    if (formEnded) {
      setFormError('表单已结束，暂时不能提交。')
      return
    }
    const missing = schema.fields.find((field) => {
      if (!field.required) return false
      const value = values[field.id]
      return Array.isArray(value) ? value.length === 0 : typeof value !== 'string' || !value.trim()
    })
    if (missing) { setFormError(`请完成必填项：${missing.label}`); return }
    const validated = validateTopicActivityFormAnswers(schema, values)
    if (!validated.valid) { setFormError(validated.message); return }
    submitLockRef.current = true
    setBusy(true); setFormError(''); setHistoryError(''); setMessage('')
    const attachmentAssetIds = attachmentAssets.map((asset) => asset.assetId)
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activityId)}/form-submissions`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: values, attachmentAssetIds }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        if (data?.code === 'FORM_ALREADY_SUBMITTED') {
          setHasSubmitted(true)
          await loadHistory()
        }
        throw new Error(data?.message || '提交失败，请稍后重试')
      }
      setHasSubmitted(true)
      setValues({})
      setImageAssets({})
      setAttachmentAssets([])
      setMessage('表单已提交成功。')
      setExpanded(false)
      window.dispatchEvent(new CustomEvent(TOPIC_ACTIVITY_FORM_SUBMITTED_EVENT, { detail: { activityId } }))
      await loadHistory()
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : '提交失败，请稍后重试') }
    finally { submitLockRef.current = false; setBusy(false) }
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
      return <TopicActivityImagePicker key={field.id} activityId={activityId} purpose="FORM_ANSWER" assets={imageAssets[field.id] || []} maxImages={field.maxImages} disabled={busy || formEnded} onUploadingChange={(value) => setPickerUploading(`field:${field.id}`, value)} onChange={(next) => { setImageAssets((current) => ({ ...current, [field.id]: next })); setValues((current) => ({ ...current, [field.id]: next.map((asset) => asset.assetId) })) }} />
    }
    if (field.type === 'SINGLE_SELECT') return <select required={field.required} value={String(value)} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)]"><option value="">请选择</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    if (field.type === 'MULTI_SELECT') return <div className="mt-3 grid gap-2">{field.options.map((option) => { const current = Array.isArray(value) ? value : []; return <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm"><input type="checkbox" checked={current.includes(option.value)} onChange={(event) => setValues((state) => ({ ...state, [field.id]: event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value) }))} /><span className="min-w-0 break-words">{option.label}</span></label> })}</div>
    const common = { required: field.required, value: String(value), maxLength: field.type === 'TEXTAREA' ? 8000 : 500, placeholder: field.placeholder || '', onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [field.id]: event.target.value })), className: 'mt-2 min-h-11 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--foreground-muted)]' }
    return field.type === 'TEXTAREA' ? <textarea {...common} rows={4} /> : <input {...common} />
  }

  function renderAttachments(assets: TopicActivityUploadedAsset[], alt: string, className = 'size-20') {
    if (!assets.length) return null
    return <div className="mt-2 flex flex-wrap gap-2">{assets.map((asset) => <img key={asset.assetId} src={assetUrl(asset)} alt={alt} className={`${className} rounded object-cover`} />)}</div>
  }

  function renderReplyAttachments(reply: FormReply) {
    const assets = reply.images || reply.attachments || []
    if (!assets.length) return null
    return <div className="mt-2 flex flex-wrap gap-3">{assets.map((asset) => {
      const originalUrl = asset.originalDownloadUrl || reply.originalDownloadBaseUrl?.replace('__ASSET_ID__', encodeURIComponent(asset.assetId))
      return <div key={asset.assetId} className="space-y-1"><img src={assetUrl(asset)} alt="管理员回复附件" className="size-20 rounded object-cover" />{originalUrl ? <TopicActivityOriginalImage originalUrl={originalUrl} /> : null}</div>
    })}</div>
  }

  return <section id={`topic-activity-form-${activityId}`} className="topic-activity-participation-form mt-5 w-full min-w-0 space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4"><div><p className="text-xs font-black tracking-[0.14em] text-[var(--primary)]">参与活动</p><h2 className="mt-1 text-xl font-black text-[var(--foreground)]">{hasSubmitted ? '已提交表单' : '填写参与表单'}</h2><p className="mt-1 text-sm leading-6 text-[var(--foreground-muted)]">每位用户每个活动只能提交一份表单；提交后可查看资料和管理员回复。</p></div><button type="button" disabled={busy || uploading} aria-expanded={expanded} aria-controls={`topic-activity-form-content-${activityId}`} onClick={() => { setExpanded((value) => !value); setMessage('') }} className="min-h-11 rounded-lg bg-[var(--primary)] px-4 text-sm font-black text-[var(--primary-foreground)]">{expanded ? '收起表单' : hasSubmitted ? '查看已提交表单' : '填写参与表单'}</button></div>
    {message ? <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><p className="font-black">{message}</p><p className="mt-1 leading-6">请按活动要求完成分享后，将截图发布到下方评论区等待审核。</p><div className="mt-3 flex flex-wrap gap-2">{discussionHref ? <Link href={discussionHref} className="inline-flex min-h-10 items-center rounded-lg bg-emerald-700 px-3 text-sm font-black text-white">去评论</Link> : null}<button type="button" onClick={() => { setMessage(''); setExpanded(true) }} className="min-h-10 rounded-lg border border-emerald-700 px-3 text-sm font-black text-emerald-800">查看已提交表单</button></div></div> : null}
    {expanded ? <div id={`topic-activity-form-content-${activityId}`} className="min-w-0 space-y-5">
      {!isAuthenticated ? <p className="text-sm font-bold text-[var(--foreground-muted)]">登录后即可填写表单。</p> : hasSubmitted ? <p className="text-sm text-[var(--foreground-muted)]">表单已提交，可在下方查看资料及管理员回复。</p> : !historyReady ? <div className="text-sm text-[var(--foreground-muted)]"><p>正在确认提交记录…</p>{historyError ? <button type="button" onClick={() => void loadHistory()} className="mt-2 underline">重试读取提交记录</button> : null}</div> : schema ? <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-5">{schema.fields.map((field) => <fieldset key={field.id} className="min-w-0"><legend className="max-w-full break-words text-sm font-black text-[var(--foreground)]">{field.label}{field.required ? <span className="ml-1 text-[var(--danger)]">*</span> : null}</legend>{field.placeholder ? <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">{field.placeholder}</p> : null}<div className="min-w-0">{renderField(field)}</div></fieldset>)}{allowImageAttachments ? <fieldset className="min-w-0"><legend className="text-sm font-black text-[var(--foreground)]">图片附件（可选，最多 9 张）</legend><p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">可上传截图，提交后会单独显示在提交记录中。</p><div className="mt-2"><TopicActivityImagePicker activityId={activityId} purpose="FORM_ANSWER" assets={attachmentAssets} maxImages={9} disabled={busy || formEnded} onUploadingChange={(value) => setPickerUploading('global', value)} onChange={setAttachmentAssets} /></div></fieldset> : null}{formEnded ? <p className="text-sm font-bold text-amber-700">表单已结束，不能再提交；历史提交仍保留。</p> : null}<button type="submit" disabled={busy || uploading || formEnded} className="min-h-11 rounded-lg bg-[var(--primary)] px-5 text-sm font-black text-[var(--primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50">{busy ? '提交中…' : formEnded ? '表单已结束' : '提交参与内容'}</button></form> : formError ? <p role="alert" className="text-sm text-[var(--danger)]">{formError}</p> : <p className="text-sm text-[var(--foreground-muted)]">正在加载表单…</p>}
      {formError && schema ? <p role="alert" className="text-sm text-red-600">{formError}</p> : null}{historyError ? <p role="alert" className="text-sm text-[var(--danger)]">{historyError}</p> : null}
      {history.length ? <div className="border-t border-[var(--border)] pt-4"><h3 className="font-black">我的提交记录</h3><div className="mt-3 space-y-3">{history.map((submission) => <article key={submission.id} id={`form-submission-${submission.id}`} className={`rounded-lg p-3 ${submission.id === focusSubmissionId ? 'outline outline-2 outline-[var(--primary)]' : 'bg-[var(--background)]'}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{statusLabel(submission.status)}</strong><time className="text-xs text-[var(--foreground-muted)]">{new Date(submission.submittedAt).toLocaleString()}</time></div>{submission.answersSnapshot.map((answer) => answer.type === 'IMAGE' ? <div key={answer.fieldId} className="mt-2 text-sm"><span className="font-bold">{answer.label}：</span>{renderAttachments(Array.isArray(answer.value) ? answer.value.filter((item): item is TopicActivityUploadedAsset => typeof item !== 'string') : [], '表单字段图片')}</div> : <div key={answer.fieldId} className="mt-2 text-sm"><span className="font-bold">{answer.label}：</span>{answer.displayValue || (Array.isArray(answer.value) ? answer.value.join('、') : answer.value)}</div>)}{submission.attachments?.length ? <div className="mt-3 text-sm"><span className="font-bold">图片附件：</span>{renderAttachments(submission.attachments, '表单图片附件')}</div> : null}{submission.replies.map((reply) => <div key={reply.id} className="mt-3 rounded-lg border border-[var(--border)] p-3"><p className="text-xs font-bold text-[var(--foreground-muted)]">管理员回复 · {new Date(reply.createdAt).toLocaleString()}</p>{reply.content ? <p className="mt-1 whitespace-pre-wrap text-sm">{reply.content}</p> : null}{renderReplyAttachments(reply)}</div>)}</article>)}</div>{historyHasMore ? <button type="button" onClick={() => void loadMoreHistory()} disabled={loadingMore} className="mt-3 min-h-10 rounded-lg border border-[var(--border)] px-4 text-sm font-bold disabled:opacity-50">{loadingMore ? '加载中…' : '加载更多提交'}</button> : null}</div> : null}
    </div> : null}
  </section>
}
