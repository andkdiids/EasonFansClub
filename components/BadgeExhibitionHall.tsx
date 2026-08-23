'use client'

import { useEffect, useMemo, useState } from 'react'
import { BadgeDetailDialog } from '@/components/BadgeCollectionPanel'
import { BadgeImage } from '@/components/UserDisplayName'
import { chunkMuseumShelves, orderMuseumBadges } from '@/lib/badge-museum'
import type { BadgeGalleryView, BadgeView } from '@/lib/badge-types'

type Props = { gallery: BadgeGalleryView }
type MuseumView = 'all' | 'mine'

function availabilityLabel(badge: BadgeView) {
  if (badge.availabilityStatus === 'ENDED') return '已绝版'
  if (badge.availabilityStatus === 'UPCOMING') return '即将开放'
  if (badge.availabilityStatus === 'AVAILABLE') return '限定'
  return null
}

function BadgeMuseumItem({ badge, onOpen }: { badge: BadgeView; onOpen: () => void }) {
  const hidden = badge.status === 'HIDDEN'
  const obtained = badge.status === 'OBTAINED'
  const limited = availabilityLabel(badge)
  return (
    <button
      type="button"
      className={`badge-museum-item ${obtained ? 'is-obtained' : ''} ${hidden ? 'is-hidden' : ''} ${badge.availabilityStatus === 'ENDED' ? 'is-ended' : ''}`}
      onClick={onOpen}
      aria-label={`${hidden ? '隐藏勋章' : badge.name}详情`}
    >
      <span className="badge-museum-item-image"><BadgeImage badge={badge} size="wall" /></span>
      <span className="badge-museum-item-name">{hidden ? '???' : badge.name}</span>
      {obtained ? <span className="badge-museum-item-state">{badge.isEquipped ? '佩戴中' : '已收藏'}</span> : hidden ? <span className="badge-museum-item-state">隐藏勋章</span> : <span className="badge-museum-item-state">{limited || (badge.progress ? `${badge.progress.current}/${badge.progress.target}` : '未获得')}</span>}
      {limited ? <span className="badge-museum-item-tag">{limited}</span> : null}
    </button>
  )
}

function MuseumEmptyState() {
  return <div className="badge-museum-empty"><span className="badge-museum-empty-mark">✦</span><strong>展览馆正在布置中</strong><span>新的 E 院荣誉藏品即将陈列。</span></div>
}

