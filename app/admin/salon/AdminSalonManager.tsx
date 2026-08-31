'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import {
  formatSalonSession,
  SALON_CATEGORIES,
  SALON_CATEGORY_LABELS,
  SALON_POST_STATUSES,
  SALON_STATUS_LABELS,
  supportsOriginal,
  type SalonCategoryValue,
  type SalonOptions,
  type SalonPostStatusValue,
  type SalonPostView,
} from '@/lib/salon'

type ReviewTarget = { post: SalonPostView; action: 'approve' | 'reject' }
type EditTarget = { post: SalonPostView; category: SalonCategoryValue; tourId: string; sessionId: string; title: string; content: string }
type TargetLookupStatus = SalonPostStatusValue | 'MISSING' | 'UNAVAILABLE'

export function AdminSalonManager({ initialPosts, initialHasMore, initialPostId, options }: Readonly<{ initialPosts: SalonPostView[]; initialHasMore: boolean; initialPostId?: string | null; options: SalonOptions }>) {
  const [posts, setPosts] = useState(initialPosts)
  const [status, setStatus] = useState<SalonPostStatusValue>('PENDING')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const [reviewing, setReviewing] = useState<ReviewTarget | null>(null)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [targetStatus, setTargetStatus] = useState<TargetLookupStatus | null>(null)
  const listRequestRef = useRef(0)

  const load = useCallback(async (nextStatus: SalonPostStatusValue, nextPage = 1) => {
    const requestId = listRequestRef.current + 1
    listRequestRef.current = requestId
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/admin/salon?status=${nextStatus}&page=${nextPage}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { posts?: SalonPostView[]; hasMore?: boolean; page?: number; message?: string } | null
      if (!response.ok) throw new Error(data?.message || '审核列表加载失败')
      if (requestId !== listRequestRef.current) return
      setStatus(nextStatus); setPage(data?.page || nextPage); setPosts(data?.posts || []); setHasMore(data?.hasMore === true)
    } catch (caught) {
      if (requestId === listRequestRef.current) setError(caught instanceof Error ? caught.message : '审核列表加载失败')
    } finally {
      if (requestId === listRequestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // The server sends the first PENDING page, but revalidate it on mount so
    // direct navigation and notification deep links share the same loader.
    void load('PENDING', 1)
  }, [initialPostId, load])

  useEffect(() => {
    setTargetStatus(null)
    if (!initialPostId) return
    let cancelled = false
    fetch(`/api/admin/salon?postId=${encodeURIComponent(initialPostId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { status?: string } | null
        if (cancelled) return
        if (response.status === 404) {
          setTargetStatus('MISSING')
          return
        }
        if (!response.ok) {
          setTargetStatus('UNAVAILABLE')
          return
        }
        setTargetStatus(SALON_POST_STATUSES.includes(data?.status as SalonPostStatusValue) ? data?.status as SalonPostStatusValue : 'PENDING')
      })
      .catch(() => {
        if (!cancelled) setTargetStatus('UNAVAILABLE')
      })
    return () => { cancelled = true }
  }, [initialPostId])

  useEffect(() => {
    if (!initialPostId || status !== 'PENDING' || (targetStatus && targetStatus !== 'PENDING')) return
    const timer = window.setTimeout(() => {
      document.getElementById(`salon-post-${initialPostId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialPostId, posts, status, targetStatus])

  async function review(target: ReviewTarget, reason: string | null) {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/admin/salon', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: target.post.id, action: target.action, rejectReason: reason }) })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '审核失败')
      setPosts((current) => current.filter((post) => post.id !== target.post.id)); setMessage(data?.message || '操作成功'); setReviewing(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '审核失败') } finally { setLoading(false) }
  }

  async function saveEdit() {
    if (!editing) return
    setLoading(true); setError('')
    try {
      const body = { category: editing.category, ...(editing.category === 'CONCERT' ? { concertId: editing.sessionId } : {}), title: editing.title, content: editing.content }
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(editing.post.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '保存失败')
      setMessage(data?.message || '作品已更新'); setEditing(null); await load(status, page)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败') } finally { setLoading(false) }
  }

  async function remove(post: SalonPostView) {
    if (!window.confirm('确定删除这篇沙龙作品吗？删除后无法恢复。')) return
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '删除失败')
      setPosts((current) => current.filter((item) => item.id !== post.id)); setMessage('作品已删除')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '删除失败') } finally { setLoading(false) }
  }

  function openEdit(post: SalonPostView) {
    setEditing({ post, category: post.category, tourId: post.concert?.tour.id || '', sessionId: post.concert?.id || '', title: post.title || '', content: post.content || '' })
  }

  const targetNotice = targetStatus === 'MISSING'
    ? '通知对应作品不存在或已删除，当前仍显示完整待审核列表。'
    : targetStatus === 'UNAVAILABLE'
      ? '通知对应作品暂时无法定位，当前仍显示完整待审核列表。'
      : targetStatus && targetStatus !== 'PENDING'
        ? `通知对应作品已${SALON_STATUS_LABELS[targetStatus]}，当前仍显示完整待审核列表。`
        : ''

  return <section className="admin-salon-manager" aria-busy={loading}><div className="admin-salon-tabs" role="tablist" aria-label="沙龙审核状态">{SALON_POST_STATUSES.map((item) => <button key={item} type="button" role="tab" aria-selected={status === item} onClick={() => void load(item, 1)} disabled={loading}>{SALON_STATUS_LABELS[item]}</button>)}</div>{message ? <p className="salon-form-success" role="status">{message}</p> : null}{error ? <p className="salon-form-error" role="alert">{error}</p> : null}{targetNotice ? <p className="salon-form-success" role="status">{targetNotice}</p> : null}<div className="admin-salon-list">{posts.map((post) => <AdminSalonRow key={post.id} post={post} focused={post.id === initialPostId} onApprove={() => { setRejectReason(''); setReviewing({ post, action: 'approve' }) }} onReject={() => { setRejectReason(post.rejectReason || ''); setReviewing({ post, action: 'reject' }) }} onEdit={() => openEdit(post)} onDelete={() => void remove(post)} />)}{!posts.length ? <div className="salon-empty"><strong>暂无{SALON_STATUS_LABELS[status]}作品</strong></div> : null}</div><div className="admin-salon-pagination"><button type="button" disabled={loading || page <= 1} onClick={() => void load(status, page - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={loading || !hasMore} onClick={() => void load(status, page + 1)}>下一页</button></div>
    {reviewing ? <div className="salon-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewing(null) }}><section className="salon-modal" role="dialog" aria-modal="true" aria-labelledby="salon-review-title"><h2 id="salon-review-title">{reviewing.action === 'approve' ? '通过这篇作品？' : '拒绝这篇作品？'}</h2><p>{reviewing.post.title || '无标题作品'}</p>{reviewing.action === 'reject' ? <label>拒绝原因 <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={5} maxLength={2000} placeholder="用户会在我的投稿和审核通知中看到。" /></label> : null}<div><button type="button" onClick={() => setReviewing(null)}>取消</button><button type="button" className={reviewing.action === 'approve' ? 'is-approve' : 'is-danger'} onClick={() => { if (reviewing.action === 'reject' && !rejectReason.trim()) { setError('拒绝时必须填写原因'); return } void review(reviewing, reviewing.action === 'reject' ? rejectReason.trim() : null) }}>{reviewing.action === 'approve' ? '确认通过' : '确认拒绝'}</button></div></section></div> : null}
    {editing ? <EditSalonModal editing={editing} options={options} onChange={setEditing} onCancel={() => setEditing(null)} onSave={() => void saveEdit()} /> : null}
  </section>
}

function AdminSalonRow({ post, focused, onApprove, onReject, onEdit, onDelete }: Readonly<{ post: SalonPostView; focused?: boolean; onApprove: () => void; onReject: () => void; onEdit: () => void; onDelete: () => void }>) {
  const gallery = post.media.map((media, index) => ({ id: media.id, src: media.previewUrl, previewSrc: media.previewUrl, originalUrl: supportsOriginal(post.category) && media.originalAvailable ? `/api/salon/media/${encodeURIComponent(media.id)}/original?mode=view` : null, downloadUrl: supportsOriginal(post.category) && media.originalAvailable ? `/api/salon/media/${encodeURIComponent(media.id)}/original?mode=download` : undefined, alt: `${post.title || '作品'} · ${index + 1}` }))
  const first = post.media[0]
  const context = post.concert
    ? `${post.concert.tour.name} · ${formatSalonSession({ city: post.concert.city, concertDate: post.concert.date, venue: post.concert.venue, title: post.concert.title, sessionNumber: null })}`
    : '独立作品，无需关联演唱会'
  return <article id={`salon-post-${post.id}`} data-focused={focused ? 'true' : undefined} className={`admin-salon-row${focused ? ' admin-salon-row-focused' : ''}`}><div className="admin-salon-row-images">{first ? <ImageViewer src={first.previewUrl} previewSrc={first.previewUrl} originalUrl={gallery[0]?.originalUrl} downloadUrl={gallery[0]?.downloadUrl} alt={post.title || '沙龙作品'} gallery={gallery} imageClassName="admin-salon-image" buttonClassName="admin-salon-image-button" /> : null}<span>{post.media.length} 张 · {first?.width || 0} × {first?.height || 0}</span></div><div className="admin-salon-row-copy"><div className="admin-salon-row-meta"><b>{post.author.nickname}</b><span>UID {post.author.uid}</span><time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt))}</time></div><div className="flex flex-wrap items-center gap-2"><span className={`salon-status-badge salon-status-${post.status.toLowerCase()}`}>{SALON_STATUS_LABELS[post.status]}</span><h2>{post.title || '无标题作品'}</h2></div><p>{SALON_CATEGORY_LABELS[post.category]} · {context}</p>{post.content ? <div className="admin-salon-description">{post.content}</div> : null}{post.rejectReason ? <div className="salon-reject-reason">拒绝原因：{post.rejectReason}</div> : null}<div className="admin-salon-actions">{post.status === 'PENDING' ? <><button type="button" className="is-approve" onClick={onApprove}>通过</button><button type="button" className="is-danger" onClick={onReject}>拒绝</button></> : null}<button type="button" onClick={onEdit}>修改资料</button><button type="button" className="is-danger" onClick={onDelete}>删除</button></div></div></article>
}

