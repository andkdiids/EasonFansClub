'use client'

import { useCallback, useEffect, useState } from 'react'

type GrowthView = 'today' | 'new-life'

type GrowthItem = {
  code: string
  title: string
  description: string
  reward: number
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
  today: { dateKey: string; complete: boolean; items: GrowthItem[] }
  passive: { items: GrowthItem[] }
  week: {
    completedDays: number
    totalDays: number
    milestones: Array<{ days: number; reward: number; claimable: boolean; claimed: boolean }>
  }
  newLife: { total: number; completedCount: number; items: GrowthItem[] }
}

function formatActiveReward(item: GrowthItem) {
  if ((item.todayReward || 0) > 0) return `今日 +${item.todayReward}`
  return item.existingReward || '今日未产生积分'
}

function formatPassiveProgress(item: GrowthItem) {
  const period = item.frequency === 'weekly' ? '本周' : '今日'
  const current = item.progress || 0
  if (item.capUnit === 'events') return `${period} ${current}/${item.cap || 0}`
  return `${period} +${item.earned || 0} · ${current}/${item.cap || 0}`
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

  return (
    <div className="growth-panel">
      {view === 'today' ? (
        <>
          <div className="growth-panel-intro">
            <div>
              <h2>今天只做一件事</h2>
              <p>把今天的四个小动作做完，本周就会留下一个完整的脚印。</p>
            </div>
            <span className={overview.today.complete ? 'growth-status is-done' : 'growth-status'}>
              {overview.today.complete ? '今日完成' : '进行中'}
            </span>
          </div>

          <section className="growth-panel-section" aria-labelledby="growth-week-title">
            <div className="growth-section-heading">
              <div>
                <h3 id="growth-week-title">本周连续感</h3>
                <p>完成当天四项后，才算留下这一天。</p>
              </div>
              <strong>{overview.week.completedDays}/{overview.week.totalDays} 天</strong>
            </div>
            <div className="growth-week-progress-wrap">
              <div className="growth-week-track" tabIndex={0} role="img" aria-label={`本周完成 ${overview.week.completedDays} 天，共 ${overview.week.totalDays} 天`}>
              <span style={{ width: `${Math.min(100, overview.week.completedDays / overview.week.totalDays * 100)}%` }} />
                <div className="growth-week-reward-tooltip" role="tooltip">
                  <strong>本周奖励</strong>
                  <span>完成 3 天 +27</span>
                  <span>完成 5 天 +50</span>
                  <span>完成 7 天 +74</span>
                </div>
              </div>
              <details className="growth-week-reward-details">
                <summary>奖励说明</summary>
                <div><span>完成 3 天</span><strong>+27</strong></div>
                <div><span>完成 5 天</span><strong>+50</strong></div>
                <div><span>完成 7 天</span><strong>+74</strong></div>
              </details>
            </div>
            <div className="growth-milestones">
              {overview.week.milestones.map((milestone) => (
                <div className="growth-milestone" key={milestone.days}>
                  <span>{milestone.days} 天 · +{milestone.reward}</span>
                  {milestone.claimed ? (
                    <em>已领取</em>
                  ) : milestone.claimable ? (
                    <button
                      type="button"
                      onClick={() => void claim({ milestone: milestone.days }, `milestone-${milestone.days}`)}
                      disabled={busyKey === `milestone-${milestone.days}`}
                    >
                      {busyKey === `milestone-${milestone.days}` ? '领取中…' : '领取'}
                    </button>
                  ) : <em>未达成</em>}
                </div>
              ))}
            </div>
          </section>

          <section className="growth-panel-section" aria-labelledby="growth-active-title">
            <div className="growth-section-heading">
              <div>
                <h3 id="growth-active-title">今天的四个动作</h3>
                <p>奖励沿用现有系统，完成状态在这里统一记录。</p>
              </div>
            </div>
            <div className="growth-item-list">
              {overview.today.items.map((item) => (
                <div className={`growth-item ${item.completed ? 'is-done' : ''}`} key={item.code}>
                  <span className="growth-item-mark" aria-hidden="true">{item.completed ? '✓' : '○'}</span>
                  <div className="growth-item-copy">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </div>
                  <span className="growth-item-reward">{formatActiveReward(item)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="growth-panel-section" aria-labelledby="growth-passive-title">
            <div className="growth-section-heading">
              <div>
                <h3 id="growth-passive-title">被喜欢的回声</h3>
                <p>按日或按周封顶，撤销时只回收对应那一笔。</p>
              </div>
            </div>
            <div className="growth-item-list">
              {overview.passive.items.map((item) => (
                <div className="growth-item" key={item.code}>
                  <span className="growth-item-mark growth-item-mark-muted" aria-hidden="true">·</span>
                  <div className="growth-item-copy">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </div>
                  <span className="growth-item-reward">{formatPassiveProgress(item)}</span>
                </div>
              ))}
            </div>
          </section>
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
            {overview.newLife.items.map((item) => (
              <div className={`growth-item ${item.claimed ? 'is-done' : ''}`} key={item.code}>
                <span className="growth-item-mark" aria-hidden="true">{item.claimed ? '✓' : item.completed ? '●' : '○'}</span>
                <div className="growth-item-copy">
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </div>
                <div className="growth-item-action">
                  {item.claimed ? <span className="growth-claimed">已领取</span> : item.completed ? (
                    <button
                      type="button"
                      onClick={() => void claim({ taskCode: item.code }, item.code)}
                      disabled={busyKey === item.code}
                    >
                      {busyKey === item.code ? '领取中…' : `领取 +${item.reward}`}
                    </button>
                  ) : <span className="growth-pending">未完成</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {error ? <p className="growth-panel-error" role="alert">{error}</p> : null}
    </div>
  )
}
