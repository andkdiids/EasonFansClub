'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { normalizeBadgeColor } from '@/lib/badge-types'

export type UserDisplayNameBadge = EquippedBadgeView

type UserDisplayNameProps = {
  name: string
  uid?: number | null
  href?: string | null
  badge?: UserDisplayNameBadge | null
  showBadge?: boolean
  showBadgeName?: boolean
  compact?: boolean
  className?: string
  nameClassName?: string
}

const GOLD_START = '#b88a3b'
const GOLD_MID = '#f3d98b'
const GOLD_END = '#9b6a24'
type BadgeNicknameStyle = CSSProperties & {
  '--badge-name-fallback'?: string
  '--badge-gradient-start'?: string
  '--badge-gradient-mid'?: string
  '--badge-gradient-end'?: string
}
type BadgeVisualStyle = CSSProperties & {
  '--badge-shine-mask'?: string
}

export function badgeEffectClass(effectType: EquippedBadgeView['effectType']) {
  if (effectType === 'SHINE') return 'badge-effect-shine'
  if (effectType === 'GLOW') return 'badge-effect-glow'
  if (effectType === 'SPARKLE') return 'badge-effect-sparkle'
  return ''
}

function badgeNameEffectClass(effectType: EquippedBadgeView['effectType']) {
  if (effectType === 'SHINE') return 'badge-name-shine'
  if (effectType === 'GLOW') return 'badge-name-glow'
  if (effectType === 'SPARKLE') return 'badge-name-sparkle'
  return ''
}

function nicknameEffectClass(effectType: UserDisplayNameBadge['nicknameEffect']) {
  if (effectType === 'GOLD') return 'user-nickname-effect-gold'
  if (effectType === 'GRADIENT') return 'user-nickname-effect-gradient'
  if (effectType === 'GLOW') return 'user-nickname-effect-glow'
  return ''
}

export function badgeNicknameStyle(badge?: UserDisplayNameBadge | null): BadgeNicknameStyle {
  if (!badge || badge.nicknameEffect === 'NONE') return {}
  if (badge.nicknameEffect === 'COLOR') {
    const color = normalizeBadgeColor(badge.nicknameColor) || '#0f5f78'
    return { color }
  }
  if (badge.nicknameEffect === 'GOLD') {
    return {
      '--badge-name-fallback': GOLD_START,
      '--badge-gradient-start': GOLD_END,
      '--badge-gradient-mid': GOLD_MID,
      '--badge-gradient-end': GOLD_END,
    }
  }
  if (badge.nicknameEffect === 'GRADIENT') {
    const start = normalizeBadgeColor(badge.nicknameGradientStart) || '#0f5f78'
    const end = normalizeBadgeColor(badge.nicknameGradientEnd) || '#7c3aed'
    return {
      '--badge-name-fallback': start,
      '--badge-gradient-start': start,
      '--badge-gradient-end': end,
    }
  }
  return {
    color: normalizeBadgeColor(badge.nicknameColor) || '#0f5f78',
    textShadow: '0 0 4px currentColor, 0 0 10px rgba(14,116,144,.38)',
  }
}

export function BadgeName({ badge, className = '' }: { badge: Pick<UserDisplayNameBadge, 'name' | 'effectType'>; className?: string }) {
  const effectClass = badgeNameEffectClass(badge.effectType)
  return (
    <span className={`badge-name-display ${effectClass} ${className}`.trim()}>
      {badge.name}
      {badge.effectType === 'SHINE' ? <span className="badge-name-shine-overlay" aria-hidden="true">{badge.name}</span> : null}
    </span>
  )
}

