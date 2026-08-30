'use client'

/* 预览只读取用户刚选取的本地 File 对象，避免引入与 COS 域名绑定的图片配置。 */
/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  formatSalonSession,
  SALON_CATEGORIES,
  SALON_CATEGORY_HINTS,
  SALON_CATEGORY_LABELS,
  type SalonCategoryValue,
  type SalonOptions,
} from '@/lib/salon'

const MAX_FILES = 9
const MAX_FILE_SIZE = 20 * 1024 * 1024
const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

type PreviewFile = { file: File; url: string }

export function SalonUploadForm({ options }: Readonly<{ options: SalonOptions }>) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [category, setCategory] = useState<SalonCategoryValue>('CONCERT')
  const [tourId, setTourId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<PreviewFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const selectedTour = options.tours.find((tour) => tour.id === tourId)
  const sessions = selectedTour?.sessions || []
  const hint = useMemo(() => SALON_CATEGORY_HINTS[category], [category])
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => () => filesRef.current.forEach((item) => URL.revokeObjectURL(item.url)), [])

  function chooseTour(value: string) {
    setTourId(value)
    const tour = options.tours.find((item) => item.id === value)
    setSessionId(tour?.sessions[0]?.id || '')
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    setError('')
    if (!selected.length) return
    if (files.length + selected.length > MAX_FILES) {
      setError(`一次最多上传 ${MAX_FILES} 张图片`)
      return
    }
    const invalid = selected.find((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase() || ''
      return !ACCEPTED_EXTENSIONS.has(extension) || file.size <= 0 || file.size > MAX_FILE_SIZE
    })
    if (invalid) {
      setError('仅支持 JPG、PNG、WEBP，且每张图片不能超过 20MB')
      return
    }
    setFiles((current) => [...current, ...selected.map((file) => ({ file, url: URL.createObjectURL(file) }))])
  }

  function removeFile(index: number) {
    setFiles((current) => {
      const removed = current[index]
      if (removed) URL.revokeObjectURL(removed.url)
      return current.filter((_, itemIndex) => itemIndex !== index)
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    if (!sessionId) { setError('请选择演唱会和场次'); return }
    if (!files.length) { setError('请至少选择一张图片'); return }
    setSubmitting(true)
    setError('')
    setMessage('图片正在处理并上传，请稍候…')
    const body = new FormData()
    body.set('category', category)
    body.set('concertId', sessionId)
    body.set('title', title)
    body.set('content', content)
    body.set('submissionKey', typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${files.length}`)
    files.forEach((item) => body.append('file', item.file, item.file.name))
    try {
      const response = await fetch('/api/salon/posts', { method: 'POST', body })
      const data = await response.json().catch(() => null) as { ok?: boolean; postId?: string; message?: string } | null
      if (response.status === 401) { window.location.href = `/login?redirect=${encodeURIComponent('/salon/upload')}`; return }
      if (!response.ok || !data?.ok) throw new Error(data?.message || '投稿失败，请稍后重试')
      setMessage(data.message || '投稿成功，作品将在审核通过后公开显示。')
      window.setTimeout(() => router.push('/salon/mine'), 650)
    } catch (caught) {
      setMessage('')
      setError(caught instanceof Error ? caught.message : '投稿失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return <form className="salon-upload-form" onSubmit={submit}>
    <section className="salon-form-section"><div className="salon-form-section-heading"><div><p className="salon-kicker">01 · CONTEXT</p><h2>作品信息</h2></div><span>分类、演唱会和场次为必填</span></div>
      <div className="salon-form-grid">
        <label><span>分类 <b>*</b></span><select value={category} onChange={(event) => setCategory(event.target.value as SalonCategoryValue)}>{SALON_CATEGORIES.map((value) => <option key={value} value={value}>{SALON_CATEGORY_LABELS[value]}</option>)}</select><small>{hint}</small></label>
        <label><span>演唱会 <b>*</b></span><select value={tourId} onChange={(event) => chooseTour(event.target.value)}><option value="">请选择演唱会</option>{options.tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
        <label><span>场次 <b>*</b></span><select value={sessionId} disabled={!tourId} onChange={(event) => setSessionId(event.target.value)}><option value="">{tourId ? '请选择场次' : '先选择演唱会'}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{formatSalonSession(session)}</option>)}</select></label>
        <label><span>标题</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="给这组照片起个名字（选填）" /></label>
        <label className="salon-form-wide"><span>描述</span><textarea value={content} maxLength={5000} onChange={(event) => setContent(event.target.value)} rows={5} placeholder="记录一些现场或图片背后的故事（选填）" /></label>
      </div>
    </section>
    <section className="salon-form-section"><div className="salon-form-section-heading"><div><p className="salon-kicker">02 · IMAGES</p><h2>选择图片</h2></div><span>最多 9 张 · 单张不超过 20MB</span></div>
      <div className="salon-upload-note">原图会保留，图库只使用优化后的缩略图；壁纸不会被强制裁成固定比例。</div>
      <div className="salon-upload-previews">{files.map((item, index) => <figure key={`${item.file.name}-${index}`}><img src={item.url} alt={`待上传图片 ${index + 1}`} /><button type="button" onClick={() => removeFile(index)} aria-label={`移除第 ${index + 1} 张图片`}>×</button><figcaption>{index + 1}</figcaption></figure>)}<button type="button" className="salon-add-image" onClick={() => inputRef.current?.click()} disabled={files.length >= MAX_FILES}><span>＋</span><small>{files.length >= MAX_FILES ? '已达上限' : '添加图片'}</small></button></div>
      <input ref={inputRef} className="salon-hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={addFiles} />
    </section>
    {error ? <p className="salon-form-error" role="alert">{error}</p> : null}
    {message ? <p className="salon-form-success" role="status">{message}</p> : null}
    <div className="salon-upload-submit"><button type="submit" className="salon-primary-button" disabled={submitting}>{submitting ? '提交中…' : '提交审核'}</button><span>投稿后默认进入审核中，审核通过后才会公开。</span></div>
  </form>
}
