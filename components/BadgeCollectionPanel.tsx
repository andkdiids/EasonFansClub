'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeImage } from '@/components/UserDisplayName'
import { BADGE_RARITY_LABELS, canTrackBadgeView, type BadgeCollectionView, type BadgeShowcaseItemView, type BadgeView } from '@/lib/badge-types'

type Props = { uid: string; isSelf: boolean; previewOnly?: boolean }

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(new Date(value)) : ''
}

function formatDateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''
}

function remainingLabel(value: string | null) {
  if (!value) return null
  const remainingMs = new Date(value).getTime() - Date.now()
  if (remainingMs <= 0) return null
  if (remainingMs < 86400000) return '今天截止'
  return `剩余 ${Math.ceil(remainingMs / 86400000)} 天`
}

export type BadgeDetailDialogProps = { badge: BadgeView; tierItems: BadgeView[]; onClose: () => void; canEquip: boolean; canTrack?: boolean; onEquip: () => void; onUnequip: () => void; onShare?: () => void; busy: boolean }

export function BadgeDetailDialog({ badge, tierItems, onClose, canEquip, canTrack = false, onEquip, onUnequip, onShare, busy }: BadgeDetailDialogProps) {
  const [tracked, setTracked] = useState(false)
  const [trackingCount, setTrackingCount] = useState(0)
  const [trackingLimit, setTrackingLimit] = useState(10)
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [trackingMessage, setTrackingMessage] = useState('')

  useEffect(() => {
    setTracked(false)
    setTrackingCount(0)
    setTrackingMessage('')
    if (!canTrack) return
    let active = true
    void fetch('/api/users/me/badge-tasks', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((data) => {
      if (!active) return
      const items = Array.isArray(data?.tracking) ? data.tracking as Array<{ id: string }> : []
      setTracked(items.some((item) => item.id === badge.id))
      setTrackingCount(items.length)
      if (Number.isInteger(data?.maxTracking)) setTrackingLimit(data.maxTracking)
    }).catch(() => undefined)
    return () => { active = false }
  }, [badge.id, canTrack])

  const toggleTracking = async () => {
    setTrackingBusy(true); setTrackingMessage('')
    try {
      const response = await fetch(`/api/users/me/badge-tasks/${encodeURIComponent(badge.id)}`, { method: tracked ? 'DELETE' : 'POST' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '操作失败')
      const nextTracked = !tracked
      setTracked(nextTracked)
      setTrackingCount((value) => Math.max(0, value + (nextTracked ? 1 : -1)))
      window.dispatchEvent(new CustomEvent('eason-badge-task-updated', { detail: { badgeId: badge.id, tracked: nextTracked } }))
    } catch (error) { setTrackingMessage(error instanceof Error ? error.message : '操作失败') } finally { setTrackingBusy(false) }
  }
  return (
    <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="badge-detail-dialog max-w-md" role="dialog" aria-modal="true" aria-label={`${badge.name}勋章详情`} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭勋章详情">×</button>
        <BadgeImage badge={badge} size="detail" />
        <h3>{badge.name}</h3>
        <p className="badge-detail-rarity">{BADGE_RARITY_LABELS[badge.rarity]} · {badge.series?.name || '未分类'} · {badge.status === 'OBTAINED' ? '已获得' : badge.status === 'HIDDEN' ? '隐藏勋章' : '尚未获得'}</p>
        {badge.tierGroupCode && badge.tierLevel ? <p className="badge-detail-rarity">{badge.tierGroupCode} · 第 {badge.tierLevel} 级{badge.isHighestTier ? ' · 当前最高等级' : ''}</p> : null}
        {badge.description ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{badge.description}</p> : null}
        {badge.acquisitionDescription ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">获取方式：{badge.acquisitionDescription}</p> : null}
        {badge.status !== 'HIDDEN' && badge.availabilityStatus ? <p className="mt-1 text-xs font-black text-brand-700">状态：{badge.availabilityStatus === 'PERMANENT' ? '永久可获得' : badge.availabilityStatus === 'UPCOMING' ? '即将开放' : badge.availabilityStatus === 'ENDED' ? '限定 · 已绝版' : '限定开放中'}</p> : null}
        {badge.status !== 'HIDDEN' && badge.availabilityStatus && badge.availabilityStatus !== 'PERMANENT' ? <p className="mt-1 text-xs font-bold text-slate-500">限定时间：{formatDateTime(badge.availableFrom || null) || '不限开始'} – {formatDateTime(badge.availableUntil || null) || '不限结束'}{badge.availabilityStatus === 'AVAILABLE' && remainingLabel(badge.availableUntil || null) ? ` · ${remainingLabel(badge.availableUntil || null)}` : ''}</p> : null}
        {badge.progress && !badge.progress.progressUnsupported ? <div className="mt-3 w-full text-left"><div className="flex justify-between text-xs font-black text-slate-600"><span>当前进度</span><span>{badge.progress.current} / {badge.progress.target} · {badge.progress.percentage}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-sky-100"><span className="block h-full rounded-full bg-brand-700" style={{ width: `${badge.progress.percentage}%` }} /></div></div> : null}
        {tierItems.length > 1 ? <div className="mt-3 text-left"><p className="text-xs font-black text-slate-600">成长等级</p><div className="mt-1 flex flex-wrap gap-2">{tierItems.map((tier) => <span key={tier.id} className={`rounded-full px-2 py-1 text-[11px] font-black ${tier.id === badge.id ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>第 {tier.tierLevel} 级 {tier.status === 'OBTAINED' ? '✓' : tier.progress && !tier.progress.progressUnsupported ? `${tier.progress.current}/${tier.progress.target}` : '未获得'}</span>)}</div></div> : null}
        {badge.ownershipStats && badge.visibility === 'PUBLIC' ? <p className="mt-2 text-xs font-bold text-slate-500">全站获得率：{badge.ownershipStats.display}（{badge.ownershipStats.ownerCount} 人）</p> : null}
        {badge.obtainedAt ? <p className="badge-detail-obtained">获得于 {formatDate(badge.obtainedAt)}</p> : null}
        {canEquip ? (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {badge.isEquipped ? <button type="button" onClick={onUnequip} disabled={busy} className="min-h-10 rounded-full border border-sky-200 bg-sky-50 px-4 text-sm font-black text-brand-700">{busy ? '处理中…' : '取消佩戴'}</button> : (
              <button type="button" onClick={onEquip} disabled={busy} className="min-h-10 rounded-full bg-brand-950 px-4 text-sm font-black text-white">{busy ? '处理中…' : '佩戴'}</button>
            )}
          </div>
        ) : null}
        {onShare ? <button type="button" onClick={onShare} disabled={busy} className="mt-3 min-h-10 rounded-full border border-amber-200 bg-amber-50 px-4 text-sm font-black text-amber-800">分享勋章</button> : null}
        {canTrack ? <>
          <button type="button" onClick={() => void toggleTracking()} disabled={trackingBusy} aria-pressed={tracked} className={`mt-3 min-h-10 rounded-full border px-4 text-sm font-black ${tracked ? 'border-brand-700 bg-brand-950 text-white' : 'border-sky-200 bg-sky-50 text-brand-700'}`}>{trackingBusy ? '处理中…' : tracked ? '✓ 正在追踪（取消）' : '＋ 追踪此勋章'}</button>
          <p className="mt-1 text-[11px] font-bold text-slate-500">正在追踪 {trackingCount} / {trackingLimit} 枚</p>
        </> : null}
        {trackingMessage ? <p className="mt-2 text-xs font-bold text-rose-600">{trackingMessage}</p> : null}
      </section>
    </div>
  )
}

function ShowcaseEditor({ badges, selectedIds, onToggle, onMove, onClose, onSave, saving }: { badges: BadgeView[]; selectedIds: string[]; onToggle: (badgeId: string) => void; onMove: (badgeId: string, delta: -1 | 1) => void; onClose: () => void; onSave: () => void; saving: boolean }) {
  return <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}><section className="badge-detail-dialog max-w-lg" role="dialog" aria-modal="true" aria-label="编辑荣誉橱窗" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭荣誉橱窗编辑">×</button><h3>编辑荣誉橱窗</h3><p className="mt-2 text-xs font-bold text-slate-500">最多选择 6 枚已获得勋章；选中后可用上移、下移调整主页展示顺序。</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{badges.map((badge) => { const selectedIndex = selectedIds.indexOf(badge.id); return <div key={badge.id} className={`min-w-0 rounded-xl border p-2 ${selectedIndex >= 0 ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}><button type="button" onClick={() => onToggle(badge.id)} className="flex w-full min-w-0 items-center gap-2 text-left"><BadgeImage badge={badge} size="wall" /><span className="min-w-0"><strong className="block truncate text-xs font-black text-brand-950">{badge.name}</strong><span className="text-[10px] font-bold text-slate-500">{selectedIndex >= 0 ? `橱窗第 ${selectedIndex + 1} 位` : '加入橱窗'}</span></span></button>{selectedIndex >= 0 ? <div className="mt-2 flex justify-end gap-1"><button type="button" onClick={() => onMove(badge.id, -1)} disabled={selectedIndex === 0} aria-label={`将${badge.name}上移`} className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-brand-700 disabled:opacity-40">↑</button><button type="button" onClick={() => onMove(badge.id, 1)} disabled={selectedIndex === selectedIds.length - 1} aria-label={`将${badge.name}下移`} className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-brand-700 disabled:opacity-40">↓</button></div> : null}</div> })}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-slate-600">取消</button><button type="button" onClick={onSave} disabled={saving} className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">{saving ? '保存中…' : '保存橱窗'}</button></div></section></div>
}

function ShareCardDialog({src, onClose}: {src: string; onClose: () => void}) {
  return <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}><section className="badge-detail-dialog max-w-md" role="dialog" aria-modal="true" aria-label="分享勋章卡片" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭分享卡片">×</button><h3>分享勋章</h3><img src={src} alt="勋章分享卡片" className="mt-3 max-h-[70vh] w-full rounded-2xl object-contain" /><a href={src} download="e院勋章.png" className="mt-3 inline-flex min-h-10 items-center justify-center rounded-full bg-brand-950 px-4 text-sm font-black text-white">保存图片</a></section></div>
}

function BadgeCard({ badge, isSelf, onOpen, onEquip, onUnequip, busy }: { badge: BadgeView; isSelf: boolean; onOpen: () => void; onEquip: () => void; onUnequip: () => void; busy: boolean }) {
  const obtained = badge.status === 'OBTAINED'
  const limited = badge.availabilityStatus && badge.availabilityStatus !== 'PERMANENT'
  return (
    <article className={`badge-collection-card ${badge.status === 'HIDDEN' ? 'badge-collection-card-hidden' : ''}`}>
      <button type="button" className="badge-collection-card-main" onClick={onOpen} aria-label={`${badge.name}详情`}>
        <BadgeImage badge={badge} size="wall" />
        <span className="min-w-0 text-left">
          <strong className="block truncate text-sm font-black text-brand-950">{badge.name}</strong>
          <span className="mt-1 block text-[11px] font-bold text-slate-500">{badge.status === 'HIDDEN' ? '达成特殊条件后解锁' : obtained ? (badge.isEquipped ? '正在佩戴' : `获得于 ${formatDate(badge.obtainedAt)}`) : badge.progress && !badge.progress.progressUnsupported ? `${badge.progress.current} / ${badge.progress.target} · ${badge.progress.percentage}%` : limited ? (badge.availabilityStatus === 'UPCOMING' ? '即将开放' : badge.availabilityStatus === 'ENDED' ? '已绝版' : '限定开放中') : '尚未获得'}</span>
          {badge.progress && !badge.progress.progressUnsupported ? <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-sky-100"><span className="block h-full rounded-full bg-brand-700" style={{ width: `${badge.progress.percentage}%` }} /></span> : null}
        </span>
      </button>
      {isSelf && obtained && badge.isWearable && badge.isEnabled ? (
        <button type="button" onClick={badge.isEquipped ? onUnequip : onEquip} disabled={busy} className={`badge-collection-action ${badge.isEquipped ? 'is-equipped' : ''}`}>
          {busy ? '处理中…' : badge.isEquipped ? '取消佩戴' : '佩戴'}
        </button>
      ) : null}
    </article>
  )
}

export function BadgeCollectionPanel({ uid, isSelf, previewOnly = true }: Props) {
  const [collection, setCollection] = useState<BadgeCollectionView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<BadgeView | null>(null)
  const [filter, setFilter] = useState<'all' | 'obtained' | 'progress' | 'limited' | 'hidden'>('all')
  const [showcaseEditor, setShowcaseEditor] = useState(false)
  const [showcaseCandidates, setShowcaseCandidates] = useState<BadgeView[]>([])
  const [showcaseIds, setShowcaseIds] = useState<string[]>([])
  const [savingShowcase, setSavingShowcase] = useState(false)
  const [shareSrc, setShareSrc] = useState<string | null>(null)

  const openBadge = useCallback((badge: BadgeView) => {
    setSelected(badge)
    const params = new URLSearchParams(window.location.search)
    params.set('badge', badge.id)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  }, [])

  const closeBadge = useCallback(() => {
    setSelected(null)
    const params = new URLSearchParams(window.location.search)
    params.delete('badge')
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(uid)}/badges${previewOnly ? '?preview=1' : ''}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as BadgeCollectionView | { message?: string } | null
      const message = data && 'message' in data ? data.message : undefined
      if (!response.ok || !data || !('items' in data)) throw new Error(message || '勋章暂时无法加载')
      setCollection(data)
      setShowcaseIds((data.showcase || []).sort((left, right) => left.slot - right.slot).map((item) => item.badge.id))
      setSelected((current) => current ? data.items.find((item) => item.id === current.id) || null : null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '勋章暂时无法加载')
    } finally {
      setLoading(false)
    }
  }, [previewOnly, uid])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!collection) return
    const badgeId = new URLSearchParams(window.location.search).get('badge')
    if (!badgeId) return
    const badge = collection.items.find((item) => item.id === badgeId)
    if (badge) setSelected(badge)
  }, [collection])

  const changeEquipment = useCallback(async (badge: BadgeView, equip: boolean) => {
    setBusyId(badge.id)
    setError('')
    try {
      const response = await fetch('/api/users/me/badge/equip', {
        method: equip ? 'POST' : 'DELETE',
        headers: equip ? { 'Content-Type': 'application/json' } : undefined,
        body: equip ? JSON.stringify({ badgeId: badge.id }) : undefined,
      })
      const data = await response.json().catch(() => null) as { equippedBadgeId?: string | null; badge?: BadgeView; message?: string } | null
      if (!response.ok) throw new Error(data?.message || '佩戴状态更新失败')
      setCollection((current) => current ? {
        ...current,
        equippedBadgeId: data?.equippedBadgeId || null,
        items: current.items.map((item) => ({ ...item, isEquipped: item.id === data?.equippedBadgeId })),
      } : current)
      setSelected((current) => current ? { ...current, isEquipped: current.id === data?.equippedBadgeId } : null)
      window.dispatchEvent(new CustomEvent('eason-badge-updated', { detail: { uid: Number(uid), equippedBadge: equip ? data?.badge || badge : null } }))
      window.dispatchEvent(new CustomEvent('eason-badge-collection-updated', { detail: { uid: Number(uid) } }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '佩戴状态更新失败')
    } finally {
      setBusyId(null)
    }
  }, [uid])

  const obtainedItems = useMemo(() => collection?.items.filter((item) => item.status === 'OBTAINED') || [], [collection])
  const items = useMemo(() => {
    if (!collection) return []
    if (previewOnly) return obtainedItems.slice(0, 8)
    if (filter === 'obtained') return obtainedItems
    if (filter === 'progress') return collection.items.filter((item) => Boolean(item.progress && item.status === 'NOT_OBTAINED'))
    if (filter === 'limited') return collection.items.filter((item) => item.availabilityStatus && item.availabilityStatus !== 'PERMANENT')
    if (filter === 'hidden') return collection.items.filter((item) => item.status === 'HIDDEN' || item.visibility === 'HIDDEN')
    return collection.items
  }, [collection, filter, obtainedItems, previewOnly])

  const groupedItems = useMemo(() => {
    const groups = new Map<string, { name: string; sortOrder: number; items: BadgeView[] }>()
    items.forEach((item) => {
      const key = item.series?.id || 'uncategorized'
      const current = groups.get(key) || { name: item.series?.name || '未分类', sortOrder: item.series?.sortOrder ?? 999999, items: [] }
      current.items.push(item)
      groups.set(key, current)
    })
    return [...groups.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'))
  }, [items])

  const selectedTierItems = useMemo(() => {
    if (!selected?.tierGroupCode || !collection) return []
    return collection.items
      .filter((item) => item.tierGroupCode === selected.tierGroupCode)
      .sort((left, right) => (left.tierLevel || 0) - (right.tierLevel || 0))
  }, [collection, selected])

  const openShowcaseEditor = useCallback(async () => {
    if (!isSelf) return
    setError('')
    try {
      const response = await fetch('/api/users/me/badges', { cache: 'no-store' })
      const data = await response.json().catch(() => null) as BadgeCollectionView | { message?: string } | null
      if (!response.ok || !data || !('items' in data)) throw new Error(data && 'message' in data ? data.message || '勋章加载失败' : '勋章加载失败')
      setShowcaseCandidates(data.items.filter((item) => item.status === 'OBTAINED' && item.isEnabled))
      setShowcaseIds((data.showcase || []).sort((left, right) => left.slot - right.slot).map((item) => item.badge.id))
      setShowcaseEditor(true)
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : '勋章加载失败') }
  }, [isSelf])

  const saveShowcase = useCallback(async () => {
    setSavingShowcase(true)
    try {
      const response = await fetch('/api/users/me/badge-showcase', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ badgeIds: showcaseIds }) })
      const data = await response.json().catch(() => null) as { showcase?: BadgeShowcaseItemView[]; message?: string } | null
      if (!response.ok || !data?.showcase) throw new Error(data?.message || '橱窗保存失败')
      setCollection((current) => current ? { ...current, showcase: data.showcase } : current)
      setShowcaseEditor(false)
      window.dispatchEvent(new CustomEvent('eason-badge-collection-updated', { detail: { uid: Number(uid) } }))
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : '橱窗保存失败') }
    finally { setSavingShowcase(false) }
  }, [showcaseIds, uid])

  const moveShowcase = useCallback((badgeId: string, delta: -1 | 1) => {
    setShowcaseIds((current) => {
      const index = current.indexOf(badgeId)
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const moved = next[index]
      next[index] = next[nextIndex]
      next[nextIndex] = moved
      return next
    })
  }, [])

  const shareBadge = useCallback(async (badge: BadgeView) => {
    setBusyId(badge.id)
    try {
      const response = await fetch(`/api/users/me/badges/${encodeURIComponent(badge.id)}/share-card`, { method: 'POST' })
      if (!response.ok) { const data = await response.json().catch(() => null) as { message?: string } | null; throw new Error(data?.message || '分享卡片生成失败') }
      const blob = await response.blob()
      setShareSrc(URL.createObjectURL(blob))
    } catch (shareError) { setError(shareError instanceof Error ? shareError.message : '分享卡片生成失败') }
    finally { setBusyId(null) }
  }, [])

  if (loading) return <section className="rounded-2xl border border-sky-100 bg-white/85 p-5 text-sm font-bold text-slate-500">正在加载勋章…</section>
  if (error && !collection) return <section className="rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</section>
  if (!collection) return null

  return (
    <section className="badge-collection-section rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">E院荣誉</p>
          <h2 className="mt-1 text-xl font-black text-brand-950">勋章</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">已获得 {collection.publicObtainedCount ?? collection.obtainedCount} / {collection.publicTotal ?? collection.visibleTotal} · 完成度 {collection.completionPercentage ?? 0}%{collection.hiddenTotal ? ` · 隐藏 ${collection.hiddenObtainedCount ?? 0}/${collection.hiddenTotal}` : ''}</p>
        </div>
        {previewOnly ? <Link href={`/user/${uid}/badges`} className="rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">查看全部勋章</Link> : (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="勋章筛选">
            {([['all', '全部'], ['obtained', '已获得'], ['progress', '进行中'], ['limited', '限定'], ['hidden', '隐藏']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${filter === value ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{label}</button>)}
          </div>
        )}
      </div>
      {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700">{error}</p> : null}
      {collection.showcase?.length || collection.recent?.length ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><div id="showcase" className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black text-brand-950">荣誉橱窗</h3>{isSelf ? <button type="button" onClick={() => void openShowcaseEditor()} className="text-xs font-black text-brand-700">编辑橱窗</button> : null}</div><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{(collection.showcase || []).map((item) => <button key={item.badge.id} type="button" onClick={() => openBadge(item.badge)} className="grid min-w-0 place-items-center gap-1 rounded-xl bg-white/80 p-2"><BadgeImage badge={item.badge} size="wall" /><span className="w-full truncate text-center text-[10px] font-black text-brand-950">{item.badge.name}</span></button>)}{!collection.showcase?.length ? <p className="col-span-full py-3 text-xs font-bold text-slate-500">还没有放入橱窗的勋章。</p> : null}</div></div><div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4"><h3 className="text-sm font-black text-brand-950">最近获得</h3><div className="mt-3 space-y-2">{(collection.recent || []).slice(0, 5).map((badge) => <button key={badge.id} type="button" onClick={() => openBadge(badge)} className="flex w-full items-center gap-2 rounded-xl bg-white/80 p-2 text-left"><BadgeImage badge={badge} size="wall" /><span className="min-w-0"><strong className="block truncate text-xs font-black text-brand-950">{badge.name}</strong><span className="text-[10px] font-bold text-slate-500">获得于 {formatDate(badge.obtainedAt)}</span></span></button>)}{!collection.recent?.length ? <p className="py-3 text-xs font-bold text-slate-500">还没有获得记录。</p> : null}</div></div></div> : null}
      {!previewOnly && collection.seriesCompletions?.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{collection.seriesCompletions.map((series) => <Link key={series.series.id} href={`/badge-series/${series.series.id}`} className="rounded-2xl border border-violet-100 bg-violet-50/50 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm font-black text-brand-950">{series.series.name}</strong><span className="text-xs font-black text-violet-700">{series.completed ? '已完成' : `${series.collected}/${series.total}`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><span className="block h-full rounded-full bg-violet-700" style={{ width: `${series.percentage}%` }} /></div>{series.reward ? <p className="mt-2 text-[11px] font-bold text-slate-500">完成奖励：{series.reward.status === 'HIDDEN' ? '???' : series.reward.name}</p> : null}</Link>)}</div> : null}
      {!previewOnly && (groupedItems.length ? <div className="mt-4 space-y-5">{groupedItems.map((group) => <div key={group.name}><h3 className="mb-2 flex items-center gap-2 text-sm font-black text-brand-950"><span>{group.name}</span><span className="text-[11px] font-bold text-slate-400">{group.items.length} 枚</span></h3><div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">{group.items.map((badge) => <BadgeCard key={badge.id} badge={badge} isSelf={isSelf} onOpen={() => openBadge(badge)} onEquip={() => void changeEquipment(badge, true)} onUnequip={() => void changeEquipment(badge, false)} busy={busyId === badge.id} />)}</div></div>)}</div> : <p className="mt-4 rounded-xl border border-dashed border-sky-200 px-4 py-6 text-center text-sm font-bold text-slate-500">还没有可展示的勋章。</p>)}
      {selected ? <BadgeDetailDialog badge={selected} tierItems={selectedTierItems} onClose={closeBadge} canEquip={isSelf && selected.status === 'OBTAINED' && selected.isWearable && selected.isEnabled} canTrack={isSelf && canTrackBadgeView(selected)} onEquip={() => void changeEquipment(selected, true)} onUnequip={() => void changeEquipment(selected, false)} onShare={isSelf && selected.status === 'OBTAINED' ? () => void shareBadge(selected) : undefined} busy={busyId === selected.id} /> : null}
      {showcaseEditor ? <ShowcaseEditor badges={showcaseCandidates} selectedIds={showcaseIds} onToggle={(badgeId) => setShowcaseIds((current) => current.includes(badgeId) ? current.filter((id) => id !== badgeId) : current.length >= 6 ? current : [...current, badgeId])} onMove={moveShowcase} onClose={() => setShowcaseEditor(false)} onSave={() => void saveShowcase()} saving={savingShowcase} /> : null}
      {shareSrc ? <ShareCardDialog src={shareSrc} onClose={() => { URL.revokeObjectURL(shareSrc); setShareSrc(null) }} /> : null}
    </section>
  )
}
