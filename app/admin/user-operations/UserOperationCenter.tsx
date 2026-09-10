'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import type { UserOperationAngelGiftSummary } from '@/lib/user-operation-center'

type Category = 'ALL' | 'ACCOUNT' | 'CHECKIN' | 'CONTENT' | 'SOCIAL' | 'GAME' | 'ANGEL_GIFT' | 'REWARD' | 'BADGE' | 'ACTIVITY' | 'RISK' | 'ADMIN'
type View = 'today' | 'risk'
type User = {
  id: string
  uid: number
  nickname: string
  username: string
  email: string | null
  phone: string | null
  avatarUrl: string | null
  status: string
  role: string
  createdAt: string
  lastActiveAt: string | null
}
type Event = {
  id: string
  userId: string
  category: Exclude<Category, 'ALL'>
  action: string
  summary: string
  source: string
  occurredAt: string
  detail: Record<string, string | number | boolean | null>
  operator: { type: string; userId: string | null; uid: number | null; nickname: string | null } | null
  target: { type: string; id: string; title: string | null } | null
  riskLevel: string | null
  audit?: { themeId: string; drawId?: string; combineId?: string }
  user?: User
}
type RiskUser = { user: User; riskLevel: string; reasons: string[]; latestRiskAt: string; eventCount: number }
type Pagination = { page: number; pageSize: number; total: number; totalPages: number; hasMore: boolean }
type AngelGiftSummary = UserOperationAngelGiftSummary

const categoryLabels: Record<Category, string> = {
  ALL: '全部', ACCOUNT: '账号 / 资料', CHECKIN: '挂号 / 补签', CONTENT: '内容', SOCIAL: '好友 / 社交', GAME: '娱乐天空', ANGEL_GIFT: '天使的礼物', REWARD: '奖励 / 积分', BADGE: '勋章', ACTIVITY: '活动', RISK: '风险', ADMIN: '管理员操作',
}
const categoryOptions = Object.keys(categoryLabels) as Category[]
const emptyPagination: Pagination = { page: 1, pageSize: 30, total: 0, totalPages: 1, hasMore: false }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatValue(value: string | number | boolean | null) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function statusLabel(value: string) {
  const labels: Record<string, string> = { ACTIVE: '正常', BANNED: '已封禁', DISABLED: '已停用', DELETED: '已删除', MERGED: '已合并' }
  return labels[value] || value
}

function Avatar({ user }: { user: User }) {
  return <SafeAvatar src={user.avatarUrl} name={user.nickname} uid={user.uid} className="size-11 shrink-0 rounded-full" textClassName="text-sm" variant="avatar-sm" />
}

function UserIdentity({ user, compact = false }: { user: User; compact?: boolean }) {
  return <div className="flex min-w-0 items-center gap-3"><Avatar user={user} /><div className="min-w-0"><p className="truncate font-black text-brand-950 dark:text-slate-100">{user.nickname}</p><p className="truncate text-xs font-bold text-slate-500 dark:text-slate-400">UID {user.uid} · @{user.username}{compact ? '' : ` · ${statusLabel(user.status)}`}</p></div></div>
}

