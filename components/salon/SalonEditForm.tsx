'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import {
  formatSalonSession,
  SALON_CATEGORIES,
  SALON_CATEGORY_CONFIG,
  SALON_CATEGORY_LABELS,
  type SalonCategoryValue,
  type SalonOptions,
  type SalonPostView,
} from '@/lib/salon-shared'

type EditResponse = { ok?: boolean; message?: string; code?: string }

export function SalonEditForm({ post, options, detailHref }: Readonly<{ post: SalonPostView; options: SalonOptions; detailHref: string }>) {
  const router = useRouter()
  const [category, setCategory] = useState<SalonCategoryValue>(post.category)
  const [tourId, setTourId] = useState(post.concert?.tour.id || '')
  const [sessionId, setSessionId] = useState(post.concert?.id || '')
  const [title, setTitle] = useState(post.title || '')
  const [content, setContent] = useState(post.content || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const selectedTour = options.tours.find((tour) => tour.id === tourId)
  const sessions = selectedTour?.sessions || []
  const categoryConfig = SALON_CATEGORY_CONFIG[category]

  function chooseCategory(value: SalonCategoryValue) {
    setCategory(value)
    if (!SALON_CATEGORY_CONFIG[value].allowsConcert) {
      setTourId('')
      setSessionId('')
    }
  }

  function chooseTour(value: string) {
    setTourId(value)
    const tour = options.tours.find((item) => item.id === value)
    setSessionId(tour?.sessions[0]?.id || '')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    if (categoryConfig.requiresConcert && !sessionId) {
      setError('请选择演唱会和场次')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(post.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          tourId: categoryConfig.allowsConcert ? tourId : '',
          sessionId: categoryConfig.allowsConcert ? sessionId : '',
          concertId: categoryConfig.allowsConcert && sessionId ? sessionId : null,
          title,
          content,
          baseUpdatedAt: post.updatedAt,
        }),
      })
      const data = await response.json().catch(() => null) as EditResponse | null
      if (response.status === 401) {
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
        return
      }
      if (!response.ok || !data?.ok) throw new Error(data?.message || '保存失败，请稍后重试')
      router.replace(detailHref)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return <form className="salon-upload-form salon-edit-form" onSubmit={submit}>
    <section className="salon-form-section">
      <div className="salon-form-section-heading"><div><p className="salon-kicker">01 · CONTENT</p><h2>作品信息</h2></div><span>修改后将按现有审核规则处理</span></div>
      <div className="salon-form-grid">
        <label><span>沙龙分区 <b>*</b></span><select value={category} onChange={(event) => chooseCategory(event.target.value as SalonCategoryValue)}>{SALON_CATEGORIES.map((value) => <option key={value} value={value}>{SALON_CATEGORY_LABELS[value]}</option>)}</select><small>{categoryConfig.hint}</small></label>
        {categoryConfig.allowsConcert ? <>
          <label><span>演唱会 {categoryConfig.requiresConcert ? <b>*</b> : null}</span><select value={tourId} onChange={(event) => chooseTour(event.target.value)}><option value="">{categoryConfig.requiresConcert ? '请选择演唱会' : '不关联演唱会'}</option>{options.tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label>
          <label><span>场次 {categoryConfig.requiresConcert ? <b>*</b> : null}</span><select value={sessionId} disabled={!tourId} onChange={(event) => { const value = event.target.value; setSessionId(value); if (!value) setTourId('') }}><option value="">{tourId ? (categoryConfig.requiresConcert ? '请选择场次' : '不关联场次') : (categoryConfig.requiresConcert ? '先选择演唱会' : '可选场次')}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{formatSalonSession(session)}</option>)}</select></label>
        </> : null}
        <label><span>标题</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="给这组照片起个名字（选填）" /></label>
        <label className="salon-form-wide"><span>内容 / 描述</span><textarea value={content} maxLength={5000} onChange={(event) => setContent(event.target.value)} rows={8} placeholder="记录一些现场或图片背后的故事（选填）" /></label>
      </div>
    </section>
    <section className="salon-form-section">
      <div className="salon-form-section-heading"><div><p className="salon-kicker">02 · MEDIA</p><h2>图片保留</h2></div><span>{post.media.length} 张图片</span></div>
      <p className="salon-upload-note">本次编辑沿用现有沙龙数据结构，图片与原图能力保持不变；如需替换图片，请继续使用现有上传流程。</p>
    </section>
    {error ? <p className="salon-form-error" role="alert">{error}</p> : null}
    <div className="salon-upload-submit"><Link href={detailHref} className="salon-secondary-button">取消</Link><button type="submit" className="salon-primary-button" disabled={submitting}>{submitting ? '保存中…' : '保存修改'}</button><span>{submitting ? '正在保存，请稍候…' : '保存后返回当前沙龙详情'}</span></div>
  </form>
}
