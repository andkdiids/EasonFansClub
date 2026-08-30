'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { SafeAvatar } from '@/components/SafeAvatar'

type RankingPeriod = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom'

type RankingEntry = {
  rank: number
  userId: string
  uid: number
  nickname: string
  avatarUrl: string | null
  displayId: string
  count: number
  period: RankingPeriod
  periodStart: string
  periodEnd: string
}

type RankingRange = {
  start: string
  end: string
  endExclusive: string
  startDate: string
  endDate: string
  label: string
}

type RankingResponse = {
  period: RankingPeriod
  range: RankingRange
  postRanking: RankingEntry[]
  commentRanking: RankingEntry[]
  consultationRanking: RankingEntry[]
}

type SearchParamsLike = { get(name: string): string | null; toString(): string }

type DashboardUrlState = {
  period: RankingPeriod
  startDate: string
  endDate: string
  invalidCustom: boolean
}

const periodLabels: Record<RankingPeriod, string> = {
  this_week: '本周',
  last_week: '上周',
  this_month: '本月',
  last_month: '上月',
  custom: '自定义',
}

const periodOptions: ReadonlyArray<{ value: Exclude<RankingPeriod, 'custom'>; label: string }> = [
  { value: 'this_week', label: '本周' },
  { value: 'last_week', label: '上周' },
  { value: 'this_month', label: '本月' },
  { value: 'last_month', label: '上月' },
]

const rankingCards: ReadonlyArray<{
  key: keyof Pick<RankingResponse, 'postRanking' | 'commentRanking' | 'consultationRanking'>
  title: string
  description: string
  unit: string
}> = [
  { key: 'postRanking', title: 'E院广场发帖榜', description: '统计有效公开帖子作者', unit: '篇' },
  { key: 'commentRanking', title: 'E院广场评论榜', description: '统计有效帖子下的评论与回复', unit: '条' },
  { key: 'consultationRanking', title: '阿士匹灵门诊部会诊榜', description: '统计有效会诊及会诊回复作者', unit: '次' },
]