export function UserOperationCenter() {
  const [view, setView] = useState<View>('today')
  const [category, setCategory] = useState<Category>('ALL')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [page, setPage] = useState(1)
  const [events, setEvents] = useState<Event[]>([])
  const [riskUsers, setRiskUsers] = useState<RiskUser[]>([])
  const [pagination, setPagination] = useState<Pagination>(emptyPagination)
  const [dateKey, setDateKey] = useState('')
  const [themeId, setThemeId] = useState('')
  const [angelGiftSummary, setAngelGiftSummary] = useState<AngelGiftSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<{ user: User; events: Event[]; pagination: Pagination; days: number; angelGift?: AngelGiftSummary | null } | null>(null)
  const [timelineCategory, setTimelineCategory] = useState<Category>('ALL')
  const [timelineThemeId, setTimelineThemeId] = useState('')
  const [timelineDays, setTimelineDays] = useState('30')
  const [timelinePage, setTimelinePage] = useState(1)

  const listUrl = useMemo(() => {
    const params = new URLSearchParams({ view, page: String(page), pageSize: '30' })
    if (appliedQuery) params.set('q', appliedQuery)
    if (view === 'today' && category !== 'ALL') params.set('category', category)
    if (view === 'today' && category === 'ANGEL_GIFT' && themeId) params.set('themeId', themeId)
    if (view === 'risk') params.set('days', '90')
    return `/api/admin/user-operations?${params.toString()}`
  }, [appliedQuery, category, page, themeId, view])

  useEffect(() => {
    if (selectedUserId) return
    let active = true
    setLoading(true)
    setError('')
    fetch(listUrl, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.message || '用户操作记录加载失败')
        if (!active) return
        setPagination(body?.pagination || emptyPagination)
        if (view === 'risk') {
          setRiskUsers(Array.isArray(body?.users) ? body.users as RiskUser[] : [])
          setAngelGiftSummary(null)
        }
        else {
          setEvents(Array.isArray(body?.events) ? body.events as Event[] : [])
          setDateKey(typeof body?.dateKey === 'string' ? body.dateKey : '')
          setAngelGiftSummary(category === 'ANGEL_GIFT' && body?.angelGift ? body.angelGift as AngelGiftSummary : null)
        }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '用户操作记录加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [category, listUrl, selectedUserId, view])

  useEffect(() => {
    if (!selectedUserId) return
    let active = true
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ view: 'timeline', userId: selectedUserId, page: String(timelinePage), pageSize: '30', days: timelineDays })
    if (timelineCategory !== 'ALL') params.set('category', timelineCategory)
    if (timelineCategory === 'ANGEL_GIFT' && timelineThemeId) params.set('themeId', timelineThemeId)
    fetch(`/api/admin/user-operations?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.message || '用户时间线加载失败')
        if (active) setTimeline(body)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '用户时间线加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedUserId, timelineCategory, timelineDays, timelinePage, timelineThemeId])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedQuery(query.trim())
    setSearchResults([])
    setPage(1)
  }

  async function searchUsers() {
    if (!query.trim()) return
    setSearching(true)
    try {
      const response = await fetch(`/api/admin/user-operations?view=users&q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '用户搜索失败')
      setSearchResults(Array.isArray(body?.users) ? body.users as User[] : [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '用户搜索失败')
    } finally {
      setSearching(false)
    }
  }

  function openUser(userId: string) {
    setSelectedUserId(userId)
    setTimelinePage(1)
    setTimelineThemeId('')
    setSearchResults([])
  }

  function changeView(nextView: View) {
    setView(nextView)
    setPage(1)
    setAppliedQuery('')
    setThemeId('')
    setAngelGiftSummary(null)
    setSearchResults([])
  }

  function changeCategory(nextCategory: Category) {
    setCategory(nextCategory)
    setPage(1)
    if (nextCategory !== 'ANGEL_GIFT') setThemeId('')
  }

  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-7">
      <p className="text-xs font-black tracking-[0.18em] text-sky-700 dark:text-sky-300">用户审计 / 风控</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-black text-brand-950 dark:text-slate-100">用户操作记录</h1><p className="mt-2 text-sm font-bold leading-6 text-slate-500 dark:text-slate-400">聚合已有业务记录，并记录无法从当前资料还原的昵称、生日变化。只展示有管理价值的事件。</p></div>{dateKey && view === 'today' ? <span className="text-sm font-black text-slate-500 dark:text-slate-400">上海时间 {dateKey}</span> : null}</div>
      <form onSubmit={submitSearch} className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索昵称、UID、手机号或邮箱" className="min-h-11 min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-sky-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        <button type="button" onClick={() => void searchUsers()} disabled={searching || !query.trim()} className="min-h-11 rounded-xl border border-sky-200 px-4 text-sm font-black text-brand-700 disabled:opacity-50 dark:border-slate-600 dark:text-sky-200">搜索用户</button>
        <button type="submit" className="min-h-11 rounded-xl bg-brand-950 px-5 text-sm font-black text-white">筛选记录</button>
      </form>
      {searchResults.length ? <div className="mt-3 grid gap-2 rounded-2xl border border-sky-100 bg-sky-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/60 sm:grid-cols-2">{searchResults.map((user) => <button type="button" key={user.id} onClick={() => openUser(user.id)} className="rounded-xl border border-sky-100 bg-white p-3 text-left hover:border-sky-300 dark:border-slate-600 dark:bg-slate-900"><UserIdentity user={user} /></button>)}</div> : null}
    </section>

    <div className="flex flex-wrap gap-2 rounded-2xl border border-sky-100 bg-white/80 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/80" role="tablist" aria-label="用户操作记录分区">
      <button type="button" role="tab" aria-selected={view === 'today'} onClick={() => changeView('today')} className={`min-h-11 rounded-xl px-4 text-sm font-black ${view === 'today' ? 'bg-brand-950 text-white' : 'text-slate-600 hover:bg-sky-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>今日操作记录</button>
      <button type="button" role="tab" aria-selected={view === 'risk'} onClick={() => changeView('risk')} className={`min-h-11 rounded-xl px-4 text-sm font-black ${view === 'risk' ? 'bg-brand-950 text-white' : 'text-slate-600 hover:bg-sky-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>高风险用户</button>
      {selectedUserId ? <button type="button" onClick={() => { setSelectedUserId(null); setTimeline(null); setPage(1) }} className="ml-auto min-h-11 rounded-xl border border-sky-200 px-4 text-sm font-black text-brand-700 dark:border-slate-600 dark:text-sky-200">返回列表</button> : null}
    </div>

    {error ? <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p> : null}
    {selectedUserId ? <TimelinePanel timeline={timeline} loading={loading} category={timelineCategory} setCategory={(next) => { setTimelineCategory(next); setTimelineThemeId(''); setTimelinePage(1) }} themeId={timelineThemeId} setThemeId={(next) => { setTimelineThemeId(next); setTimelinePage(1) }} days={timelineDays} setDays={(next) => { setTimelineDays(next); setTimelinePage(1) }} onPage={(next) => setTimelinePage(next)} onBack={() => { setSelectedUserId(null); setTimeline(null) }} /> : (
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-7">
        {view === 'today' ? <><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-black text-brand-950 dark:text-slate-100">今日操作记录 <span className="text-base text-slate-500 dark:text-slate-400">{pagination.total}</span></h2><p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">资料、补签、内容、社交、天使的礼物、奖励、勋章、活动和风险事件。</p></div><div className="flex flex-wrap gap-2"><select value={category} onChange={(event) => changeCategory(event.target.value as Category)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3 text-sm font-black dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">{categoryOptions.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select>{category === 'ANGEL_GIFT' ? <AngelGiftThemeSelect summary={angelGiftSummary} value={themeId} onChange={(next) => { setThemeId(next); setPage(1) }} /> : null}</div></div>{category === 'ANGEL_GIFT' && angelGiftSummary ? <AngelGiftSummaryPanel summary={angelGiftSummary} /> : null}<EventList events={events} loading={loading} onUser={openUser} /></> : <><div><h2 className="text-2xl font-black text-brand-950 dark:text-slate-100">高风险用户 <span className="text-base text-slate-500 dark:text-slate-400">{pagination.total}</span></h2><p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">风险等级沿用现有风控信号；点击用户进入同一条完整时间线。</p></div><RiskList users={riskUsers} loading={loading} onUser={openUser} /></>}
        <PaginationBar pagination={pagination} loading={loading} onPage={setPage} />
      </section>
    )}
  </main>
}

function EventList({ events, loading, onUser }: { events: Event[]; loading: boolean; onUser: (id: string) => void }) {
  if (loading) return <p className="py-12 text-center text-sm font-bold text-slate-500">加载中…</p>
  if (!events.length) return <p className="py-12 text-center text-sm font-bold text-slate-500">今天暂无符合条件的用户操作记录。</p>
  return <div className="mt-5 divide-y divide-sky-100 dark:divide-slate-700">{events.map((item) => <article key={item.id} className="grid gap-3 py-4 md:grid-cols-[150px_minmax(220px,0.8fr)_minmax(0,1.5fr)_auto] md:items-start"><time className="text-xs font-black text-slate-500 dark:text-slate-400">{formatDate(item.occurredAt)}</time><div><button type="button" onClick={() => onUser(item.userId)} className="text-left"><UserIdentity user={item.user!} compact /></button><p className="mt-1 text-xs font-bold text-slate-400">{categoryLabels[item.category]} · {item.source}</p></div><div className="min-w-0"><p className="font-black text-brand-950 dark:text-slate-100">{item.summary}</p><dl className="mt-1 grid gap-x-3 gap-y-1 text-xs font-bold text-slate-500 dark:text-slate-400 sm:grid-cols-2">{Object.entries(item.detail).filter(([, value]) => value != null && value !== '').slice(0, item.category === 'ANGEL_GIFT' ? 10 : 6).map(([key, value]) => <div key={key} className="min-w-0"><dt className="inline text-slate-400">{key}：</dt><dd className="inline break-words">{formatValue(value)}</dd></div>)}</dl></div><span className={`justify-self-start rounded-full px-2.5 py-1 text-xs font-black ${item.riskLevel === 'HIGH' ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200' : item.riskLevel === 'MEDIUM' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-sky-50 text-sky-700 dark:bg-slate-800 dark:text-sky-200'}`}>{item.riskLevel || (item.operator?.type === 'ADMIN' ? '管理员操作' : item.operator?.type === 'USER' ? '用户操作' : '系统自动')}</span></article>)}</div>
}

function RiskList({ users, loading, onUser }: { users: RiskUser[]; loading: boolean; onUser: (id: string) => void }) {
  if (loading) return <p className="mt-5 py-12 text-center text-sm font-bold text-slate-500">加载中…</p>
  if (!users.length) return <p className="mt-5 py-12 text-center text-sm font-bold text-slate-500">近 90 天暂无风险用户。</p>
  return <div className="mt-5 grid gap-3 md:grid-cols-2">{users.map((item) => <button type="button" key={item.user.id} onClick={() => onUser(item.user.id)} className="rounded-2xl border border-sky-100 p-4 text-left hover:border-sky-300 dark:border-slate-700 dark:hover:border-sky-600"><div className="flex items-start justify-between gap-3"><UserIdentity user={item.user} /><span className={`rounded-full px-2.5 py-1 text-xs font-black ${item.riskLevel === 'HIGH' ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200'}`}>{item.riskLevel === 'HIGH' ? '高风险' : '中风险'}</span></div><p className="mt-3 text-sm font-black text-slate-700 dark:text-slate-200">原因：{item.reasons.join('、') || '已有风控事件'}</p><p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">最近 {formatDate(item.latestRiskAt)} · 事件 {item.eventCount} 条 · {statusLabel(item.user.status)}</p></button>)}</div>
}

function AngelGiftThemeSelect({ summary, value, onChange }: { summary: AngelGiftSummary | null; value: string; onChange: (value: string) => void }) {
  return <label className="flex min-h-10 items-center gap-2 text-sm font-black text-brand-950 dark:text-slate-100"><span className="text-xs text-slate-500 dark:text-slate-400">主题奖池</span><select aria-label="主题奖池" value={value} onChange={(event) => onChange(event.target.value)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3 text-sm font-black dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="">全部主题</option>{summary?.themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.title}（{theme.drawCount} 次）</option>)}</select></label>
}

function AngelGiftSummaryPanel({ summary }: { summary: AngelGiftSummary }) {
  return <section className="mt-5 border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-black text-brand-950 dark:text-slate-100">天使的礼物</h3>{summary.selectedThemeId ? <span className="text-xs font-bold text-slate-500 dark:text-slate-400">已筛选主题</span> : null}</div><div className="mt-3 grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200 sm:grid-cols-3"><span>总抽奖次数：{summary.totalDrawCount.toLocaleString('zh-CN')} 次</span><span>参与主题：{summary.themeCount} 个</span><span>累计消耗：{summary.totalCost.toLocaleString('zh-CN')} 挂号费</span></div>{summary.firstDrawAt || summary.lastDrawAt ? <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">首次抽取：{summary.firstDrawAt ? formatDate(summary.firstDrawAt) : '—'} · 最近抽取：{summary.lastDrawAt ? formatDate(summary.lastDrawAt) : '—'}</p> : null}{summary.combineCount ? <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">重复勋章合成：{summary.combineCount} 次（不计入抽奖次数）</p> : null}</section>
}

function TimelinePanel({ timeline, loading, category, setCategory, themeId, setThemeId, days, setDays, onPage, onBack }: { timeline: { user: User; events: Event[]; pagination: Pagination; days: number; angelGift?: AngelGiftSummary | null } | null; loading: boolean; category: Category; setCategory: (value: Category) => void; themeId: string; setThemeId: (value: string) => void; days: string; setDays: (value: string) => void; onPage: (page: number) => void; onBack: () => void }) {
  if (!timeline) return <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 text-center font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900/90">{loading ? '加载用户时间线…' : '暂无用户资料'}</section>
  return <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><UserIdentity user={timeline.user} /><p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">注册于 {formatDate(timeline.user.createdAt)} · 最后活跃 {timeline.user.lastActiveAt ? formatDate(timeline.user.lastActiveAt) : '暂无记录'}</p><p className="mt-1 break-all text-xs font-bold text-slate-500 dark:text-slate-400">手机号：{timeline.user.phone || '未绑定'} · 邮箱：{timeline.user.email || '未绑定'}</p></div><button type="button" onClick={onBack} className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-black text-brand-700 dark:border-slate-600 dark:text-sky-200">返回列表</button></div><div className="mt-5 flex flex-wrap gap-2"><select value={category} onChange={(event) => setCategory(event.target.value as Category)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3 text-sm font-black dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">{categoryOptions.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}</select>{category === 'ANGEL_GIFT' ? <AngelGiftThemeSelect summary={timeline.angelGift || null} value={themeId} onChange={setThemeId} /> : null}<select value={days} onChange={(event) => setDays(event.target.value)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3 text-sm font-black dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="1">今天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="365">近一年</option></select><span className="self-center text-xs font-bold text-slate-500 dark:text-slate-400">敏感资料仅向有用户管理权限的管理员展示。</span></div>{category === 'ANGEL_GIFT' && timeline.angelGift ? <AngelGiftSummaryPanel summary={timeline.angelGift} /> : null}<EventList events={timeline.events} loading={loading} onUser={() => undefined} /><PaginationBar pagination={timeline.pagination} loading={loading} onPage={onPage} /></section>
}

function PaginationBar({ pagination, loading, onPage }: { pagination: Pagination; loading: boolean; onPage: (page: number) => void }) {
  return <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-sky-100 pt-4 text-sm font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400"><span>共 {pagination.total} 条 · 第 {pagination.page} / {pagination.totalPages} 页</span><div className="flex gap-2"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => onPage(pagination.page - 1)} className="rounded-xl border border-sky-200 px-4 py-2 font-black text-brand-700 disabled:opacity-40 dark:border-slate-600 dark:text-sky-200">上一页</button><button type="button" disabled={!pagination.hasMore || loading} onClick={() => onPage(pagination.page + 1)} className="rounded-xl border border-sky-200 px-4 py-2 font-black text-brand-700 disabled:opacity-40 dark:border-slate-600 dark:text-sky-200">下一页</button></div></footer>
}