export function BadgeExhibitionHall({ gallery }: Props) {
  const [view, setView] = useState<MuseumView>('all')
  const [seriesFilter, setSeriesFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<BadgeView | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialView = params.get('view')
    if (initialView === 'mine' && gallery.isAuthenticated) setView('mine')
    const requestedSeries = params.get('series')
    const validSeries = requestedSeries && gallery.series.some((entry) => entry.series.id === requestedSeries)
      ? requestedSeries
      : 'all'
    setSeriesFilter(validSeries)
    const badgeId = params.get('badge')
    if (badgeId) {
      const requestedBadge = gallery.items.find((item) => item.id === badgeId)
      const canOpenInInitialView = initialView === 'mine' || requestedBadge?.visibility !== 'SECRET'
      setSelected(canOpenInInitialView ? requestedBadge || null : null)
    }
  }, [gallery])

  const selectedTierItems = useMemo(() => selected?.tierGroupCode
    ? gallery.items
      .filter((item) => (view === 'mine' || item.visibility !== 'SECRET') && item.tierGroupCode === selected.tierGroupCode)
      .sort((left, right) => (left.tierLevel || 0) - (right.tierLevel || 0))
    : [], [gallery.items, selected, view])

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN')
    return gallery.items.filter((badge) => {
      if (view === 'all' && badge.visibility === 'SECRET') return false
      // “我的收藏” keeps PUBLIC and safe HIDDEN positions dimmed so the user
      // can see what remains to collect; unearned SECRET is absent from DTO.
      if (seriesFilter !== 'all' && badge.series?.id !== seriesFilter) return false
      if (!query || badge.status === 'HIDDEN') return !query || badge.name.toLocaleLowerCase('zh-CN').includes(query)
      return badge.name.toLocaleLowerCase('zh-CN').includes(query)
        || (badge.description || '').toLocaleLowerCase('zh-CN').includes(query)
        || (badge.series?.name || '').toLocaleLowerCase('zh-CN').includes(query)
    })
  }, [gallery.items, search, seriesFilter, view])

  const displaySeries = useMemo(() => gallery.series.filter((entry) => view === 'mine' || gallery.items.some((badge) => badge.series?.id === entry.series.id && badge.visibility !== 'SECRET')), [gallery.items, gallery.series, view])

  const sections = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; sortOrder: number; items: BadgeView[] }>()
    visibleItems.forEach((badge) => {
      const key = badge.series?.id || 'mystery'
      const current = groups.get(key) || {
        id: key,
        name: badge.series?.name || '神秘馆藏',
        sortOrder: badge.series?.sortOrder ?? 999999,
        items: [],
      }
      current.items.push(badge)
      groups.set(key, current)
    })
    return [...groups.values()]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'))
      .map((section) => ({ ...section, items: orderMuseumBadges(section.items), shelves: chunkMuseumShelves(section.items, 6) }))
  }, [visibleItems])

  const updateView = (next: MuseumView) => {
    setView(next)
    if (next === 'all') setSelected((current) => current?.visibility === 'SECRET' ? null : current)
    const params = new URLSearchParams(window.location.search)
    params.set('view', next)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  }

  const updateSeriesFilter = (next: string) => {
    setSeriesFilter(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'all') params.delete('series')
    else params.set('series', next)
    window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`)
  }

  return (
    <section className="badge-museum-page">
      <header className="badge-museum-hero">
        <div>
          <p className="badge-museum-kicker">EASON FANS CLUB · HONOR ARCHIVE</p>
          <h1>勋章展览馆</h1>
          <p className="badge-museum-intro">把每一份真实获得的荣誉，放进属于 E 院的陈列柜。</p>
        </div>
        <div className="badge-museum-stat" aria-label="我的馆藏完成度">
          <span>我的馆藏</span>
          <strong>{gallery.collectibleObtainedCount} <em>/ {gallery.collectibleTotal}</em></strong>
          <small>完成度 {gallery.completionPercentage}%</small>
        </div>
      </header>

      <div className="badge-museum-toolbar">
        <div className="badge-museum-tabs" role="tablist" aria-label="展览视角">
          <button type="button" role="tab" aria-selected={view === 'all'} onClick={() => updateView('all')}>全部馆藏</button>
          {gallery.isAuthenticated ? <button type="button" role="tab" aria-selected={view === 'mine'} onClick={() => updateView('mine')}>我的收藏</button> : null}
        </div>
        <label className="badge-museum-search"><span className="sr-only">搜索勋章</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索勋章" /></label>
      </div>
      <nav className="badge-museum-series-nav" aria-label="勋章系列导航">
        <button type="button" className={seriesFilter === 'all' ? 'is-active' : ''} onClick={() => updateSeriesFilter('all')}>全部</button>
        {displaySeries.map((entry, index) => <button type="button" key={entry.series.id} className={seriesFilter === entry.series.id ? 'is-active' : ''} onClick={() => updateSeriesFilter(entry.series.id)}>{String(index + 1).padStart(2, '0')} {entry.series.name}</button>)}
      </nav>

      {sections.length ? <div className="badge-museum-sections">{sections.map((section, sectionIndex) => {
        const completion = gallery.series.find((entry) => entry.series.id === section.id)
        return <section key={section.id} id={`badge-series-${section.id}`} className="badge-museum-series">
          <header className="badge-museum-series-header"><div className="badge-museum-series-title"><span className="badge-museum-series-number">{String(sectionIndex + 1).padStart(2, '0')}</span><div><h2>{section.name}</h2>{completion ? <p>{completion.completed ? '系列完成 ✓' : `已收藏 ${completion.collected} / ${completion.total}`} · {completion.percentage}%</p> : <p>荣誉陈列</p>}</div></div>{completion?.reward ? <span className="badge-museum-reward">{completion.reward.status === 'HIDDEN' ? '完成奖励 · ???' : completion.reward.status === 'OBTAINED' ? '已解锁系列奖励' : '完成奖励 · 未解锁'}</span> : null}</header>
          <div className="badge-museum-cabinet"><div className="badge-museum-cabinet-cap" />{section.shelves.map((shelf, shelfIndex) => <div className="badge-museum-shelf" key={`${section.id}-${shelfIndex}`}><span className="badge-museum-shelf-number">Shelf {String(shelfIndex + 1).padStart(2, '0')}</span><div className="badge-museum-shelf-display">{shelf.map((badge) => <BadgeMuseumItem key={badge.id} badge={badge} onOpen={() => setSelected(badge)} />)}</div><div className="badge-museum-shelf-board" /></div>)}<div className="badge-museum-cabinet-base" /></div>
        </section>
      })}</div> : <MuseumEmptyState />}

      {selected ? <BadgeDetailDialog badge={selected} tierItems={selectedTierItems} onClose={() => setSelected(null)} canEquip={false} onEquip={() => undefined} onUnequip={() => undefined} busy={false} /> : null}
    </section>
  )
}