function normalizePeriod(value: string | null): RankingPeriod {
  if (value === 'week') return 'this_week'
  if (value === 'month') return 'this_month'
  if (value === 'this_week' || value === 'last_week' || value === 'this_month' || value === 'last_month' || value === 'custom') return value
  return 'this_week'
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function readDashboardUrlState(params: SearchParamsLike): DashboardUrlState {
  const requestedPeriod = normalizePeriod(params.get('period'))
  if (requestedPeriod !== 'custom') return { period: requestedPeriod, startDate: '', endDate: '', invalidCustom: false }

  const startDate = params.get('startDate') || params.get('start') || ''
  const endDate = params.get('endDate') || params.get('end') || ''
  if (!isDateKey(startDate) || !isDateKey(endDate) || startDate > endDate) {
    return { period: 'this_week', startDate: '', endDate: '', invalidCustom: true }
  }
  return { period: 'custom', startDate, endDate, invalidCustom: false }
}

function formatDateRange(range: Pick<RankingRange, 'startDate' | 'endDate'>) {
  return `${range.startDate.replaceAll('-', '.')} — ${range.endDate.replaceAll('-', '.')}`
}

function formatDraftDateRange(period: RankingPeriod, startDate: string, endDate: string) {
  if (period !== 'custom' || !isDateKey(startDate) || !isDateKey(endDate)) return null
  return `${startDate.replaceAll('-', '.')} — ${endDate.replaceAll('-', '.')}`
}

function isRankingResponse(value: unknown): value is RankingResponse {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<RankingResponse>
  return (
    (data.period === 'this_week' || data.period === 'last_week' || data.period === 'this_month' || data.period === 'last_month' || data.period === 'custom')
    && typeof data.range?.start === 'string'
    && typeof data.range?.end === 'string'
    && typeof data.range?.endExclusive === 'string'
    && typeof data.range?.startDate === 'string'
    && typeof data.range?.endDate === 'string'
    && typeof data.range?.label === 'string'
    && Array.isArray(data.postRanking)
    && Array.isArray(data.commentRanking)
    && Array.isArray(data.consultationRanking)
  )
}

function RankingSkeleton() {
  return (
    <ol className="space-y-2" aria-label="正在加载排行榜">
      {Array.from({ length: 5 }, (_, index) => (
        <li key={index} className="grid grid-cols-[2rem_2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-xl border border-sky-100 bg-white/70 p-2.5">
          <span className="h-4 w-5 animate-pulse rounded bg-sky-100" />
          <span className="size-10 animate-pulse rounded-full bg-sky-100" />
          <span className="min-w-0 space-y-1.5">
            <span className="block h-4 w-24 max-w-full animate-pulse rounded bg-sky-100" />
            <span className="block h-3 w-16 animate-pulse rounded bg-sky-50" />
          </span>
          <span className="h-8 animate-pulse rounded-lg bg-sky-100" />
        </li>
      ))}
    </ol>
  )
}

function RankingCard({
  title,
  description,
  unit,
  periodLabel,
  entries,
  loading,
}: {
  title: string
  description: string
  unit: string
  periodLabel: string
  entries: RankingEntry[] | null
  loading: boolean
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5" aria-busy={loading}>
      <header className="mb-4 border-b border-sky-100 pb-3">
        <h2 className="text-lg font-black text-brand-950">{periodLabel} · {title}</h2>
        <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{description} · TOP 10</p>
      </header>
      {loading ? <RankingSkeleton /> : entries === null ? <p className="rounded-xl border border-dashed border-sky-200 bg-sky-50/50 px-3 py-8 text-center text-sm font-bold text-slate-500">当前时间范围暂无有效数据</p> : entries.length ? (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.userId} className="grid min-w-0 grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-sky-100 bg-white/80 p-2.5 transition hover:border-sky-300 hover:bg-sky-50/50">
              <span className="text-center text-sm font-black text-brand-700">#{entry.rank}</span>
              <Link href={`/user/${entry.displayId}`} className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950" aria-label={`查看 ${entry.nickname} 的用户主页`}>
                <SafeAvatar src={entry.avatarUrl} name={entry.nickname} uid={entry.uid} className="size-full" textClassName="text-xs" />
              </Link>
              <div className="min-w-0">
                <Link href={`/user/${entry.displayId}`} className="block truncate text-sm font-black text-brand-950 hover:text-brand-700">{entry.nickname}</Link>
                <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-500">UID {entry.displayId}</span>
              </div>
              <div className="flex min-w-[4.5rem] flex-col items-end gap-1">
                <strong className="whitespace-nowrap text-sm font-black text-brand-700">{entry.count.toLocaleString('zh-CN')} {unit}</strong>
                <Link href={`/user/${entry.displayId}`} className="whitespace-nowrap text-[11px] font-black text-sky-700 underline decoration-sky-200 underline-offset-2 hover:text-brand-700">查看用户</Link>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="rounded-xl border border-dashed border-sky-200 bg-sky-50/50 px-3 py-8 text-center text-sm font-bold text-slate-500">当前时间范围暂无有效数据</p>}
    </section>
  )
}

export function DashboardRankings() {
  const router = useRouter()
  const pathname = usePathname() || '/admin/dashboard'
  const searchParams = useSearchParams()
  const urlState = useMemo(() => readDashboardUrlState(searchParams), [searchParams])
  const [period, setPeriod] = useState<RankingPeriod>(urlState.period)
  const [customStartDate, setCustomStartDate] = useState(urlState.startDate)
  const [customEndDate, setCustomEndDate] = useState(urlState.endDate)
  const [data, setData] = useState<RankingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setPeriod(urlState.period)
    if (urlState.period === 'custom') {
      setCustomStartDate(urlState.startDate)
      setCustomEndDate(urlState.endDate)
    }
  }, [urlState.endDate, urlState.period, urlState.startDate])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ period: urlState.period })
    if (urlState.period === 'custom') {
      query.set('startDate', urlState.startDate)
      query.set('endDate', urlState.endDate)
    }

    setLoading(true)
    setData(null)
    setError(urlState.invalidCustom ? '自定义日期无效或不完整，已回退到本周。' : '')

    void fetch(`/api/admin/dashboard/rankings?${query.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as unknown
        if (!response.ok || !isRankingResponse(payload)) {
          const message = payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
            ? payload.message
            : '排行榜数据加载失败，请稍后重试'
          throw new Error(message)
        }
        setData(payload)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        if (reason instanceof Error) setError(reason.message)
        else setError('排行榜数据加载失败，请稍后重试')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [urlState.endDate, urlState.invalidCustom, urlState.period, urlState.startDate])

  function navigateToPreset(nextPeriod: Exclude<RankingPeriod, 'custom'>) {
    setPeriod(nextPeriod)
    setData(null)
    setLoading(true)
    setError('')
    const query = new URLSearchParams(searchParams.toString())
    query.set('period', nextPeriod)
    query.delete('startDate')
    query.delete('endDate')
    query.delete('start')
    query.delete('end')
    router.push(`${pathname}?${query.toString()}`, { scroll: false })
  }

  function openCustomRange() {
    setPeriod('custom')
    setData(null)
    setLoading(false)
    setError('')
  }

  function submitCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isDateKey(customStartDate) || !isDateKey(customEndDate)) {
      setError('请选择开始日期和结束日期')
      return
    }
    if (customStartDate > customEndDate) {
      setError('开始日期不能晚于结束日期')
      return
    }

    setData(null)
    setLoading(true)
    setError('')
    const query = new URLSearchParams(searchParams.toString())
    query.set('period', 'custom')
    query.set('startDate', customStartDate)
    query.set('endDate', customEndDate)
    query.delete('start')
    query.delete('end')
    router.push(`${pathname}?${query.toString()}`, { scroll: false })
  }

  const activePeriodLabel = data?.range.label || periodLabels[period]
  const activeDateRange = data ? formatDateRange(data.range) : formatDraftDateRange(period, customStartDate, customEndDate)
  return (
    <section className="space-y-5" aria-label="运营排行榜">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black tracking-[0.16em] text-brand-700">运营数据</p>
          <h1 className="mt-1 text-2xl font-black text-brand-950 sm:text-3xl">数据面板</h1>
          <p className="mt-2 text-xs font-bold text-slate-500">{activePeriodLabel}{activeDateRange ? `：${activeDateRange}` : ''} · 北京时间（Asia/Shanghai）</p>
        </div>
        <div className="flex w-full flex-wrap gap-1 rounded-xl border border-sky-200 bg-sky-50/70 p-1 sm:w-auto" role="group" aria-label="排行榜时间范围">
          {periodOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => navigateToPreset(option.value)}
              aria-pressed={period === option.value}
              className={`min-h-10 min-w-[5rem] flex-1 rounded-lg px-3 text-sm font-black transition sm:flex-none sm:px-4 ${period === option.value ? 'bg-brand-700 text-white shadow-sm' : 'text-brand-700 hover:bg-white'}`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={openCustomRange}
            aria-pressed={period === 'custom'}
            className={`min-h-10 min-w-[5rem] flex-1 rounded-lg px-3 text-sm font-black transition sm:flex-none sm:px-4 ${period === 'custom' ? 'bg-brand-700 text-white shadow-sm' : 'text-brand-700 hover:bg-white'}`}
          >
            自定义
          </button>
        </div>
        {period === 'custom' ? <form className="grid w-full grid-cols-1 items-end gap-3 border-t border-sky-100 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={submitCustomRange}>
          <label className="grid gap-1 text-xs font-black text-slate-600">开始日期<input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} className="min-h-10 min-w-0 rounded-lg border border-sky-200 bg-white px-3 text-sm font-bold text-brand-950 outline-none focus:border-sky-500" /></label>
          <label className="grid gap-1 text-xs font-black text-slate-600">结束日期<input type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} className="min-h-10 min-w-0 rounded-lg border border-sky-200 bg-white px-3 text-sm font-bold text-brand-950 outline-none focus:border-sky-500" /></label>
          <button type="submit" className="min-h-10 rounded-lg bg-brand-700 px-5 text-sm font-black text-white transition hover:bg-brand-800">查询</button>
        </form> : null}
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700" role="alert">{error}</div> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        {rankingCards.map((card) => (
          <RankingCard
            key={card.key}
            title={card.title}
            description={card.description}
            unit={card.unit}
            periodLabel={activePeriodLabel}
            entries={data?.[card.key] || null}
            loading={loading}
          />
        ))}
      </div>
    </section>
  )
}