function EditSalonModal({ editing, options, onChange, onCancel, onSave }: Readonly<{ editing: EditTarget; options: SalonOptions; onChange: (value: EditTarget) => void; onCancel: () => void; onSave: () => void }>) {
  const sessions = options.tours.find((tour) => tour.id === editing.tourId)?.sessions || []
  const requiresConcert = editing.category === 'CONCERT'
  return <div className="salon-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}><section className="salon-modal" role="dialog" aria-modal="true" aria-labelledby="salon-edit-title"><h2 id="salon-edit-title">修改作品资料</h2><label>分类<select value={editing.category} onChange={(event) => { const category = event.target.value as SalonCategoryValue; onChange({ ...editing, category, ...(category === 'CONCERT' ? {} : { tourId: '', sessionId: '' }) }) }}>{SALON_CATEGORIES.map((value) => <option key={value} value={value}>{SALON_CATEGORY_LABELS[value]}</option>)}</select></label>{requiresConcert ? <><label>演唱会<select value={editing.tourId} onChange={(event) => { const tourId = event.target.value; const tour = options.tours.find((item) => item.id === tourId); onChange({ ...editing, tourId, sessionId: tour?.sessions[0]?.id || '' }) }}><option value="">不关联演唱会</option>{options.tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select></label><label>场次<select value={editing.sessionId} onChange={(event) => onChange({ ...editing, sessionId: event.target.value })}><option value="">不关联场次</option>{sessions.map((session) => <option key={session.id} value={session.id}>{formatSalonSession(session)}</option>)}</select></label></> : null}<label>标题<input value={editing.title} onChange={(event) => onChange({ ...editing, title: event.target.value })} /></label><label>描述<textarea value={editing.content} rows={4} onChange={(event) => onChange({ ...editing, content: event.target.value })} /></label><div><button type="button" onClick={onCancel}>取消</button><button type="button" className="is-approve" onClick={onSave}>保存修改</button></div></section></div>
}
