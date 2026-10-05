'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ActivityCard } from '@/components/activities/ActivityCard'
import { activityDisplayStatusLabels, activityTypeLabels, activityTypeValues, sortActivities, type ActivityDisplayStatus, type ActivityView } from '@/lib/activity'

export function ActivitiesListClient({ initialActivities, canCheckIn = false, isAuthenticated = false }: Readonly<{ initialActivities: ActivityView[]; canCheckIn?: boolean; isAuthenticated?: boolean }>) {
  const [status, setStatus] = useState<'ALL' | ActivityDisplayStatus>('ALL')
  const [type, setType] = useState<'ALL' | ActivityView['type']>('ALL')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'activities' | 'mine'>('activities')
  const [myParticipations, setMyParticipations] = useState<Array<{ activity: ActivityView; submissionCount: number; approvedSubmissionCount: number; pendingSubmissionCount: number; rejectedSubmissionCount: number; status: string; countedInActivity: boolean; rewardStatus: string }>>([])
  const [mineLoading, setMineLoading] = useState(false)
  const [mineLoaded, setMineLoaded] = useState(false)
  const [mineError, setMineError] = useState(false)
  const [mineReloadKey, setMineReloadKey] = useState(0)
  useEffect(() => {
    if (!isAuthenticated || mineLoaded || mineLoading || (view !== 'mine' && !initialActivities.some((activity) => activity.type === 'TOPIC_ACTIVITY'))) return
    let active = true
    setMineLoading(true)
    setMineError(false)
    void fetch('/api/activities/me/topic-participations?page=1&pageSize=50', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('LOAD_FAILED')
        return await response.json() as { participations?: typeof myParticipations }
      })
      .then((data) => { if (active) { setMyParticipations(Array.isArray(data.participations) ? data.participations : []); setMineLoaded(true) } })
      .catch(() => { if (active) setMineError(true) })
      .finally(() => { if (active) setMineLoading(false) })
    return () => { active = false }
  }, [initialActivities, isAuthenticated, mineLoaded, mineLoading, mineReloadKey, view])
  const participationByActivity = useMemo(() => new Map(myParticipations.map((item) => [item.activity.id, item])), [myParticipations])
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return sortActivities(initialActivities.filter((activity) => {
      if (status !== 'ALL' && activity.displayStatus !== status) return false
      if (type !== 'ALL' && activity.type !== type) return false
      if (normalizedQuery && !`${activity.title}\n${activity.subtitle || ''}\n${activity.description}\n${activity.locationName || ''}\n${activity.organizer || ''}`.toLowerCase().includes(normalizedQuery)) return false
      return true
    }))
  }, [initialActivities, query, status, type])

  return (
    <section>
      <div role="tablist" aria-label="活动浏览范围" className="mb-4 flex gap-2">
        <button type="button" role="tab" aria-selected={view === 'activities'} onClick={() => setView('activities')} className={`rounded-full px-4 py-2 text-sm font-black ${view === 'activities' ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] text-[var(--foreground-muted)]'}`}>活动列表</button>
        {isAuthenticated ? <button type="button" role="tab" aria-selected={view === 'mine'} onClick={() => setView('mine')} className={`rounded-full px-4 py-2 text-sm font-black ${view === 'mine' ? 'bg-[var(--primary)] text-white' : 'border border-[var(--border)] text-[var(--foreground-muted)]'}`}>我的参与</button> : null}
      </div>
      {view === 'mine' ? <div aria-live="polite">
        {mineLoading ? <p className="py-8 text-center text-sm font-bold text-[var(--foreground-muted)]">正在加载我的参与…</p> : mineError ? <button type="button" onClick={() => { setMineError(false); setMineLoaded(false); setMineReloadKey((key) => key + 1) }} className="w-full py-8 text-center text-sm font-bold text-[var(--danger)]">加载失败，点击重试</button> : myParticipations.length ? <div className="grid gap-3 sm:grid-cols-2">{myParticipations.map((item) => <article key={item.activity.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-start justify-between gap-3"><Link href={`/activities/${item.activity.id}`} className="font-black text-[var(--foreground)]">{item.activity.title}</Link><span className="shrink-0 text-xs font-black text-[var(--primary)]">{item.status === 'APPROVED' ? '已通过' : item.status === 'PENDING' ? '待审核' : item.status === 'REJECTED' ? '未通过' : '未参与'}</span></div><p className="mt-2 text-xs text-[var(--foreground-muted)]">提交 {item.submissionCount} 条 · 通过 {item.approvedSubmissionCount} 条{item.countedInActivity ? ' · 已计入 1 次活动参与' : ''}</p><p className="mt-1 text-xs font-bold text-[var(--foreground-muted)]">奖励：{item.rewardStatus === 'GRANTED' ? '已发放' : item.rewardStatus === 'PENDING' ? '待发放' : item.rewardStatus === 'FAILED' || item.rewardStatus === 'PARTIAL' ? '发放处理中' : item.rewardStatus === 'NOT_ELIGIBLE' ? '无奖励资格' : item.rewardStatus}</p>{item.activity.activityPostId ? <Link href={`/posts/${item.activity.activityPostId}`} className="mt-3 inline-block text-xs font-black text-[var(--primary)]">查看活动讨论 →</Link> : null}</article>)}</div> : <p className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-sm font-bold text-[var(--foreground-muted)]">还没有话题活动参与记录。</p>}
      </div> : <>
      {canCheckIn ? <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/20 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-black text-emerald-900 dark:text-emerald-200">活动核销</p><p className="mt-1 text-xs font-bold text-emerald-800/80 dark:text-emerald-300/80">扫描报名二维码，核验活动签到及物料</p></div><Link href="/activities/checkin" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-emerald-700 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900">扫码核销</Link></div> : null}
      <div className="grid gap-3 rounded-2xl border border-sky-100 bg-white/80 p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_11rem_11rem] dark:border-slate-700 dark:bg-slate-900/80">
          <label className="text-sm font-black text-[var(--foreground)]">搜索活动
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或说明" className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-[var(--foreground)] outline-none focus:border-sky-400 dark:border-slate-600 dark:bg-slate-950" />
        </label>
        <label className="text-sm font-black text-[var(--foreground)]">活动状态
          <select value={status} onChange={(event) => setStatus(event.target.value as 'ALL' | ActivityDisplayStatus)} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-[var(--foreground)] outline-none focus:border-sky-400 dark:border-slate-600 dark:bg-slate-950">
            <option value="ALL">全部状态</option>
            <option value="ONGOING">{activityDisplayStatusLabels.ONGOING}</option>
            <option value="UPCOMING">{activityDisplayStatusLabels.UPCOMING}</option>
            <option value="ENDED">{activityDisplayStatusLabels.ENDED}</option>
            <option value="CANCELLED">{activityDisplayStatusLabels.CANCELLED}</option>
          </select>
        </label>
        <label className="text-sm font-black text-[var(--foreground)]">活动类型
          <select value={type} onChange={(event) => setType(event.target.value as 'ALL' | ActivityView['type'])} className="mt-1 min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3 font-bold text-[var(--foreground)] outline-none focus:border-sky-400 dark:border-slate-600 dark:bg-slate-950">
            <option value="ALL">全部类型</option>
            {activityTypeValues.map((item) => <option key={item} value={item}>{activityTypeLabels[item]}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-sm font-bold text-[var(--foreground-muted)]">
        <span>共 {filtered.length} 个活动</span>
        {query || status !== 'ALL' || type !== 'ALL' ? <button type="button" onClick={() => { setQuery(''); setStatus('ALL'); setType('ALL') }} className="font-black text-[var(--primary)] underline underline-offset-4">清除筛选</button> : null}
      </div>
      {filtered.length ? <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">{filtered.map((activity) => <ActivityCard key={activity.id} activity={activity} participation={participationByActivity.get(activity.id)} />)}</div> : <div className="mt-3 rounded-2xl border border-dashed border-sky-200 bg-white/70 p-10 text-center font-bold text-[var(--foreground-muted)] dark:border-slate-700 dark:bg-slate-900/70">{initialActivities.length ? '没有符合条件的活动。' : <>目前还没有活动。<br /><span className="text-xs font-semibold">新的活动发布后会出现在这里。</span></>}</div>}
      </>}
    </section>
  )
}
