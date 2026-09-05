'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeImage, BadgeName } from '@/components/UserDisplayName'
import { BADGE_RARITY_LABELS, canTrackBadgeView, type BadgeCollectionView, type BadgeShowcaseItemView, type BadgeView, type EquippedBadgeView } from '@/lib/badge-types'

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

function historyStatusLabel(status: string) {
  if (status === 'EXPIRED') return '已过期'
  if (status === 'REVOKED') return '已收回'
  return '有效中'
}

export type BadgeDetailDialogProps = { badge: BadgeView; tierItems: BadgeView[]; onClose: () => void; canEquip: boolean; canTrack?: boolean; refreshProgress?: boolean; onEquip: () => void; onUnequip: () => void; onShare?: () => void; busy: boolean }

export function BadgeDetailDialog({ badge, tierItems, onClose, canEquip, canTrack = false, refreshProgress = false, onEquip, onUnequip, onShare, busy }: BadgeDetailDialogProps) {
  const [displayBadge, setDisplayBadge] = useState(badge)
  const [progressLoading, setProgressLoading] = useState(false)
  const [tracked, setTracked] = useState(false)
  const [trackingCount, setTrackingCount] = useState(0)
  const [trackingLimit, setTrackingLimit] = useState(10)
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [trackingMessage, setTrackingMessage] = useState('')

  useEffect(() => { setDisplayBadge(badge) }, [badge])

  useEffect(() => {
    const canRequestProgress = refreshProgress
      && badge.status === 'NOT_OBTAINED'
      && badge.visibility === 'PUBLIC'
      && badge.grantType === 'AUTO'
      && badge.isEnabled
    if (!canRequestProgress) return
    let active = true
    let requestController: AbortController | null = null
    const refresh = async () => {
      requestController?.abort()
      const controller = new AbortController()
      requestController = controller
      setProgressLoading(true)
      try {
        const response = await fetch(`/api/users/me/badges/${encodeURIComponent(badge.id)}`, { cache: 'no-store', signal: controller.signal })
        const data = await response.json().catch(() => null) as { badge?: BadgeView } | null
        if (active && !controller.signal.aborted && response.ok && data?.badge) setDisplayBadge(data.badge)
      } catch {
        // A transient refresh failure should leave the last server DTO visible.
      } finally {
        if (active && requestController === controller) {
          requestController = null
          setProgressLoading(false)
        }
      }
    }
    void refresh()
    const onCheckinChanged = () => { void refresh() }
    const onVisibilityChanged = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('checkin:dayChanged', onCheckinChanged)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChanged)
    return () => {
      active = false
      requestController?.abort()
      window.removeEventListener('checkin:dayChanged', onCheckinChanged)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChanged)
    }
  }, [badge.id, badge.status, badge.visibility, badge.grantType, badge.isEnabled, refreshProgress])

  const canTrackNow = Boolean((refreshProgress || canTrack) && canTrackBadgeView(displayBadge))

  useEffect(() => {
    setTracked(false)
    setTrackingCount(0)
    setTrackingMessage('')
    if (!canTrackNow) return
    let active = true
    void fetch('/api/users/me/badge-tasks', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((data) => {
      if (!active) return
      const items = Array.isArray(data?.tracking) ? data.tracking as Array<{ id: string }> : []
      setTracked(items.some((item) => item.id === displayBadge.id))
      setTrackingCount(items.length)
      if (Number.isInteger(data?.maxTracking)) setTrackingLimit(data.maxTracking)
    }).catch(() => undefined)
    return () => { active = false }
  }, [displayBadge.id, canTrackNow])

  const toggleTracking = async () => {
    setTrackingBusy(true); setTrackingMessage('')
    try {
      const response = await fetch(`/api/users/me/badge-tasks/${encodeURIComponent(displayBadge.id)}`, { method: tracked ? 'DELETE' : 'POST' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '操作失败')
      const nextTracked = !tracked
      setTracked(nextTracked)
      setTrackingCount((value) => Math.max(0, value + (nextTracked ? 1 : -1)))
      window.dispatchEvent(new CustomEvent('eason-badge-task-updated', { detail: { badgeId: displayBadge.id, tracked: nextTracked } }))
    } catch (error) { setTrackingMessage(error instanceof Error ? error.message : '操作失败') } finally { setTrackingBusy(false) }
  }
  return (
    <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="badge-detail-dialog max-w-md" role="dialog" aria-modal="true" aria-label={`${displayBadge.name}勋章详情`} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭勋章详情">×</button>
        <BadgeImage badge={displayBadge} size="detail" />
        <h3><BadgeName badge={displayBadge} /></h3>
        <p className="badge-detail-rarity">{BADGE_RARITY_LABELS[displayBadge.rarity]} · {displayBadge.series?.name || '未分类'} · {displayBadge.status === 'OBTAINED' ? '已获得' : displayBadge.status === 'HIDDEN' ? '隐藏勋章' : '尚未获得'}</p>
        {displayBadge.tierGroupCode && displayBadge.tierLevel ? <p className="badge-detail-rarity">{displayBadge.tierGroupCode} · 第 {displayBadge.tierLevel} 级{displayBadge.isHighestTier ? ' · 当前最高等级' : ''}</p> : null}
        {displayBadge.description ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{displayBadge.description}</p> : null}
        {displayBadge.acquisitionDescription ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">获取方式：{displayBadge.acquisitionDescription}</p> : null}
        {displayBadge.status === 'OBTAINED' ? <p className="mt-1 text-xs font-bold text-slate-500">有效期：{displayBadge.expiresAt ? `${formatDateTime(displayBadge.expiresAt)}${remainingLabel(displayBadge.expiresAt) ? ` · ${remainingLabel(displayBadge.expiresAt)}` : ''}` : '永久'}</p> : null}
        {displayBadge.status !== 'HIDDEN' && displayBadge.availabilityStatus ? <p className="mt-1 text-xs font-black text-brand-700">状态：{displayBadge.availabilityStatus === 'PERMANENT' ? '永久可获得' : displayBadge.availabilityStatus === 'UPCOMING' ? '即将开放' : displayBadge.availabilityStatus === 'ENDED' ? '限定 · 已绝版' : '限定开放中'}</p> : null}
        {displayBadge.status !== 'HIDDEN' && displayBadge.availabilityStatus && displayBadge.availabilityStatus !== 'PERMANENT' ? <p className="mt-1 text-xs font-bold text-slate-500">限定时间：{formatDateTime(displayBadge.availableFrom || null) || '不限开始'} – {formatDateTime(displayBadge.availableUntil || null) || '不限结束'}{displayBadge.availabilityStatus === 'AVAILABLE' && remainingLabel(displayBadge.availableUntil || null) ? ` · ${remainingLabel(displayBadge.availableUntil || null)}` : ''}</p> : null}
        {progressLoading && displayBadge.status === 'NOT_OBTAINED' && !displayBadge.progress ? <p className="mt-3 text-left text-xs font-bold text-slate-500">正在读取当前进度…</p> : null}
        {displayBadge.progress && !displayBadge.progress.progressUnsupported ? <div className="mt-3 w-full text-left"><div className="flex justify-between text-xs font-black text-slate-600"><span>当前进度</span><span>{displayBadge.progress.current} / {displayBadge.progress.target}{displayBadge.progress.unitLabel ? ` ${displayBadge.progress.unitLabel}` : ''} · {displayBadge.progress.percentage}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-sky-100"><span className="block h-full rounded-full bg-brand-700" style={{ width: `${displayBadge.progress.percentage}%` }} /></div></div> : null}
        {tierItems.length > 1 ? <div className="mt-3 text-left"><p className="text-xs font-black text-slate-600">成长等级</p><div className="mt-1 flex flex-wrap gap-2">{tierItems.map((tier) => <span key={tier.id} className={`rounded-full px-2 py-1 text-[11px] font-black ${tier.id === displayBadge.id ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>第 {tier.tierLevel} 级 {tier.status === 'OBTAINED' ? '✓' : tier.progress && !tier.progress.progressUnsupported ? `${tier.progress.current}/${tier.progress.target}` : '未获得'}</span>)}</div></div> : null}
        {displayBadge.ownershipStats && displayBadge.visibility === 'PUBLIC' ? <p className="mt-2 text-xs font-bold text-slate-500">全站获得率：{displayBadge.ownershipStats.display}（{displayBadge.ownershipStats.ownerCount} 人）</p> : null}
        {displayBadge.obtainedAt ? <p className="badge-detail-obtained">获得于 {formatDate(displayBadge.obtainedAt)}</p> : null}
        {canEquip ? (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {badge.isEquipped ? <button type="button" onClick={onUnequip} disabled={busy} className="min-h-10 rounded-full border border-sky-200 bg-sky-50 px-4 text-sm font-black text-brand-700">{busy ? '处理中…' : '取消佩戴'}</button> : (
              <button type="button" onClick={onEquip} disabled={busy} className="min-h-10 rounded-full bg-brand-950 px-4 text-sm font-black text-white">{busy ? '处理中…' : '佩戴'}</button>
            )}
          </div>
        ) : null}
        {onShare ? <button type="button" onClick={onShare} disabled={busy} className="mt-3 min-h-10 rounded-full border border-amber-200 bg-amber-50 px-4 text-sm font-black text-amber-800">分享勋章</button> : null}
        {canTrackNow ? <>
          <button type="button" onClick={() => void toggleTracking()} disabled={trackingBusy} aria-pressed={tracked} className={`mt-3 min-h-10 rounded-full border px-4 text-sm font-black ${tracked ? 'border-brand-700 bg-brand-950 text-white' : 'border-sky-200 bg-sky-50 text-brand-700'}`}>{trackingBusy ? '处理中…' : tracked ? '✓ 正在追踪（取消）' : '＋ 追踪此勋章'}</button>
          <p className="mt-1 text-[11px] font-bold text-slate-500">正在追踪 {trackingCount} / {trackingLimit} 枚</p>
        </> : null}
        {trackingMessage ? <p className="mt-2 text-xs font-bold text-rose-600">{trackingMessage}</p> : null}
      </section>
    </div>
  )
}

function ShowcaseEditor({ badges, selectedIds, onToggle, onMove, onClose, onSave, saving }: { badges: BadgeView[]; selectedIds: string[]; onToggle: (badgeId: string) => void; onMove: (badgeId: string, delta: -1 | 1) => void; onClose: () => void; onSave: () => void; saving: boolean }) {
  return <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}><section className="badge-detail-dialog max-w-lg" role="dialog" aria-modal="true" aria-label="编辑荣誉橱窗" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭荣誉橱窗编辑">×</button><h3>编辑荣誉橱窗</h3><p className="mt-2 text-xs font-bold text-slate-500">最多选择 6 枚已获得勋章；选中后可用上移、下移调整主页展示顺序。</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{badges.map((badge) => { const selectedIndex = selectedIds.indexOf(badge.id); return <div key={badge.id} className={`min-w-0 rounded-xl border p-2 ${selectedIndex >= 0 ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}><button type="button" onClick={() => onToggle(badge.id)} className="flex w-full min-w-0 items-center gap-2 text-left"><BadgeImage badge={badge} size="wall" /><span className="min-w-0"><strong className="block truncate text-xs font-black text-brand-950"><BadgeName badge={badge} /></strong><span className="text-[10px] font-bold text-slate-500">{selectedIndex >= 0 ? `橱窗第 ${selectedIndex + 1} 位` : '加入橱窗'}</span></span></button>{selectedIndex >= 0 ? <div className="mt-2 flex justify-end gap-1"><button type="button" onClick={() => onMove(badge.id, -1)} disabled={selectedIndex === 0} aria-label={`将${badge.name}上移`} className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-brand-700 disabled:opacity-40">↑</button><button type="button" onClick={() => onMove(badge.id, 1)} disabled={selectedIndex === selectedIds.length - 1} aria-label={`将${badge.name}下移`} className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-brand-700 disabled:opacity-40">↓</button></div> : null}</div> })}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-slate-600">取消</button><button type="button" onClick={onSave} disabled={saving} className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">{saving ? '保存中…' : '保存橱窗'}</button></div></section></div>
}

function ShareCardDialog({src, onClose}: {src: string; onClose: () => void}) {
  return <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}><section className="badge-detail-dialog max-w-md" role="dialog" aria-modal="true" aria-label="分享勋章卡片" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭分享卡片">×</button><h3>分享勋章</h3><img src={src} alt="勋章分享卡片" className="mt-3 max-h-[70vh] w-full rounded-2xl object-contain" /><a href={src} download="e院勋章.png" className="mt-3 inline-flex min-h-10 items-center justify-center rounded-full bg-brand-950 px-4 text-sm font-black text-white">保存图片</a></section></div>
}

function EquippedBadgeOrderEditor({ badges, onReorder, busy }: { badges: EquippedBadgeView[]; onReorder: (badgeIds: string[]) => void; busy: boolean }) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const move = (badgeId: string, delta: -1 | 1) => {
    const index = badges.findIndex((badge) => badge.id === badgeId)
    const nextIndex = index + delta
    if (index < 0 || nextIndex < 0 || nextIndex >= badges.length || busy) return
    const next = badges.map((badge) => badge.id)
    const [moved] = next.splice(index, 1)
    next.splice(nextIndex, 0, moved)
    onReorder(next)
  }

  const drop = (targetId: string) => {
    if (!draggedId || draggedId === targetId || busy) return
    const next = badges.map((badge) => badge.id)
    const from = next.indexOf(draggedId)
    const to = next.indexOf(targetId)
    if (from < 0 || to < 0) return
    next.splice(from, 1)
    next.splice(to, 0, draggedId)
    onReorder(next)
    setDraggedId(null)
    setDragOverId(null)
  }

  return (
    <section className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4" aria-label="当前佩戴勋章">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-brand-950">当前佩戴勋章</h3>
          <p className="mt-1 text-xs font-bold text-slate-500">可同时佩戴任意数量；拖拽或使用箭头调整昵称后的显示顺序。</p>
        </div>
        {busy ? <span className="text-xs font-black text-brand-700">保存中…</span> : null}
      </div>
      {badges.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="list" aria-label="佩戴顺序">
          {badges.map((badge, index) => (
            <div
              key={badge.id}
              role="listitem"
              draggable={!busy}
              onDragStart={() => { setDraggedId(badge.id); setDragOverId(null) }}
              onDragOver={(event) => { event.preventDefault(); setDragOverId(badge.id) }}
              onDrop={() => drop(badge.id)}
              onDragEnd={() => { setDraggedId(null); setDragOverId(null) }}
              className={`inline-flex items-center gap-1 rounded-xl border bg-white px-2 py-1.5 ${dragOverId === badge.id ? 'border-brand-700 ring-2 ring-brand-200' : 'border-violet-100'} ${draggedId === badge.id ? 'opacity-60' : ''}`}
              title={`${badge.name} · 第 ${index + 1} 位`}
            >
              <BadgeImage badge={badge} size="inline" />
              <span className="max-w-24 truncate text-[11px] font-black text-brand-950">{badge.name}</span>
              <button type="button" onClick={() => move(badge.id, -1)} disabled={index === 0 || busy} aria-label={`将${badge.name}上移`} className="rounded-full px-1 text-xs font-black text-brand-700 disabled:opacity-30">↑</button>
              <button type="button" onClick={() => move(badge.id, 1)} disabled={index === badges.length - 1 || busy} aria-label={`将${badge.name}下移`} className="rounded-full px-1 text-xs font-black text-brand-700 disabled:opacity-30">↓</button>
            </div>
          ))}
        </div>
      ) : <p className="mt-3 rounded-xl border border-dashed border-violet-200 bg-white/70 px-3 py-3 text-xs font-bold text-slate-500">暂未佩戴勋章。请在下方勋章卡片中选择“佩戴”。</p>}
    </section>
  )
}

function BadgeCard({ badge, isSelf, onOpen, onEquip, onUnequip, busy }: { badge: BadgeView; isSelf: boolean; onOpen: () => void; onEquip: () => void; onUnequip: () => void; busy: boolean }) {
  const obtained = badge.status === 'OBTAINED'
  const limited = badge.availabilityStatus && badge.availabilityStatus !== 'PERMANENT'
  return (
    <article className={`badge-collection-card ${badge.status === 'HIDDEN' ? 'badge-collection-card-hidden' : ''}`}>
      <button type="button" className="badge-collection-card-main" onClick={onOpen} aria-label={`${badge.name}详情`}>
        <BadgeImage badge={badge} size="wall" />
        <span className="min-w-0 text-left">
          <strong className="block truncate text-sm font-black text-brand-950"><BadgeName badge={badge} /></strong>
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
  const [reordering, setReordering] = useState(false)
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeId: badge.id }),
      })
      const data = await response.json().catch(() => null) as { equippedBadges?: EquippedBadgeView[]; equippedBadgeId?: string | null; badge?: EquippedBadgeView | null; message?: string } | null
      if (!response.ok) throw new Error(data?.message || '佩戴状态更新失败')
      const equippedBadges = Array.isArray(data?.equippedBadges)
        ? data.equippedBadges
        : data?.equippedBadgeId
          ? [data.badge || badge]
          : []
      const equippedIds = new Set(equippedBadges.map((item) => item.id))
      setCollection((current) => current ? {
        ...current,
        equippedBadges,
        equippedBadgeId: equippedBadges[0]?.id || null,
        items: current.items.map((item) => ({ ...item, isEquipped: equippedIds.has(item.id) })),
      } : current)
      setSelected((current) => current ? { ...current, isEquipped: equippedIds.has(current.id) } : null)
      window.dispatchEvent(new CustomEvent('eason-badge-updated', { detail: { uid: Number(uid), equippedBadges, equippedBadge: equippedBadges[0] || null } }))
      window.dispatchEvent(new CustomEvent('eason-badge-collection-updated', { detail: { uid: Number(uid) } }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '佩戴状态更新失败')
    } finally {
      setBusyId(null)
    }
  }, [uid])

  const reorderEquipment = useCallback(async (badgeIds: string[]) => {
    if (!isSelf || !collection || reordering) return
    setReordering(true)
    setError('')
    try {
      const response = await fetch('/api/users/me/badge/equip', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badgeIds }),
      })
      const data = await response.json().catch(() => null) as { equippedBadges?: EquippedBadgeView[]; message?: string } | null
      if (!response.ok || !Array.isArray(data?.equippedBadges)) throw new Error(data?.message || '佩戴顺序保存失败')
      const equippedIds = new Set(data.equippedBadges.map((item) => item.id))
      setCollection((current) => current ? {
        ...current,
        equippedBadges: data.equippedBadges!,
        equippedBadgeId: data.equippedBadges![0]?.id || null,
        items: current.items.map((item) => ({ ...item, isEquipped: equippedIds.has(item.id) })),
      } : current)
      window.dispatchEvent(new CustomEvent('eason-badge-updated', { detail: { uid: Number(uid), equippedBadges: data.equippedBadges, equippedBadge: data.equippedBadges[0] || null } }))
      window.dispatchEvent(new CustomEvent('eason-badge-collection-updated', { detail: { uid: Number(uid) } }))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '佩戴顺序保存失败')
    } finally {
      setReordering(false)
    }
  }, [collection, isSelf, reordering, uid])

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
      {!previewOnly && isSelf ? <EquippedBadgeOrderEditor badges={collection.equippedBadges} onReorder={(badgeIds) => void reorderEquipment(badgeIds)} busy={reordering} /> : null}
      {collection.showcase?.length || collection.recent?.length ? <div className="mt-4 grid gap-4 lg:grid-cols-2"><div id="showcase" className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black text-brand-950">荣誉橱窗</h3>{isSelf ? <button type="button" onClick={() => void openShowcaseEditor()} className="text-xs font-black text-brand-700">编辑橱窗</button> : null}</div><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{(collection.showcase || []).map((item) => <button key={item.badge.id} type="button" onClick={() => openBadge(item.badge)} className="grid min-w-0 place-items-center gap-1 rounded-xl bg-white/80 p-2"><BadgeImage badge={item.badge} size="wall" /><BadgeName badge={item.badge} className="w-full truncate text-center text-[10px] font-black text-brand-950" /></button>)}{!collection.showcase?.length ? <p className="col-span-full py-3 text-xs font-bold text-slate-500">还没有放入橱窗的勋章。</p> : null}</div></div><div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4"><h3 className="text-sm font-black text-brand-950">最近获得</h3><div className="mt-3 space-y-2">{(collection.recent || []).slice(0, 5).map((badge) => <button key={badge.id} type="button" onClick={() => openBadge(badge)} className="flex w-full items-center gap-2 rounded-xl bg-white/80 p-2 text-left"><BadgeImage badge={badge} size="wall" /><span className="min-w-0"><strong className="block truncate text-xs font-black text-brand-950"><BadgeName badge={badge} /></strong><span className="text-[10px] font-bold text-slate-500">获得于 {formatDate(badge.obtainedAt)}</span></span></button>)}{!collection.recent?.length ? <p className="py-3 text-xs font-bold text-slate-500">还没有获得记录。</p> : null}</div></div></div> : null}
      {!previewOnly && collection.seriesCompletions?.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{collection.seriesCompletions.map((series) => <Link key={series.series.id} href={`/badge-series/${series.series.id}`} className="rounded-2xl border border-violet-100 bg-violet-50/50 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-sm font-black text-brand-950">{series.series.name}</strong><span className="text-xs font-black text-violet-700">{series.completed ? '已完成' : `${series.collected}/${series.total}`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><span className="block h-full rounded-full bg-violet-700" style={{ width: `${series.percentage}%` }} /></div>{series.reward ? <p className="mt-2 text-[11px] font-bold text-slate-500">完成奖励：{series.reward.status === 'HIDDEN' ? '???' : <BadgeName badge={series.reward} />}</p> : null}</Link>)}</div> : null}
      {!previewOnly && isSelf ? <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><h3 className="text-sm font-black text-brand-950">历史获得</h3>{collection.history?.length ? <div className="mt-3 space-y-2">{collection.history.map((item) => <article key={item.recordId} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"><BadgeImage badge={item.badge} size="wall" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-xs font-black text-brand-950"><BadgeName badge={item.badge} /></strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${item.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : item.status === 'EXPIRED' ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-700'}`}>{historyStatusLabel(item.status)}</span></div><p className="mt-1 text-[11px] font-bold text-slate-500">获得：{formatDateTime(item.awardedAt)}</p><p className="mt-1 text-[11px] font-bold text-slate-500">{item.expiresAt ? `有效至：${formatDateTime(item.expiresAt)}` : '有效期：永久'}</p>{item.status === 'EXPIRED' && item.expiredAt ? <p className="mt-1 text-[11px] font-bold text-slate-500">失效：{formatDateTime(item.expiredAt)}</p> : null}{item.status === 'REVOKED' && item.revokedAt ? <p className="mt-1 text-[11px] font-bold text-rose-700">收回：{formatDateTime(item.revokedAt)}</p> : null}</div></article>)}</div> : <p className="mt-2 text-xs font-bold text-slate-500">还没有历史获得记录。</p>}</section> : null}
      {!previewOnly && (groupedItems.length ? <div className="mt-4 space-y-5">{groupedItems.map((group) => <div key={group.name}><h3 className="mb-2 flex items-center gap-2 text-sm font-black text-brand-950"><span>{group.name}</span><span className="text-[11px] font-bold text-slate-400">{group.items.length} 枚</span></h3><div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">{group.items.map((badge) => <BadgeCard key={badge.id} badge={badge} isSelf={isSelf} onOpen={() => openBadge(badge)} onEquip={() => void changeEquipment(badge, true)} onUnequip={() => void changeEquipment(badge, false)} busy={busyId === badge.id} />)}</div></div>)}</div> : <p className="mt-4 rounded-xl border border-dashed border-sky-200 px-4 py-6 text-center text-sm font-bold text-slate-500">还没有可展示的勋章。</p>)}
      {selected ? <BadgeDetailDialog badge={selected} tierItems={selectedTierItems} onClose={closeBadge} canEquip={isSelf && selected.status === 'OBTAINED' && selected.isWearable && selected.isEnabled} canTrack={isSelf && canTrackBadgeView(selected)} refreshProgress={isSelf} onEquip={() => void changeEquipment(selected, true)} onUnequip={() => void changeEquipment(selected, false)} onShare={isSelf && selected.status === 'OBTAINED' ? () => void shareBadge(selected) : undefined} busy={busyId === selected.id} /> : null}
      {showcaseEditor ? <ShowcaseEditor badges={showcaseCandidates} selectedIds={showcaseIds} onToggle={(badgeId) => setShowcaseIds((current) => current.includes(badgeId) ? current.filter((id) => id !== badgeId) : current.length >= 6 ? current : [...current, badgeId])} onMove={moveShowcase} onClose={() => setShowcaseEditor(false)} onSave={() => void saveShowcase()} saving={savingShowcase} /> : null}
      {shareSrc ? <ShareCardDialog src={shareSrc} onClose={() => { URL.revokeObjectURL(shareSrc); setShareSrc(null) }} /> : null}
    </section>
  )
}
