'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeImage } from '@/components/UserDisplayName'
import { BADGE_RARITY_LABELS, type BadgeCollectionView, type BadgeView } from '@/lib/badge-types'

type Props = { uid: string; isSelf: boolean; previewOnly?: boolean }

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : ''
}

function BadgeDetailDialog({ badge, onClose, canEquip, onEquip, onUnequip, busy }: { badge: BadgeView; onClose: () => void; canEquip: boolean; onEquip: () => void; onUnequip: () => void; busy: boolean }) {
  return (
    <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="badge-detail-dialog max-w-md" role="dialog" aria-modal="true" aria-label={`${badge.name}勋章详情`} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭勋章详情">×</button>
        <BadgeImage badge={badge} size="detail" />
        <h3>{badge.name}</h3>
        <p className="badge-detail-rarity">{BADGE_RARITY_LABELS[badge.rarity]} · {badge.status === 'OBTAINED' ? '已获得' : badge.status === 'HIDDEN' ? '隐藏勋章' : '尚未获得'}</p>
        {badge.description ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{badge.description}</p> : null}
        {badge.acquisitionDescription ? <p className="mt-1 text-xs font-bold leading-5 text-slate-500">获取方式：{badge.acquisitionDescription}</p> : null}
        {badge.obtainedAt ? <p className="badge-detail-obtained">获得于 {formatDate(badge.obtainedAt)}</p> : null}
        {canEquip ? (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {badge.isEquipped ? <button type="button" onClick={onUnequip} disabled={busy} className="min-h-10 rounded-full border border-sky-200 bg-sky-50 px-4 text-sm font-black text-brand-700">{busy ? '处理中…' : '取消佩戴'}</button> : (
              <button type="button" onClick={onEquip} disabled={busy} className="min-h-10 rounded-full bg-brand-950 px-4 text-sm font-black text-white">{busy ? '处理中…' : '佩戴'}</button>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function BadgeCard({ badge, isSelf, onOpen, onEquip, onUnequip, busy }: { badge: BadgeView; isSelf: boolean; onOpen: () => void; onEquip: () => void; onUnequip: () => void; busy: boolean }) {
  const obtained = badge.status === 'OBTAINED'
  return (
    <article className={`badge-collection-card ${badge.status === 'HIDDEN' ? 'badge-collection-card-hidden' : ''}`}>
      <button type="button" className="badge-collection-card-main" onClick={onOpen} aria-label={`${badge.name}详情`}>
        <BadgeImage badge={badge} size="wall" />
        <span className="min-w-0 text-left">
          <strong className="block truncate text-sm font-black text-brand-950">{badge.name}</strong>
          <span className="mt-1 block text-[11px] font-bold text-slate-500">{badge.status === 'HIDDEN' ? '达成特殊条件后解锁' : obtained ? (badge.isEquipped ? '正在佩戴' : `获得于 ${formatDate(badge.obtainedAt)}`) : '尚未获得'}</span>
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
  const [filter, setFilter] = useState<'all' | 'obtained' | 'unobtained'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(uid)}/badges`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as BadgeCollectionView | { message?: string } | null
      const message = data && 'message' in data ? data.message : undefined
      if (!response.ok || !data || !('items' in data)) throw new Error(message || '勋章暂时无法加载')
      setCollection(data)
      setSelected((current) => current ? data.items.find((item) => item.id === current.id) || null : null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '勋章暂时无法加载')
    } finally {
      setLoading(false)
    }
  }, [uid])

  useEffect(() => { void load() }, [load])

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
    if (filter === 'unobtained') return collection.items.filter((item) => item.status !== 'OBTAINED')
    return collection.items
  }, [collection, filter, obtainedItems, previewOnly])

  if (loading) return <section className="rounded-2xl border border-sky-100 bg-white/85 p-5 text-sm font-bold text-slate-500">正在加载勋章…</section>
  if (error && !collection) return <section className="rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</section>
  if (!collection) return null

  return (
    <section className="badge-collection-section rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">E院荣誉</p>
          <h2 className="mt-1 text-xl font-black text-brand-950">勋章</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">已获得 {collection.obtainedCount} / {collection.visibleTotal}</p>
        </div>
        {previewOnly ? <Link href={`/user/${uid}/badges`} className="rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">查看全部勋章</Link> : (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="勋章筛选">
            {([['all', '全部'], ['obtained', '已获得'], ['unobtained', '未获得']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`rounded-full px-3 py-2 text-xs font-black ${filter === value ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{label}</button>)}
          </div>
        )}
      </div>
      {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700">{error}</p> : null}
      {items.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((badge) => <BadgeCard key={badge.id} badge={badge} isSelf={isSelf} onOpen={() => setSelected(badge)} onEquip={() => void changeEquipment(badge, true)} onUnequip={() => void changeEquipment(badge, false)} busy={busyId === badge.id} />)}</div> : <p className="mt-4 rounded-xl border border-dashed border-sky-200 px-4 py-6 text-center text-sm font-bold text-slate-500">还没有可展示的勋章。</p>}
      {selected ? <BadgeDetailDialog badge={selected} onClose={() => setSelected(null)} canEquip={isSelf && selected.status === 'OBTAINED' && selected.isWearable && selected.isEnabled} onEquip={() => void changeEquipment(selected, true)} onUnequip={() => void changeEquipment(selected, false)} busy={busyId === selected.id} /> : null}
    </section>
  )
}
