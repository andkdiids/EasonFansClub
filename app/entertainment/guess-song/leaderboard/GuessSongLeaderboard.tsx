'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { GameRankingRangeTabs } from '@/components/games/GameRankingRangeTabs'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import { parseGameRankingRangeKey, type GameRankingRangeKey } from '@/lib/game-ranking-range'
import type { EquippedBadgeView } from '@/lib/badge-types'

type Mode = 'EASY' | 'ADVANCED' | 'HARD' | 'EXPERT'
type Row = {
  rank: number
  userId: string
  uid: number
  nickname: string
  avatarUrl: string | null
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: string
  equippedBadge?: EquippedBadgeView | null
}
type Data = {
  periodType: string
  periodKey: string
  rangeKey: GameRankingRangeKey | null
  rangeDate: string | null
  rangeLabel: string | null
  cacheKey: string
  mode: Mode
  algorithm: string
  rows: Row[]
  currentUser: Row | null
}

const modeLabels: Record<Mode, string> = {
  EASY: '简单',
  ADVANCED: '进阶',
  HARD: '困难',
  EXPERT: '专家',
}
const modeOrder: Mode[] = ['EASY', 'ADVANCED', 'HARD', 'EXPERT']
const rangeTitles: Record<Exclude<GameRankingRangeKey, 'date'>, string> = {
  'this-week': '本周听听挑战排名',
  'this-month': '本月听听挑战排名',
  'last-month': '上月听听挑战排名',
}
const rangeNotes: Record<GameRankingRangeKey, string> = {
  'this-week': '按北京时间周一 00:00 开启新榜单',
  'this-month': '按北京时间每月 1 日开启新榜单',
  'last-month': '完整自然月榜单，按北京时间计算',
  date: '按北京时间自然日统计，结束边界不包含次日 00:00',
}
// 排行榜展示字段：最高分 / 答对数 / 最高连击（来自最高分对应的那一局）
const statLabels = ['最高分', '答对数', '最高连击']

function isMode(value: string | null): value is Mode {
  return !!value && (modeOrder as readonly string[]).includes(value)
}

function readUrlState(todayDate: string) {
  const params = new URLSearchParams(window.location.search)
  const range = parseGameRankingRangeKey(params.get('range')) || (params.get('period') === 'MONTH' ? 'this-month' : 'this-week')
  const date = range === 'date' ? params.get('date') || todayDate : null
  const mode = isMode(params.get('mode')) ? params.get('mode') as Mode : 'EASY'
  return { range, date, mode }
}

function pushUrlState(range: GameRankingRangeKey, date: string | null, mode: Mode) {
  const params = new URLSearchParams(window.location.search)
  params.set('range', range)
  params.set('mode', mode)
  if (range === 'date' && date) params.set('date', date)
  else params.delete('date')
  params.delete('period')
  const query = params.toString()
  window.history.pushState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
}

