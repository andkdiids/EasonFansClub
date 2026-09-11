'use client'

/* Admin badge thumbnails come from the same controlled public image URLs as SalonDetail. */
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from 'react'
import type { SalonBadgeCatalogItem } from '@/lib/salon-badges'
import type { SalonPostView } from '@/lib/salon-shared'

type SalonBadgeGrantProps = {
  postId: string
  postTitle: string
  postSummary: string
  author: SalonPostView['author']
}

type CatalogResponse = {
  ok?: boolean
  classificationAvailable?: boolean
  message?: string
  user?: { id: string; uid: number; nickname: string; avatarUrl: string | null }
  salon?: { id: string; title: string; summary: string }
  badges?: SalonBadgeCatalogItem[]
}

export function SalonBadgeGrant({ postId, postTitle, postSummary, author }: Readonly<SalonBadgeGrantProps>) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [classificationAvailable, setClassificationAvailable] = useState(false)
  const [classificationMessage, setClassificationMessage] = useState('')
  const [badges, setBadges] = useState<SalonBadgeCatalogItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<SalonBadgeCatalogItem | null>(null)

  const visibleBadges = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase()
    return normalized ? badges.filter((badge) => badge.name.toLocaleLowerCase().includes(normalized)) : badges
  }, [badges, keyword])

  async function openDialog() {
    setOpen(true)
    setLoading(true)
    setError('')
    setSuccess('')
    setSelected(null)
    try {
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(postId)}/badges`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as CatalogResponse | null
      if (!response.ok || !data?.ok) throw new Error(data?.message || '勋章列表加载失败')
      setClassificationAvailable(data.classificationAvailable === true)
      setClassificationMessage(data.message || '')
      setBadges(data.badges || [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '勋章列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function grant() {
    if (!selected || selected.owned || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const operationId = typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${selected.id}`
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(postId)}/badges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeId: selected.id, operationId }),
      })
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null
      if (!response.ok || !data?.ok) throw new Error(data?.message || '勋章派发失败')
      setBadges((current) => current.map((badge) => badge.id === selected.id ? { ...badge, owned: true } : badge))
      setSelected(null)
      setSuccess(`勋章已派发给「${author.nickname}」`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '勋章派发失败')
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <button type="button" className="salon-secondary-button" onClick={() => void openDialog()}>派发沙龙勋章</button>
    {open ? <div className="salon-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><section className="salon-modal salon-badge-modal" role="dialog" aria-modal="true" aria-labelledby="salon-badge-title">
      <div className="salon-badge-modal-heading"><div><p className="salon-kicker">SALON ADMIN ACTION</p><h2 id="salon-badge-title">派发沙龙勋章</h2></div><button type="button" aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>
      <div className="salon-badge-target"><div className="salon-badge-target-avatar">{author.avatarUrl ? <img src={author.avatarUrl} alt="" /> : author.nickname.slice(0, 1)}</div><div><strong>派发对象：{author.nickname}</strong><p>当前沙龙：{postTitle}</p>{postSummary ? <p>{postSummary.slice(0, 180)}</p> : null}</div></div>
      {loading ? <p role="status">正在读取可派发勋章…</p> : null}
      {error ? <p className="salon-form-error" role="alert">{error}</p> : null}
      {!loading && classificationMessage && !classificationAvailable ? <p className="salon-badge-empty" role="status">{classificationMessage}</p> : null}
      {!loading && classificationAvailable ? <><label><span>搜索勋章</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索勋章名称" /></label><div className="salon-badge-list">{visibleBadges.map((badge) => <button type="button" key={badge.id} className={`salon-badge-option${selected?.id === badge.id ? ' is-selected' : ''}`} disabled={badge.owned} onClick={() => setSelected(badge)}><span className="salon-badge-icon">{badge.iconUrl ? <img src={badge.iconUrl} alt="" /> : '徽'}</span><span><strong>{badge.name}</strong><small>{badge.rarity || '普通'} · {badge.owned ? '已获得' : '可派发'}</small></span></button>)}{!visibleBadges.length ? <p className="salon-badge-empty">没有符合条件的沙龙勋章。</p> : null}</div></> : null}
      <div><button type="button" onClick={() => setOpen(false)}>关闭</button>{selected ? <button type="button" className="is-approve" disabled={submitting} onClick={() => void grant()}>{submitting ? '派发中…' : `确认派发给「${author.nickname}」`}</button> : null}</div>
      {selected ? <p className="salon-badge-confirm">确认向「{author.nickname}」派发：{selected.name}<br />当前内容：《{postTitle}》</p> : null}
    </section></div> : null}
    {success ? <div className="salon-action-toast" role="status">{success}</div> : null}
  </>
}
