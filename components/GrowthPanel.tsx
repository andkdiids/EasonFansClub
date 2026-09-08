'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type GrowthView = 'today' | 'new-life'

type GrowthItem = {
  code: string
  title: string
  description: string
  reward: number
  displayReward?: string
  actionHref?: string
  frequency?: 'daily' | 'weekly' | 'once'
  existingReward?: string
  todayReward?: number
  completed?: boolean
  claimed?: boolean
  earned?: number
  progress?: number
  cap?: number
  claimable?: boolean
  capUnit?: 'points' | 'events'
}

type GrowthOverview = {
  today: { dateKey: string; total: number; completed: number; complete: boolean; items: GrowthItem[] }
  passive: { items: GrowthItem[] }
  week: {
    completedDays: number
    totalDays: number
    milestones: Array<{ days: number; reward: number; claimable: boolean; claimed: boolean }>
  }
  newLife: { total: number; completedCount: number; items: GrowthItem[] }
}

function formatCoreReward(item: GrowthItem) {
  if (item.code === 'DAILY_GAME' || item.code === 'DAILY_COMMENT') return '›'
  if (item.completed && (item.todayReward || 0) > 0) return `已完成 · +${item.todayReward}`
  if (item.completed) return `已完成 · ${item.displayReward || ''}`.trim()
  if ((item.todayReward || 0) > 0) return `+${item.todayReward}`
  return item.displayReward || ''
}

function formatActiveAction(item: GrowthItem) {
  const progress = `${item.progress || 0}/${item.cap || 0}`
  if (item.code === 'POST_LIKE_ACTIVE') return item.completed
    ? `${progress}  +${item.earned || item.progress || 0}`
    : `${progress}  +1/次  ›`
  if (item.code === 'CONTENT_SHARE_ACTIVE') return item.completed
    ? `${progress}  +${item.earned || 2}`
    : `${progress}  +2  ›`
  return `${progress}  ›`
}

function formatTodayReward(item: GrowthItem) {
  return item.code === 'POST_LIKE_ACTIVE' || item.code === 'CONTENT_SHARE_ACTIVE'
    ? formatActiveAction(item)
    : formatCoreReward(item)
}

function formatPassiveProgress(item: GrowthItem) {
  const period = item.frequency === 'weekly' ? '本周' : '今日'
  return `${period} ${Math.max(0, item.progress || 0)}/${item.cap || 0}`
}

function GrowthActionRow({
  item,
  right,
  completed = false,
}: {
  item: GrowthItem
  right: string
  completed?: boolean
}) {
  const content = (
    <>
      <span className={`growth-item-mark ${completed ? '' : 'growth-item-mark-muted'}`} aria-hidden="true">{completed ? '✓' : '○'}</span>
      <span className="growth-item-copy"><strong>{item.title}</strong></span>
      <span className="growth-item-reward">{right}</span>
    </>
  )
  const className = `growth-item ${completed ? 'is-done' : ''}`
  return item.actionHref ? <Link href={item.actionHref} className={className}>{content}</Link> : <div className={className}>{content}</div>
}

function GrowthNewLifeRow({
  item,
  busy,
  onClaim,
}: {
  item: GrowthItem
  busy: boolean
  onClaim: () => void
}) {
  const completed = Boolean(item.completed)
  const claimed = Boolean(item.claimed)
  const className = `growth-item ${claimed ? 'is-done' : ''}`
  const mark = <span className="growth-item-mark" aria-hidden="true">{claimed ? '✓' : completed ? '●' : '○'}</span>
  const copy = <div className="growth-item-copy"><strong>{item.title}</strong><small>{item.description}</small></div>
  const destination = <span className="growth-new-life-destination" aria-hidden="true">›</span>
  const status = claimed
    ? <span className="growth-claimed">已领取</span>
    : completed
      ? <button type="button" onClick={(event) => { event.stopPropagation(); onClaim() }} disabled={busy}>{busy ? '领取中…' : `领取 +${item.reward}`}</button>
      : <span className="growth-pending">未完成</span>

  if (item.actionHref && completed && !claimed) {
    return (
      <div className={`${className} growth-new-life-row-shell`}>
        <Link href={item.actionHref} className="growth-new-life-row-link">
          {mark}
          {copy}
          <span className="growth-item-reward">+{item.reward} {destination}</span>
        </Link>
        <span className="growth-item-action">{status}</span>
      </div>
    )
  }

  if (item.actionHref) {
    return (
      <Link href={item.actionHref} className={`${className} growth-new-life-row-link`}>
        {mark}
        {copy}
        <span className="growth-item-action">{claimed ? <>{status} {destination}</> : <>{`+${item.reward}`} {destination}</>}</span>
      </Link>
    )
  }

  return (
    <div className={className}>
      {mark}
      {copy}
      <span className="growth-item-action">{status}</span>
    </div>
  )
}

