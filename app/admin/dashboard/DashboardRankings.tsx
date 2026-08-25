'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { SafeAvatar } from '@/components/SafeAvatar'

type RankingPeriod = 'week' | 'month'

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

type RankingResponse = {
  period: RankingPeriod
  range: { start: string; end: string }
  postRanking: RankingEntry[]
  commentRanking: RankingEntry[]
  consultationRanking: RankingEntry[]
}

const periodLabels: Record<RankingPeriod, string> = {
  week: '本周',
  month: '本月',
}

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

function formatRange(value: string) {
  const date = new Date(value)
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function isRankingResponse(value: unknown): value is RankingResponse {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<RankingResponse>
  return (
    (data.period === 'week' || data.period === 'month')
    && typeof data.range?.start === 'string'
    && typeof data.range?.end === 'string'
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
  entries,
  loading,
}: {
  title: string
  description: string
  unit: string
  entries: RankingEntry[] | null
  loading: boolean
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5" aria-busy={loading}>
      <header className="mb-4 border-b border-sky-100 pb-3">
        <h2 className="text-lg font-black text-brand-950">{title}</h2>
        <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{description} · TOP 10</p>
      </header>
      {entries === null ? <RankingSkeleton /> : entries.length ? (
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
      ) : <p className="rounded-xl border border-dashed border-sky-200 bg-sky-50/50 px-3 py-8 text-center text-sm font-bold text-slate-500">本周期暂无有效数据</p>}
    </section>
  )
}

export function DashboardRankings() {
  const [period, setPeriod] = useState<RankingPeriod>('week')
  const [data, setData] = useState<RankingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')

    void fetch(`/api/admin/dashboard/rankings?period=${period}`, { cache: 'no-store', signal: controller.signal })
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
  }, [period])

  const range = data?.range
  return (
    <section className="space-y-5" aria-label="运营排行榜">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-5">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand-700">运营数据</p>
          <h1 className="mt-1 text-2xl font-black text-brand-950 sm:text-3xl">数据面板</h1>
          {range ? <p className="mt-2 text-xs font-bold text-slate-500">{periodLabels[period]}：{formatRange(range.start)} ～ {formatRange(range.end)} · 北京时间</p> : <p className="mt-2 text-xs font-bold text-slate-500">按北京时间统计有效内容，切换周期后自动更新。</p>}
        </div>
        <div className="flex rounded-xl border border-sky-200 bg-sky-50/70 p-1" role="group" aria-label="排行榜时间范围">
          {(['week', 'month'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              aria-pressed={period === value}
              className={`min-h-10 rounded-lg px-4 text-sm font-black transition ${period === value ? 'bg-brand-700 text-white shadow-sm' : 'text-brand-700 hover:bg-white'}`}
            >
              {periodLabels[value]}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700" role="alert">{error}</div> : null}

      <div className={`grid min-w-0 gap-4 lg:grid-cols-3 ${loading && data ? 'opacity-70' : ''}`}>
        {rankingCards.map((card) => (
          <RankingCard
            key={card.key}
            title={card.title}
            description={card.description}
            unit={card.unit}
            entries={data?.[card.key] || null}
            loading={loading}
          />
        ))}
      </div>
    </section>
  )
}
