'use client'

import { useMemo, useState } from 'react'
import { ActivityCard } from '@/components/activities/ActivityCard'
import { activityDisplayStatusLabels, activityTypeLabels, activityTypeValues, sortActivities, type ActivityDisplayStatus, type ActivityView } from '@/lib/activity'

export function ActivitiesListClient({ initialActivities }: Readonly<{ initialActivities: ActivityView[] }>) {
  const [status, setStatus] = useState<'ALL' | ActivityDisplayStatus>('ALL')
  const [type, setType] = useState<'ALL' | ActivityView['type']>('ALL')
  const [query, setQuery] = useState('')
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
      {filtered.length ? <div className="mt-3 grid min-w-0 grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">{filtered.map((activity) => <ActivityCard key={activity.id} activity={activity} />)}</div> : <div className="mt-3 rounded-2xl border border-dashed border-sky-200 bg-white/70 p-10 text-center font-bold text-[var(--foreground-muted)] dark:border-slate-700 dark:bg-slate-900/70">{initialActivities.length ? '没有符合条件的活动。' : <>目前还没有活动。<br /><span className="text-xs font-semibold">新的活动发布后会出现在这里。</span></>}</div>}
    </section>
  )
}
