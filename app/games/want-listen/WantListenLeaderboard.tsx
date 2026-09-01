'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { GameRankingRangeTabs } from '@/components/games/GameRankingRangeTabs'
import { UserDisplayName } from '@/components/UserDisplayName'
import { parseGameRankingRangeKey, type GameRankingRangeKey } from '@/lib/game-ranking-range'
import { WANT_LISTEN_MODE_LABELS, WANT_LISTEN_MODES, type WantListenMode } from '@/lib/want-listen-config'
import type { EquippedBadgeView } from '@/lib/badge-types'

type Row = {
  rank: number
  userId: string
  score: number
  correctCount: number
  maxStreak: number | null
  totalQuestions: number
  completionTimeMs: number
  user: { nickname: string; uid: number; avatarUrl: string | null; equippedBadge?: EquippedBadgeView | null }
}

type Board = {
  rows: Row[]
  self: Row | null
  period: string
  periodKey: string
  rangeKey: GameRankingRangeKey | null
  rangeDate: string | null
  rangeLabel: string | null
  cacheKey: string
}

async function request<T>(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '排行榜加载失败，请稍后重试。')
  return payload.data
}

function isMode(value: string | null): value is WantListenMode {
  return !!value && (WANT_LISTEN_MODES as readonly string[]).includes(value)
}

function readUrlState(todayDate: string) {
  const params = new URLSearchParams(window.location.search)
  // Legacy URL alias kept for compatibility: ['MONTH', '本月'] maps to this-month.
  const range = parseGameRankingRangeKey(params.get('range'))
    || (params.get('period') === 'MONTH' ? 'this-month' : params.get('period') === 'TODAY' || params.get('period') === 'DAY' ? 'date' : 'this-week')
  const date = range === 'date' ? params.get('date') || todayDate : null
  const mode = isMode(params.get('mode')) ? params.get('mode') as WantListenMode : 'WANT_LISTEN'
  return { range, date, mode }
}

function pushUrlState(range: GameRankingRangeKey, date: string | null, mode: WantListenMode) {
  const params = new URLSearchParams(window.location.search)
  params.set('range', range)
  params.set('mode', mode)
  if (range === 'date' && date) params.set('date', date)
  else params.delete('date')
  params.delete('period')
  const query = params.toString()
  window.history.pushState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
}

export function WantListenLeaderboard({
  initialRange,
  initialDate,
  todayDate,
}: Readonly<{
  initialRange: GameRankingRangeKey
  initialDate: string | null
  todayDate: string
}>) {
  const [mode, setMode] = useState<WantListenMode>('WANT_LISTEN')
  const [range, setRange] = useState<GameRankingRangeKey>(initialRange)
  const [date, setDate] = useState<string | null>(initialRange === 'date' ? initialDate || todayDate : null)
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const cache = useRef<Map<string, Board>>(new Map())

  useEffect(() => {
    const handlePopState = () => {
      const next = readUrlState(todayDate)
      setRange(next.range)
      setDate(next.range === 'date' ? next.date : null)
      setMode(next.mode)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [todayDate])

  useEffect(() => {
    const selectedDate = range === 'date' ? date || todayDate : null
    const key = `want-listen:${range}:${selectedDate || ''}:${mode}`
    const cached = cache.current.get(key)
    if (cached) {
      setBoard(cached)
      setLoading(false)
      setError('')
      return
    }
    let active = true
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ mode, range })
    if (range === 'date') params.set('date', selectedDate as string)
    request<Board>(`/api/entertainment/want-listen/leaderboard?${params.toString()}`)
      .then((data) => {
        if (!active) return
        cache.current.set(key, data)
        setBoard(data)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '排行榜加载失败，请稍后重试。')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date, mode, range, todayDate])

  function chooseRange(nextRange: GameRankingRangeKey, nextDate: string | null) {
    const selectedDate = nextRange === 'date' ? nextDate || todayDate : null
    setRange(nextRange)
    setDate(selectedDate)
    pushUrlState(nextRange, selectedDate, mode)
  }

  function chooseMode(nextMode: WantListenMode) {
    setMode(nextMode)
    pushUrlState(range, range === 'date' ? date || todayDate : null, nextMode)
  }

  return (
    <main className="games-page games-full-width">
      <div className="games-page-inner want-listen-page want-listen-board-page">
        <header className="want-listen-heading">
          <Link href="/games/want-listen" className="want-listen-back">← 返回想听</Link>
          <h1>想听榜</h1>
          <p>每个模式独立记录，自己的最佳成绩只占一个位置。</p>
        </header>
        <div className="want-listen-board-filters">
          <div className="want-listen-mode-tabs" role="tablist" aria-label="想听模式">
            {WANT_LISTEN_MODES.map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => chooseMode(item)}>{WANT_LISTEN_MODE_LABELS[item]}</button>)}
          </div>
          <GameRankingRangeTabs value={range} date={date} todayDate={todayDate} onChange={chooseRange} />
        </div>
        {error ? <p className="want-listen-error" role="alert">{error}</p> : null}
        {board?.rangeLabel ? <p className="want-listen-board-range">{board.rangeLabel}</p> : null}
        <section className={`want-listen-board${loading ? ' is-loading' : ''}`} aria-label={`${WANT_LISTEN_MODE_LABELS[mode]}排行榜`}>
          <div className="want-listen-board-head"><span>排名</span><span>用户</span><span>分数</span><span>答对</span><span>连击</span><span>用时</span></div>
          {board?.rows.map((row) => <article key={row.userId}><span>{row.rank}</span><span className="want-listen-board-user">{row.user.avatarUrl ? <img src={row.user.avatarUrl} alt="" loading="lazy" decoding="async" /> : <i>{String(row.user.uid).slice(-1)}</i>}<b><UserDisplayName name={row.user.nickname} uid={row.user.uid} badge={row.user.equippedBadge} compact /></b></span><strong>{row.score}</strong><span>{row.correctCount}</span><span>{row.maxStreak ?? '—'}</span><span>{Math.max(1, Math.round(row.completionTimeMs / 1000))}s</span></article>)}
          {!loading && !board?.rows.length ? <p className="want-listen-board-empty">当前周期还没有完成成绩。</p> : null}
        </section>
        {board?.self ? <p className="want-listen-board-self">我的最佳：{board.self.score} 分 · 答对 {board.self.correctCount} · 最高连击 {board.self.maxStreak ?? '—'} · {Math.max(1, Math.round(board.self.completionTimeMs / 1000))} 秒</p> : null}
      </div>
    </main>
  )
}
