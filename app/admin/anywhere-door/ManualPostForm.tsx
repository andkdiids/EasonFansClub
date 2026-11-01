'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { MANUAL_POST_ABSOLUTE_IMAGE_MAX_BYTES, MANUAL_POST_MAX_MEDIA, MANUAL_POST_MAX_VIDEO_BYTES } from '@/lib/anywhere-door/manual-media-policy'

type UploadState = 'waiting' | 'uploading' | 'success' | 'failed'
type ManualMediaItem = {
  id: string
  file: File
  previewUrl: string
  type: 'IMAGE' | 'VIDEO' | null
  state: UploadState
  uploadId: string | null
  receipt: string | null
  error: string | null
}
type ExistingManualMatch = { id: string; status: string; sourceUrl: string | null }

function fileType(file: File): ManualMediaItem['type'] {
  const type = file.type.trim().toLowerCase()
  if (['image/jpeg', 'image/png', 'image/webp'].includes(type)) return 'IMAGE'
  if (type === 'video/mp4') return 'VIDEO'
  return null
}

function stateLabel(state: UploadState) {
  if (state === 'uploading') return '上传中'
  if (state === 'success') return '文件上传完成'
  if (state === 'failed') return '失败'
  return '等待'
}

export function ManualPostForm({ onCreated }: Readonly<{ onCreated: () => Promise<void> }>) {
  const formRef = useRef<HTMLFormElement>(null)
  const mediaRef = useRef<ManualMediaItem[]>([])
  const submitLockRef = useRef(false)
  const [media, setMedia] = useState<ManualMediaItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState<'success' | 'existing'>('success')
  const [existingMatch, setExistingMatch] = useState<ExistingManualMatch | null>(null)
  const [error, setError] = useState('')

  function updateMedia(update: (previous: ManualMediaItem[]) => ManualMediaItem[]) {
    const next = update(mediaRef.current)
    mediaRef.current = next
    setMedia(next)
  }

  useEffect(() => () => {
    for (const item of mediaRef.current) URL.revokeObjectURL(item.previewUrl)
  }, [])

  async function uploadItem(item: ManualMediaItem) {
    if (!item.type) return
    updateMedia((previous) => previous.map((current) => current.id === item.id
      ? { ...current, state: 'uploading', error: null }
      : current))
    const body = new FormData()
    body.set('file', item.file)
    try {
      const response = await fetch('/api/admin/anywhere-door/posts/manual/media', { method: 'POST', body, credentials: 'same-origin' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || typeof payload?.media?.receipt !== 'string') throw new Error(payload?.message || '上传失败，可重试或移除')
      const current = mediaRef.current.find((entry) => entry.id === item.id)
      if (!current) {
        await fetch('/api/admin/anywhere-door/posts/manual/media', {
          method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receipt: payload.media.receipt }),
        }).catch(() => undefined)
        return
      }
      updateMedia((previous) => previous.map((entry) => entry.id === item.id
        ? { ...entry, state: 'success', uploadId: payload.media.uploadId, receipt: payload.media.receipt, type: payload.media.type, error: null }
        : entry))
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : '上传失败，可重试或移除'
      updateMedia((previous) => previous.map((entry) => entry.id === item.id
        ? { ...entry, state: 'failed', uploadId: null, receipt: null, error: reason }
        : entry))
      setError(`${item.file.name}：${reason}`)
    }
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    setError('')
    if (!selected.length) return
    const available = Math.max(0, MANUAL_POST_MAX_MEDIA - mediaRef.current.length)
    if (selected.length > available) setError(`最多选择 ${MANUAL_POST_MAX_MEDIA} 个媒体文件`)
    const added = selected.slice(0, available).map((file) => {
      const type = fileType(file)
      const sizeLimit = type === 'VIDEO' ? MANUAL_POST_MAX_VIDEO_BYTES : MANUAL_POST_ABSOLUTE_IMAGE_MAX_BYTES
      const tooLarge = file.size > sizeLimit
      return {
        id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), type,
        state: type && !tooLarge ? 'waiting' as const : 'failed' as const,
        uploadId: null,
        receipt: null,
        error: !type ? '仅支持 JPG、JPEG、PNG、WebP 图片及 MP4 视频' : tooLarge ? `${type === 'VIDEO' ? '视频' : '图片'}超过大小限制` : null,
      }
    })
    updateMedia((previous) => [...previous, ...added])
    for (const item of added) {
      if (item.state === 'waiting') void uploadItem(item)
      else if (item.error) setError(`${item.file.name}：${item.error}`)
    }
  }

  async function removeItem(item: ManualMediaItem) {
    if (item.state === 'uploading') return
    setError('')
    if (item.receipt) {
      try {
        const response = await fetch('/api/admin/anywhere-door/posts/manual/media', {
          method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receipt: item.receipt }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.message || '上传文件清理失败，请稍后重试')
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '上传文件清理失败，请稍后重试')
        return
      }
    }
    URL.revokeObjectURL(item.previewUrl)
    updateMedia((previous) => previous.filter((entry) => entry.id !== item.id))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitLockRef.current) return
    const currentMedia = mediaRef.current
    if (currentMedia.some((item) => item.state !== 'success' || !item.receipt)) {
      setError('请等待媒体上传完成；失败文件可单独重试或移除')
      return
    }
    submitLockRef.current = true
    setBusy(true)
    setMessage('')
    setExistingMatch(null)
    setError('')
    try {
      const form = event.currentTarget
      const data = new FormData(form)
      const rawDate = String(data.get('publishedAt') || '')
      const publishedAt = new Date(rawDate)
      if (!Number.isFinite(publishedAt.getTime())) throw new Error('请填写有效的原始发布时间')
      data.set('publishedAt', publishedAt.toISOString())
      data.set('mediaReceipts', JSON.stringify(currentMedia.map((item) => item.receipt)))
      const response = await fetch('/api/admin/anywhere-door/posts/manual', { method: 'POST', body: data, credentials: 'same-origin' })
      const payload = await response.json().catch(() => null)
      const invalidated = new Set<string>([
        ...(Array.isArray(payload?.invalidatedUploadIds) ? payload.invalidatedUploadIds : []),
        ...(Array.isArray(payload?.result?.invalidatedUploadIds) ? payload.result.invalidatedUploadIds : []),
      ].filter((value): value is string => typeof value === 'string'))
      if (!response.ok && invalidated.size) {
        const retryItems: ManualMediaItem[] = []
        updateMedia((previous) => previous.map((item) => {
          if (!item.uploadId || !invalidated.has(item.uploadId)) return item
          const reset = { ...item, state: 'waiting' as const, uploadId: null, receipt: null, error: null }
          retryItems.push(reset)
          return reset
        }))
        for (const item of retryItems) void uploadItem(item)
      }
      if (!response.ok && payload?.code === 'MEDIA_RECEIPTS_INVALID') {
        const expiredItems = mediaRef.current.filter((item) => item.state === 'success' && item.receipt)
        const resetItems: ManualMediaItem[] = []
        for (const item of expiredItems) {
          const cleanup = await fetch('/api/admin/anywhere-door/posts/manual/media', {
            method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receipt: item.receipt }),
          }).then((result) => result.ok).catch(() => false)
          if (cleanup) {
            const reset = { ...item, state: 'waiting' as const, uploadId: null, receipt: null, error: null }
            resetItems.push(reset)
            updateMedia((previous) => previous.map((entry) => entry.id === item.id ? reset : entry))
          } else {
            updateMedia((previous) => previous.map((entry) => entry.id === item.id
              ? { ...entry, state: 'failed', error: '上传凭证已过期，旧文件清理失败；请重试清理或移除后重新上传' }
              : entry))
          }
        }
        for (const item of resetItems) void uploadItem(item)
      }
      if (!response.ok) {
        const detail = payload?.message || '内容补录失败，请保留表单后重试'
        throw new Error(response.status === 429
          ? `${detail} 已上传文件和填写内容均已保留，请稍后重新提交。`
          : detail)
      }
      const result = payload?.result
      if (result?.deduplicated) {
        setMessageKind('existing')
        setExistingMatch({
          id: String(result.postId || ''),
          status: String(result.existingStatus || 'UNKNOWN'),
          sourceUrl: typeof result.sourceUrl === 'string' ? result.sourceUrl : null,
        })
        setMessage('该来源内容已存在，没有创建新动态。')
      } else {
        setMessageKind('success')
        setMessage(result?.recovered
          ? `补录成功，已恢复原失败记录（${result.postId}）；公开时间线仍按原始发布时间排序。`
          : `补录成功（${result?.postId || '记录编号暂不可用'}），前台作者显示为 mreasonchan。`)
      }
      for (const item of mediaRef.current) URL.revokeObjectURL(item.previewUrl)
      mediaRef.current = []
      setMedia([])
      formRef.current?.reset()
      try {
        await onCreated()
      } catch {
        setError('内容已保存，但列表刷新失败；请稍后刷新页面确认，避免重复补录。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '内容补录失败，请重试')
    } finally {
      submitLockRef.current = false
      setBusy(false)
    }
  }

  const uploading = media.some((item) => item.state === 'uploading' || item.state === 'waiting')
  const hasFailed = media.some((item) => item.state === 'failed')

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">内容兜底</p>
        <h2 className="mt-2 text-xl font-black text-brand-950">手动补录真实动态</h2>
        <p className="mt-1 text-sm font-bold leading-6 text-slate-500">仅补录 mreasonchan 的真实公开内容；记录原始发布时间和可选原文链接。图片与视频经腾讯 COS 存储，管理员身份只记入后台审计。</p>
      </div>
      <form ref={formRef} onSubmit={submit} className="mt-5 grid gap-4">
        <label className="grid gap-1.5 text-sm font-black text-brand-950">正文（可留空；纯文字动态填写此项）<textarea name="caption" maxLength={10_000} rows={5} className="rounded-2xl border border-slate-200 px-4 py-3 font-medium leading-6 outline-none focus:border-brand-500" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-black text-brand-950">原始发布时间<input name="publishedAt" type="datetime-local" required className="min-h-11 rounded-xl border border-slate-200 px-3 font-medium outline-none focus:border-brand-500" /></label>
          <label className="grid gap-1.5 text-sm font-black text-brand-950">原文链接（可选）<input name="sourceUrl" type="url" placeholder="https://www.instagram.com/p/.../" className="min-h-11 rounded-xl border border-slate-200 px-3 font-medium outline-none focus:border-brand-500" /></label>
        </div>
        <div className="grid gap-2 text-sm font-black text-brand-950">
          <label htmlFor="manual-post-media">图片 / 视频（可选）</label>
          <input id="manual-post-media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,.jpg,.jpeg,.png,.webp,.mp4" multiple onChange={addFiles} className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" />
          <p className="text-xs font-bold text-slate-400">支持图片、MP4 视频及图片+视频混合上传，可一次选择多个文件；最多 {MANUAL_POST_MAX_MEDIA} 个。图片大小沿用后台配置（默认 20MB），视频上限 50MB。媒体按选择顺序发布。</p>
        </div>
        {media.length ? <ol className="grid gap-3 sm:grid-cols-2" aria-label="已选择的图片和视频">
          {media.map((item, index) => <li key={item.id} className="flex min-w-0 gap-3 rounded-2xl border border-slate-200 p-3">
            {item.type === 'IMAGE'
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={item.previewUrl} alt={`图片 ${index + 1} 预览`} className="size-20 shrink-0 rounded-xl bg-slate-100 object-cover" />
              : item.type === 'VIDEO'
                ? <video src={item.previewUrl} muted playsInline preload="metadata" className="size-20 shrink-0 rounded-xl bg-slate-950 object-contain" aria-label={`视频 ${index + 1} 预览`} />
                : <div className="grid size-20 shrink-0 place-items-center rounded-xl bg-slate-100 text-xs font-black text-slate-500">不支持</div>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-black text-slate-800" title={item.file.name}>{item.file.name}</p>
              <p className="mt-1 text-xs font-bold text-slate-500">{item.type === 'VIDEO' ? '视频 MP4' : item.type === 'IMAGE' ? '图片' : '文件'} · {stateLabel(item.state)}</p>
              {item.error ? <p className="mt-1 text-xs font-bold text-red-600">{item.error}</p> : null}
              <div className="mt-2 flex gap-3">
                {item.state === 'failed' && item.type ? <button type="button" onClick={() => void uploadItem(item)} className="text-xs font-black text-brand-700 hover:underline">重试</button> : null}
                <button type="button" disabled={item.state === 'uploading'} onClick={() => void removeItem(item)} className="text-xs font-black text-red-600 hover:underline disabled:opacity-50">移除</button>
              </div>
            </div>
          </li>)}
        </ol> : null}
        {message ? <div className={`rounded-xl px-3 py-2 text-sm font-bold ${messageKind === 'existing' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`} role="status">
          <p>{message}</p>
          {existingMatch?.id ? <p className="mt-1 break-all text-xs">已有 SocialPost：{existingMatch.id} · 状态 {existingMatch.status}{existingMatch.sourceUrl ? <> · <a href={existingMatch.sourceUrl} target="_blank" rel="noreferrer" className="underline">打开原文</a></> : null}</p> : null}
        </div> : null}
        {error ? <p className="text-sm font-bold text-red-600" role="alert">{error}</p> : null}
        <div><button type="submit" disabled={busy || uploading || hasFailed} className="min-h-11 rounded-full bg-brand-950 px-5 text-sm font-black text-white disabled:cursor-wait disabled:opacity-50">{busy ? '正在补录…' : uploading ? '媒体上传中…' : '补录动态'}</button></div>
      </form>
    </section>
  )
}