export function BadgeImage({ badge, size = 'inline', className = '' }: { badge: Pick<UserDisplayNameBadge, 'name' | 'imageUrl' | 'effectType'>; size?: 'inline' | 'wall' | 'detail'; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  useEffect(() => setFailedSource(null), [badge.imageUrl])
  const sizeClass = size === 'detail' ? 'badge-image-detail' : size === 'wall' ? 'badge-image-wall' : 'badge-image-inline'
  const hasImage = Boolean(badge.imageUrl && failedSource !== badge.imageUrl)
  if (!hasImage) return <span className={`user-badge-placeholder ${sizeClass} ${className}`} aria-label={badge.name}>?</span>
  const effectClass = badgeEffectClass(badge.effectType)
  const visualStyle: BadgeVisualStyle | undefined = badge.effectType === 'SHINE'
    ? { '--badge-shine-mask': `url(${JSON.stringify(badge.imageUrl || '')})` }
    : undefined
  return (
    <span className={`badge-visual ${sizeClass} ${effectClass} ${className}`.trim()} style={visualStyle}>
      {badge.effectType === 'SPARKLE' ? <span className="badge-visual-sparkles" aria-hidden="true"><i /><i /><i /><i /></span> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={badge.imageUrl || ''} alt={badge.name} onError={() => { if (process.env.NODE_ENV === 'development') console.warn('[badge-image] failed to load', badge.imageUrl); setFailedSource(badge.imageUrl) }} className="user-badge-image" loading="lazy" />
      {badge.effectType === 'SHINE' ? (
        <span className="badge-shimmer-clip" aria-hidden="true"><span className="badge-shimmer-layer" /></span>
      ) : null}
    </span>
  )
}

function BadgeDetail({ badge, onClose }: { badge: UserDisplayNameBadge; onClose: () => void }) {
  return (
    <div className="badge-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="badge-detail-dialog" role="dialog" aria-modal="true" aria-label={`${badge.name}勋章详情`} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="badge-detail-close" onClick={onClose} aria-label="关闭勋章详情">×</button>
        <BadgeImage badge={badge} size="detail" />
        <h3><BadgeName badge={badge} /></h3>
        {badge.rarity ? <p className="badge-detail-rarity">{badge.rarity}</p> : null}
        {badge.description ? <p className="badge-detail-description">{badge.description}</p> : null}
        {badge.acquisitionDescription ? <p className="badge-detail-acquisition">获取方式：{badge.acquisitionDescription}</p> : null}
        {badge.obtainedAt ? <p className="badge-detail-obtained">获得于 {new Date(badge.obtainedAt).toLocaleDateString('zh-CN')}</p> : null}
      </section>
    </div>
  )
}

export function UserDisplayName({ name, uid, href, badge, showBadge = true, showBadgeName = false, compact = false, className = '', nameClassName = '' }: UserDisplayNameProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [liveBadge, setLiveBadge] = useState<UserDisplayNameBadge | null | undefined>(badge)
  useEffect(() => setLiveBadge(badge), [badge])
  useEffect(() => {
    const updateBadge = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: number; equippedBadge?: UserDisplayNameBadge | null }>).detail
      if (detail?.uid !== undefined && uid !== undefined && detail.uid !== uid) return
      if (detail && 'equippedBadge' in detail) setLiveBadge(detail.equippedBadge)
    }
    window.addEventListener('eason-badge-updated', updateBadge)
    return () => window.removeEventListener('eason-badge-updated', updateBadge)
  }, [uid])
  const displayBadge = showBadge ? liveBadge : null
  const style = useMemo(() => badgeNicknameStyle(displayBadge), [displayBadge])
  const nicknameClass = displayBadge ? nicknameEffectClass(displayBadge.nicknameEffect) : ''
  const badgeClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (displayBadge) setDetailOpen(true)
  }
  const badgeKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    if (displayBadge) setDetailOpen(true)
  }

  const content = (
    <span className={`user-display-name ${compact ? 'user-display-name-compact' : ''} ${className}`}>
      <span className={`user-display-name-text ${displayBadge?.nicknameEffect === 'GOLD' || displayBadge?.nicknameEffect === 'GRADIENT' ? 'user-display-name-text-gradient' : ''} ${nicknameClass} ${nameClassName}`.trim()} style={style}>{name}</span>
      {displayBadge ? (
        <span
          className="user-display-badge"
          role="button"
          tabIndex={0}
          title={`${displayBadge.name} · 点击查看详情`}
          aria-label={`${displayBadge.name}，点击查看详情`}
          onClick={badgeClick}
          onKeyDown={badgeKeyDown}
        >
          <BadgeImage badge={displayBadge} />
          {showBadgeName && !compact ? <span className="user-display-badge-name"><BadgeName badge={displayBadge} /></span> : null}
          <span className="user-display-badge-tooltip" role="tooltip">
            <BadgeImage badge={displayBadge} size="wall" />
            <span>
              <strong><BadgeName badge={displayBadge} /></strong>
              {displayBadge.obtainedAt ? <small>获得于 {new Date(displayBadge.obtainedAt).toLocaleDateString('zh-CN')}</small> : null}
            </span>
          </span>
        </span>
      ) : null}
    </span>
  )

  return (
    <>
      {href ? <Link href={href} className="user-display-name-link">{content}</Link> : content}
      {detailOpen && displayBadge ? <BadgeDetail badge={displayBadge} onClose={() => setDetailOpen(false)} /> : null}
    </>
  )
}