export function GrowthPanel({
  view,
  onOverviewChange,
}: {
  view: GrowthView
  onOverviewChange?: (overview: GrowthOverview) => void
}) {
  const [overview, setOverview] = useState<GrowthOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')

  const applyOverview = useCallback((next: GrowthOverview) => {
    setOverview(next)
    onOverviewChange?.(next)
  }, [onOverviewChange])

  const requestOverview = useCallback(async (refreshProfile = false) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(refreshProfile ? '/api/growth/refresh' : '/api/growth', {
        method: refreshProfile ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '成长信息暂时无法加载')
      applyOverview(data as GrowthOverview)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '成长信息暂时无法加载')
    } finally {
      setLoading(false)
    }
  }, [applyOverview])

  useEffect(() => {
    void requestOverview(view === 'new-life')
  }, [requestOverview, view])

  const claim = useCallback(async (payload: { taskCode?: string; milestone?: number }, key: string) => {
    setBusyKey(key)
    setError('')
    try {
      const response = await fetch('/api/growth/claim', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '当前还不能领取这份奖励')
      applyOverview(data as GrowthOverview)
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : '当前还不能领取这份奖励')
    } finally {
      setBusyKey('')
    }
  }, [applyOverview])

  if (loading && !overview) return <div className="growth-panel-state">加载中…</div>

  if (!overview) {
    return (
      <div className="growth-panel-state" role="alert">
        <p>{error || '成长信息暂时无法加载'}</p>
        <button type="button" onClick={() => void requestOverview(view === 'new-life')}>重试</button>
      </div>
    )
  }

  const completedToday = overview.today.completed
  const weekPercent = Math.min(100, overview.week.completedDays / Math.max(1, overview.week.totalDays) * 100)

  return (
    <div className={`growth-panel ${view === 'today' ? 'growth-today-panel' : 'growth-new-life-panel'}`}>
      {view === 'today' ? (
        <>
          <section className="growth-today-summary" aria-label="今日与本周进度">
            <div className="growth-summary-line"><span>今日</span><strong>{completedToday} / {overview.today.total}</strong></div>
            <div className="growth-summary-line"><span>本周进度</span><strong>{overview.week.completedDays} / {overview.week.totalDays} 天</strong></div>
            <div className="growth-week-track" role="progressbar" aria-valuemin={0} aria-valuemax={overview.week.totalDays} aria-valuenow={overview.week.completedDays} aria-label={`本周进度 ${overview.week.completedDays} / ${overview.week.totalDays} 天`}>
              <span style={{ width: `${weekPercent}%` }} />
            </div>
          </section>

          <details className="growth-panel-section growth-reward-rules">
            <summary>奖励规则 <span aria-hidden="true">›</span></summary>
            <div className="growth-rule-list">
              {overview.week.milestones.map((milestone) => {
                const content = (
                  <><span>完成 {milestone.days} 天</span><strong>{milestone.claimable ? '✓ ' : ''}+{milestone.reward}{milestone.claimed ? ' · 已领取' : ''}</strong></>
                )
                return milestone.claimable && !milestone.claimed ? (
                  <button type="button" className="growth-rule-row" key={milestone.days} onClick={() => void claim({ milestone: milestone.days }, `milestone-${milestone.days}`)} disabled={busyKey === `milestone-${milestone.days}`}>
                    {content}
                  </button>
                ) : <div className="growth-rule-row" key={milestone.days}>{content}</div>
              })}
            </div>
          </details>

          <section className="growth-panel-section growth-core-list" aria-labelledby="growth-core-title">
            <h3 id="growth-core-title" className="sr-only">今日</h3>
            <div className="growth-item-list">
              {overview.today.items.map((item) => <GrowthActionRow key={item.code} item={item} right={formatTodayReward(item)} completed={Boolean(item.completed)} />)}
            </div>
          </section>

          <details className="growth-panel-section growth-passive-section">
            <summary>被动奖励 <span aria-hidden="true">›</span></summary>
            <div className="growth-item-list">
              {overview.passive.items.map((item) => <GrowthActionRow key={item.code} item={item} right={formatPassiveProgress(item)} />)}
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="growth-panel-intro">
            <div>
              <h2>新生活</h2>
              <p>把真正属于你的第一次，留成一份可领取的纪念。</p>
            </div>
            <div className="growth-new-life-tools">
              <strong className="growth-new-life-count">{overview.newLife.completedCount}/{overview.newLife.total}</strong>
              <button type="button" className="growth-refresh-button" onClick={() => void requestOverview(true)} disabled={loading}>
                {loading ? '刷新中…' : '刷新'}
              </button>
            </div>
          </div>
          <div className="growth-item-list growth-new-life-list">
            {overview.newLife.items.map((item) => <GrowthNewLifeRow key={item.code} item={item} busy={busyKey === item.code} onClaim={() => void claim({ taskCode: item.code }, item.code)} />)}
          </div>
        </>
      )}
      {error ? <p className="growth-panel-error" role="alert">{error}</p> : null}
    </div>
  )
}
