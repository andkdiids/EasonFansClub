'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { formatListenDuelProgress } from '@/lib/growth-tasks/presentation'

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

type GrowthRewardRule = {
  code: string
  title: string
  amount: number | null
  amountLabel: string
  dailyCap?: number
  weeklyCap?: number
  maxDailyAmount?: number
  maxWeeklyAmount?: number
  unit?: '次' | '篇' | '天'
  detail?: string
  milestoneDays?: number
  claimable?: boolean
  claimed?: boolean
}

type GrowthOverview = {
  today: {
    dateKey: string
    total: number
    completed: number
    coreTotal: number
    coreCompleted: number
    bonusTotal: number
    bonusCompleted: number
    listTotal: number
    listCompleted: number
    complete: boolean
    items: GrowthItem[]
  }
  passive: { items: GrowthItem[] }
  week: {
    completedDays: number
    totalDays: number
    milestones: Array<{ days: number; reward: number; claimable: boolean; claimed: boolean }>
  }
  newLife: { total: number; completedCount: number; items: GrowthItem[] }
  rewardRules: Array<{ key: string; title: string; items: GrowthRewardRule[] }>
}

function formatTodayProgress(item: GrowthItem) {
  if (item.cap && item.cap > 0) {
    const progress = `${Math.max(0, item.progress || 0)}/${item.cap}`
    return item.completed ? progress : `${progress}  ›`
  }
  if (item.completed) return '已完成'
  return item.actionHref ? '›' : ''
}

function formatPassiveProgress(item: GrowthItem) {
  const period = item.frequency === 'weekly' ? '本周' : '今日'
  const progress = item.code === 'LISTEN_DUEL_BRANCH'
    ? formatListenDuelProgress(item.progress || 0)
    : `${Math.min(item.cap || 0, Math.max(0, item.progress || 0))}/${item.cap || 0}`
  return `${period} ${progress}`
}

function isPassiveItemComplete(item: GrowthItem) {
  return Boolean(item.completed)
}

function formatRuleCaps(rule: GrowthRewardRule) {
  const unit = rule.unit || '次'
  return [
    rule.dailyCap !== undefined ? `每日最多 ${rule.dailyCap}${unit}${rule.maxDailyAmount !== undefined ? `（最多 +${rule.maxDailyAmount}）` : ''}` : '',
    rule.weeklyCap !== undefined ? `每周最多 ${rule.weeklyCap}${unit}${rule.maxWeeklyAmount !== undefined ? `（最多 +${rule.maxWeeklyAmount}）` : ''}` : '',
  ].filter(Boolean).join(' · ')
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

  useEffect(() => {
    const refreshAfterProfileUpdate = () => {
      void requestOverview(true)
    }
    window.addEventListener('profile-updated', refreshAfterProfileUpdate)
    return () => window.removeEventListener('profile-updated', refreshAfterProfileUpdate)
  }, [requestOverview])

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

  const completedToday = overview.today.coreCompleted
  const totalCoreTasks = overview.today.coreTotal
  const weekPercent = Math.min(100, overview.week.completedDays / Math.max(1, overview.week.totalDays) * 100)

  return (
    <div className={`growth-panel ${view === 'today' ? 'growth-today-panel' : 'growth-new-life-panel'}`}>
      {view === 'today' ? (
        <>
          <section className="growth-today-summary" aria-label="今日与本周进度">
            <div className="growth-summary-line"><span>今日</span><strong>{completedToday} / {totalCoreTasks}</strong></div>
            <div className="growth-summary-line"><span>本周进度</span><strong>{overview.week.completedDays} / {overview.week.totalDays} 天</strong></div>
            <div className="growth-week-track" role="progressbar" aria-valuemin={0} aria-valuemax={overview.week.totalDays} aria-valuenow={overview.week.completedDays} aria-label={`本周进度 ${overview.week.completedDays} / ${overview.week.totalDays} 天`}>
              <span style={{ width: `${weekPercent}%` }} />
            </div>
          </section>

          <details className="growth-panel-section growth-reward-rules">
            <summary>奖励规则 <span aria-hidden="true">›</span></summary>
            <div className="growth-reward-rule-groups">
              {overview.rewardRules.map((group) => (
                <section className="growth-reward-rule-group" key={group.key}>
                  <h3>{group.title}</h3>
                  <div className="growth-rule-list">
                    {group.items.map((rule) => {
                      const caps = formatRuleCaps(rule)
                      const details = [caps, rule.detail].filter(Boolean).join(' · ')
                      const amount = rule.claimed
                        ? `✓ ${rule.amountLabel} · 已领取`
                        : rule.claimable
                          ? `✓ ${rule.amountLabel}`
                          : rule.amountLabel
                      const content = (
                        <>
                          <span className="growth-rule-main"><span>{rule.title}</span><strong>{amount}</strong></span>
                          {details ? <small>{details}</small> : null}
                        </>
                      )
                      const key = rule.milestoneDays === undefined ? rule.code : `milestone-${rule.milestoneDays}`
                      return rule.milestoneDays !== undefined && rule.claimable && !rule.claimed ? (
                        <button type="button" className="growth-rule-row" key={key} onClick={() => void claim({ milestone: rule.milestoneDays }, `milestone-${rule.milestoneDays}`)} disabled={busyKey === `milestone-${rule.milestoneDays}`}>
                          {content}
                        </button>
                      ) : <div className="growth-rule-row" key={key}>{content}</div>
                    })}
                  </div>
                </section>
              ))}
            </div>
          </details>

          <section className="growth-panel-section growth-core-list" aria-labelledby="growth-core-title">
            <h3 id="growth-core-title">今天只做一件事</h3>
            <div className="growth-item-list">
              {overview.today.items.map((item) => <GrowthActionRow key={item.code} item={item} right={formatTodayProgress(item)} completed={Boolean(item.completed)} />)}
            </div>
          </section>

          <details className="growth-panel-section growth-passive-section">
            <summary>之外 <span aria-hidden="true">›</span></summary>
            <div className="growth-item-list">
              {overview.passive.items.map((item) => <GrowthActionRow key={item.code} item={item} right={formatPassiveProgress(item)} completed={isPassiveItemComplete(item)} />)}
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
