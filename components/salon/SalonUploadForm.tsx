'use client'

/* 预览只读取用户刚选取的本地 File 对象，避免引入与 COS 域名绑定的图片配置。 */
/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  formatSalonSession,
  SALON_CATEGORIES,
  SALON_CATEGORY_CONFIG,
  SALON_CATEGORY_LABELS,
  supportsOriginal,
  type SalonCategoryValue,
  type SalonOptions,
} from '@/lib/salon-shared'
import { validateSalonFiles, SALON_MAX_FILES } from '@/lib/salon-upload'
import { SALON_DEFAULT_WATERMARK_OPACITY, SALON_WATERMARK_POSITIONS, type SalonWatermarkPosition } from '@/lib/salon-watermark'

const MAX_FILES = SALON_MAX_FILES

const WATERMARK_POSITION_LABELS: Record<SalonWatermarkPosition, string> = {
  TOP: '上',
  BOTTOM: '下',
  LEFT: '左',
  RIGHT: '右',
  TOP_LEFT: '左上',
  TOP_RIGHT: '右上',
  BOTTOM_LEFT: '左下',
  BOTTOM_RIGHT: '右下',
}

type PreviewFile = { file: File; url: string }

export function SalonUploadForm({ options, watermarkText }: Readonly<{ options: SalonOptions; watermarkText: string }>) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [category, setCategory] = useState<SalonCategoryValue>('CONCERT')
  const [tourId, setTourId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<PreviewFile[]>([])
  const [watermarkEnabled, setWatermarkEnabled] = useState(false)
  const [watermarkOpacity, setWatermarkOpacity] = useState(SALON_DEFAULT_WATERMARK_OPACITY)
  const [watermarkPosition, setWatermarkPosition] = useState<SalonWatermarkPosition>('BOTTOM_RIGHT')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const selectedTour = options.tours.find((tour) => tour.id === tourId)
  const sessions = selectedTour?.sessions || []
  const categoryConfig = SALON_CATEGORY_CONFIG[category]
  const allowsConcert = categoryConfig.allowsConcert
  const requiresConcert = categoryConfig.requiresConcert
  const preservesOriginal = supportsOriginal(category)
  const hint = useMemo(() => categoryConfig.hint, [categoryConfig])
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => () => filesRef.current.forEach((item) => URL.revokeObjectURL(item.url)), [])

  function chooseTour(value: string) {
    setTourId(value)
    const tour = options.tours.find((item) => item.id === value)
    setSessionId(tour?.sessions[0]?.id || '')
  }

  function chooseCategory(value: SalonCategoryValue) {
    setCategory(value)
    if (!SALON_CATEGORY_CONFIG[value].allowsConcert) {
      setTourId('')
      setSessionId('')
    }
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    setError('')
    if (!selected.length) return
    const validation = validateSalonFiles(selected, files.length)
    if (!validation.ok) { setError(validation.error || '图片校验失败'); return }
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
    if (requiresConcert && !sessionId) { setError('请选择演唱会和场次'); return }
    if (!files.length) { setError('请至少选择一张图片'); return }
    setSubmitting(true)
    setError('')
    setMessage('图片正在处理并上传，请稍候…')
    const body = new FormData()
    body.set('category', category)
    if (tourId) body.set('tourId', tourId)
    if (sessionId) {
      body.set('sessionId', sessionId)
      body.set('concertId', sessionId)
    }
    body.set('title', title)
    body.set('content', content)
    body.set('watermarkEnabled', String(watermarkEnabled))
    body.set('watermarkOpacity', String(watermarkOpacity))
    body.set('watermarkPosition', watermarkPosition)
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
    <section className="salon-form-section"><div className="salon-form-section-heading"><div><p className="salon-kicker">01 · CONTEXT</p><h2>作品信息</h2></div><span>{requiresConcert ? '分类、演唱会和场次为必填' : '分类为必填，演唱会关联可留空'}</span></div>
      <div className="salon-form-grid">
        <label><span>分类 <b>*</b></span><select value={category} onChange={(event) => chooseCategory(event.target.value as SalonCategoryValue)}>{SALON_CATEGORIES.map((value) => <option key={value} value={value}>{SALON_CATEGORY_LABELS[value]}</option>)}</select><small>{hint}</small></label>
        {allowsConcert ? <>
          <label><span>演唱会 {requiresConcert ? <b>*</b> : null}</span><select value={tourId} onChange={(event) => chooseTour(event.target.value)}><option value="">{requiresConcert ? '请选择演唱会' : '不关联演唱会'}</option>{options.tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
          <label><span>场次 {requiresConcert ? <b>*</b> : null}</span><select value={sessionId} disabled={!tourId} onChange={(event) => { const value = event.target.value; setSessionId(value); if (!value) setTourId('') }}><option value="">{tourId ? (requiresConcert ? '请选择场次' : '不关联场次') : (requiresConcert ? '先选择演唱会' : '可选场次')}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{formatSalonSession(session)}</option>)}</select></label>
        </> : null}
        <label><span>标题</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="给这组照片起个名字（选填）" /></label>
        <label className="salon-form-wide"><span>描述</span><textarea value={content} maxLength={5000} onChange={(event) => setContent(event.target.value)} rows={5} placeholder="记录一些现场或图片背后的故事（选填）" /></label>
      </div>
    </section>
    <section className="salon-form-section"><div className="salon-form-section-heading"><div><p className="salon-kicker">02 · IMAGES</p><h2>选择图片</h2></div><span>最多 9 张 · 单张不超过 20MB</span></div>
      <div className="salon-upload-note">{preservesOriginal ? '会保留无水印原图，图库只使用优化后的缩略图；壁纸不会被强制裁成固定比例。' : '此分类只保存优化后的 WebP 展示图，不长期保留原始上传文件。'}</div>
      <div className="salon-upload-previews">{files.map((item, index) => <figure key={`${item.file.name}-${index}`}><img src={item.url} alt={`待上传图片 ${index + 1}`} />{watermarkEnabled ? <span className={`salon-preview-watermark salon-preview-watermark-${watermarkPosition}`} style={{ opacity: watermarkOpacity / 100 }}>{watermarkText}</span> : null}<button type="button" onClick={() => removeFile(index)} aria-label={`移除第 ${index + 1} 张图片`}>×</button><figcaption>{index + 1}</figcaption></figure>)}<button type="button" className="salon-add-image" onClick={() => inputRef.current?.click()} disabled={files.length >= MAX_FILES}><span>＋</span><small>{files.length >= MAX_FILES ? '已达上限' : '添加图片'}</small></button></div>
      <input ref={inputRef} className="salon-hidden-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={addFiles} />
    </section>
    <section className="salon-form-section"><div className="salon-form-section-heading"><div><p className="salon-kicker">03 · WATERMARK</p><h2>展示设置</h2></div><span>默认关闭，原图永远不加水印</span></div>
      <label className="salon-watermark-toggle"><input type="checkbox" checked={watermarkEnabled} onChange={(event) => setWatermarkEnabled(event.target.checked)} /><span>增加水印</span></label>
      {watermarkEnabled ? <div className="salon-watermark-settings"><p>水印内容：<strong>{watermarkText}</strong></p><label><span>透明度 <b>{watermarkOpacity}%</b></span><input type="range" min="10" max="100" step="1" value={watermarkOpacity} onChange={(event) => setWatermarkOpacity(Number(event.target.value))} /></label><fieldset><legend>水印位置</legend><div className="salon-watermark-position-grid">{SALON_WATERMARK_POSITIONS.map((position) => <button key={position} type="button" className={watermarkPosition === position ? 'is-active' : ''} onClick={() => setWatermarkPosition(position)} aria-pressed={watermarkPosition === position}>{WATERMARK_POSITION_LABELS[position]}</button>)}</div></fieldset></div> : null}
    </section>
    {error ? <p className="salon-form-error" role="alert">{error}</p> : null}
    {message ? <p className="salon-form-success" role="status">{message}</p> : null}
    <div className="salon-upload-submit"><button type="submit" className="salon-primary-button" disabled={submitting}>{submitting ? '提交中…' : '提交审核'}</button><span>投稿后默认进入审核中，审核通过后才会公开。</span></div>
  </form>
}