export function GuessSongLeaderboard({
  initialRange,
  initialDate,
  todayDate,
  initialMode,
  initialData,
}: Readonly<{
  initialRange: GameRankingRangeKey
  initialDate: string | null
  todayDate: string
  initialMode: string
  initialData: Data | null
}>) {
  const [range, setRange] = useState<GameRankingRangeKey>(initialRange)
  const [date, setDate] = useState<string | null>(initialRange === 'date' ? initialDate || todayDate : null)
  const [mode, setMode] = useState<Mode>(isMode(initialMode) ? initialMode : 'EASY')
  // 始终保留「上一份数据」：切换筛选时先显示旧榜单，避免空列表 / 骨架闪烁
  const [data, setData] = useState<Data | null>(initialData)
  const [loading, setLoading] = useState<boolean>(!initialData)
  const [error, setError] = useState('')
  // 已加载数据缓存：range:date:mode -> Data；日期也必须进入 key，避免历史日串榜
  const cache = useRef<Map<string, Data>>(new Map())
  if (initialData) cache.current.set(`guess-song:${initialRange}:${initialDate || ''}:${initialMode}`, initialData)

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
    const key = `guess-song:${range}:${selectedDate || ''}:${mode}`
    const cached = cache.current.get(key)
    if (cached) {
      setData(cached)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ range, mode })
    if (range === 'date') params.set('date', selectedDate as string)
    fetch(`/api/entertainment/guess-song/leaderboard?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: Data; error?: string }
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '排行榜加载失败')
        return payload.data
      })
      .then((payload) => {
        if (cancelled) return
        cache.current.set(key, payload)
        setData(payload)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setError(requestError instanceof Error ? requestError.message : '排行榜加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date, mode, range, todayDate])

  function chooseRange(nextRange: GameRankingRangeKey, nextDate: string | null) {
    const selectedDate = nextRange === 'date' ? nextDate || todayDate : null
    setRange(nextRange)
    setDate(selectedDate)
    pushUrlState(nextRange, selectedDate, mode)
  }

  function chooseMode(nextMode: Mode) {
    setMode(nextMode)
    pushUrlState(range, range === 'date' ? date || todayDate : null, nextMode)
  }

  const firstLoad = !data && loading
  const ownRank = data && data.currentUser && data.currentUser.rank > 0 ? data.currentUser : null
  const ownRowBelow = !!ownRank && ownRank.rank > 10
  const ownNone = !!data && !ownRank && data.rows.length > 0
  const headingTitle = range === 'date' ? `${date || todayDate}听听挑战排名` : rangeTitles[range]

  const renderPlayer = (row: Row, key: string, className?: string) => (
    <article key={key} className={className}>
      <strong className="guess-song-rank">{row.rank}</strong>
      <span className="guess-song-rank-avatar"><SafeAvatar src={row.avatarUrl} name={row.nickname} uid={row.uid} /></span>
      <div className="guess-song-rank-user"><strong><UserDisplayName name={row.nickname} uid={row.uid} badge={row.equippedBadge} compact /></strong></div>
      <span className="guess-song-stat">{row.score}</span>
      <span className="guess-song-stat is-desktop-only">{row.correctCount}</span>
      <span className="guess-song-stat is-desktop-only">{row.maxStreak}</span>
    </article>
  )

  const renderHead = () => (
    <div className="guess-song-leaderboard-head" aria-hidden="true">
      <span />
      <span />
      <span />
      <span className="guess-song-stat-head">{statLabels[0]}</span>
      <span className="guess-song-stat-head is-desktop-only">{statLabels[1]}</span>
      <span className="guess-song-stat-head is-desktop-only">{statLabels[2]}</span>
    </div>
  )

  const renderSkeleton = () => (
    <div className="guess-song-leaderboard-skeleton" aria-busy="true">
      {renderHead()}
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="guess-song-leaderboard-skeleton-row" key={index} aria-hidden="true">
          <span className="guess-song-rank-skeleton" />
          <span className="guess-song-avatar-skeleton" />
          <span className="guess-song-user-skeleton" />
          <span className="guess-song-stat-skeleton" />
          <span className="guess-song-stat-skeleton is-desktop-only" />
          <span className="guess-song-stat-skeleton is-desktop-only" />
        </div>
      ))}
    </div>
  )

  return (
    <>
      <header className="guess-song-heading">
        <p>Leaderboard</p>
        <h1>{headingTitle}</h1>
        <span>{rangeNotes[range]}</span>
      </header>
      <div className="guess-song-leaderboard-filters">
        <GameRankingRangeTabs value={range} date={date} todayDate={todayDate} onChange={chooseRange} />
        <div className="guess-song-mode-tabs" role="tablist" aria-label="听听难度">
          {modeOrder.map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => chooseMode(item)}>{modeLabels[item]}</button>)}
        </div>
      </div>
      {error ? <p className="guess-song-error">{error}</p> : null}
      <div className="guess-song-board-wrap">
        {loading ? <div className="guess-song-loading-bar" aria-hidden="true" /> : null}
        {data && data.rows.length > 0 ? (
          <>
            <p className="guess-song-algorithm">{data.algorithm}</p>
            <section className={`guess-song-leaderboard${loading ? ' is-loading' : ''}`}>
              {renderHead()}
              {data.rows.map((row) => renderPlayer(row, row.userId))}
            </section>
            {ownRowBelow ? <div className="guess-song-leaderboard-ellipsis" aria-hidden="true">···</div> : null}
            {ownRowBelow && ownRank ? renderPlayer(ownRank, 'me', 'guess-song-leaderboard-self is-self') : null}
            {ownNone ? <div className="guess-song-leaderboard-none"><span>暂无排名</span></div> : null}
          </>
        ) : firstLoad ? (
          renderSkeleton()
        ) : (
          <p className="guess-song-empty">{range === 'date' ? `${date || todayDate}暂无榜单数据。` : '当前榜单暂无成绩，完成一局后即可参与排名。'}</p>
        )}
      </div>
      <nav className="guess-song-back-links"><Link href="/games/guess-song">返回游戏详情</Link><Link href="/games">返回娱乐天空</Link></nav>
    </>
  )
}
