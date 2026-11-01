'use client'

import { useEffect, useMemo, useState } from 'react'
import { GameRankingRangeTabs } from '@/components/games/GameRankingRangeTabs'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'
import {
  ENTERTAINMENT_LEADERBOARDS,
  getEntertainmentLeaderboardDefinition,
  type EntertainmentLeaderboardGameKey,
} from '@/lib/entertainment-leaderboard-registry'
import {
  parseGameRankingRangeKey,
  readGameRankingRangeDates,
  writeGameRankingRangeDates,
  type GameRankingRangeKey,
} from '@/lib/game-ranking-range'

type Row = {
  rank: number
  user: {
    id: string
    uid: number
    nickname: string
    displayName: string
    avatarUrl: string | null
    equippedBadges?: EquippedBadgeView[]
    equippedBadge?: EquippedBadgeView | null
  }
  primaryValue: number
  primaryLabel: string
  secondary: Array<{ value: number | string; label: string }>
  achievedAt: string
}

type Board = {
  status: 'ready' | 'empty' | 'unavailable'
  gameKey: string
  gameName: string
  mode: string | null
  period: string | null
  periodLabel: string | null
  periodKey: string | null
  rangeKey: GameRankingRangeKey | null
  rangeDate: string | null
  rangeLabel: string | null
  cacheKey: string | null
  rows: Row[]
  unavailableReason?: string
}

function pushUrlState(gameKey: EntertainmentLeaderboardGameKey, mode: string | null, range: GameRankingRangeKey | null, startDate: string | null, endDate: string | null) {
  const params = new URLSearchParams(window.location.search)
  params.set('game', gameKey)
  if (mode) params.set('mode', mode)
  else params.delete('mode')
  if (range) params.set('range', range)
  else params.delete('range')
  writeGameRankingRangeDates(params, range, startDate, endDate)
  params.delete('period')
  const query = params.toString()
  window.history.pushState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
}

export function EntertainmentLeaderboardCenter({ todayDate }: Readonly<{ todayDate: string }>) {
  const defaultGame = ENTERTAINMENT_LEADERBOARDS[0]
  const defaultRange = defaultGame.ranges[0]?.key || 'this-week'
  const [gameKey, setGameKey] = useState<EntertainmentLeaderboardGameKey>(defaultGame.gameKey)
  const [mode, setMode] = useState<string | null>(defaultGame.defaultMode)
  const [range, setRange] = useState<GameRankingRangeKey>(defaultRange)
  const [startDate, setStartDate] = useState<string | null>(null)
  const [endDate, setEndDate] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const selectedGame = useMemo(() => getEntertainmentLeaderboardDefinition(gameKey) || defaultGame, [defaultGame, gameKey])

  useEffect(() => {
    const readUrlState = () => {
      const params = new URLSearchParams(window.location.search)
      const requestedGame = getEntertainmentLeaderboardDefinition(params.get('game'))
      const nextGame = requestedGame || defaultGame
      const requestedRange = parseGameRankingRangeKey(params.get('range'))
      const nextRange = requestedRange && nextGame.ranges.some((item) => item.key === requestedRange)
        ? requestedRange
        : nextGame.ranges[0]?.key || 'this-week'
      setGameKey(nextGame.gameKey)
      setMode(nextGame.modes?.some((item) => item.key === params.get('mode')) ? params.get('mode') : nextGame.defaultMode)
      setRange(nextRange)
      if (nextRange === 'date') {
        const dates = readGameRankingRangeDates(params, todayDate)
        setStartDate(dates.startDate)
        setEndDate(dates.endDate)
      } else {
        setStartDate(null)
        setEndDate(null)
      }
    }
    readUrlState()
    window.addEventListener('popstate', readUrlState)
    return () => window.removeEventListener('popstate', readUrlState)
  }, [defaultGame, todayDate])

  useEffect(() => {
    let cancelled = false
    setError('')
    setBoard(null)

    setLoading(true)
    const params = new URLSearchParams({ game: gameKey })
    if (mode) params.set('mode', mode)
    if (selectedGame.ranges.some((item) => item.key === range)) {
      params.set('range', range)
      if (range === 'date') {
        const selectedStart = startDate || ''
        const selectedEnd = endDate || ''
        if (selectedStart) params.set('startDate', selectedStart)
        if (selectedEnd) params.set('endDate', selectedEnd)
        if (selectedStart && selectedStart === selectedEnd) params.set('date', selectedStart)
      }
    }
    const controller = new AbortController()
    fetch(`/api/entertainment/leaderboard?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { ok?: boolean; data?: Board; error?: string } | null
        if (!response.ok || !payload?.ok || !payload.data) throw new Error(payload?.error || '排行榜加载失败，请稍后重试。')
        return payload.data
      })
      .then((nextBoard) => {
        if (cancelled) return
        setBoard(nextBoard)
      })
      .catch((reason: unknown) => {
        if (cancelled || (reason instanceof DOMException && reason.name === 'AbortError')) return
        setError(reason instanceof Error ? reason.message : '排行榜加载失败，请稍后重试。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [endDate, gameKey, mode, range, reloadToken, selectedGame, startDate, todayDate])

  function chooseGame(nextGameKey: EntertainmentLeaderboardGameKey) {
    const nextGame = getEntertainmentLeaderboardDefinition(nextGameKey)
    if (!nextGame) return
    const nextRange = nextGame.ranges.some((item) => item.key === range) ? range : nextGame.ranges[0]?.key || 'this-week'
    const nextStartDate = nextRange === 'date' ? startDate : null
    const nextEndDate = nextRange === 'date' ? endDate : null
    setGameKey(nextGame.gameKey)
    setMode(nextGame.defaultMode)
    setRange(nextRange)
    setStartDate(nextStartDate)
    setEndDate(nextEndDate)
    pushUrlState(nextGame.gameKey, nextGame.defaultMode, nextGame.ranges.length ? nextRange : null, nextStartDate, nextEndDate)
  }

  function chooseMode(nextMode: string) {
    setMode(nextMode)
    pushUrlState(gameKey, nextMode, selectedGame.ranges.length ? range : null, range === 'date' ? startDate : null, range === 'date' ? endDate : null)
  }

  function chooseRange(nextRange: GameRankingRangeKey, nextStartDate: string | null, nextEndDate: string | null) {
    if (!selectedGame.ranges.some((item) => item.key === nextRange)) return
    const selectedStart = nextRange === 'date' ? nextStartDate : null
    const selectedEnd = nextRange === 'date' ? nextEndDate : null
    setRange(nextRange)
    setStartDate(selectedStart)
    setEndDate(selectedEnd)
    pushUrlState(gameKey, mode, nextRange, selectedStart, selectedEnd)
  }

  const renderSkeleton = () => (
    <div className="entertainment-leaderboard-skeleton" aria-label="排行榜加载中" aria-busy="true">
      {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
    </div>
  )

  return (
    <section className="entertainment-leaderboard-center" aria-labelledby="entertainment-leaderboard-title">
      <div className="entertainment-leaderboard-heading">
        <div>
          <p>各游戏高手榜</p>
          <h2 id="entertainment-leaderboard-title">排行榜</h2>
        </div>
        {board?.rangeLabel ? <span className="entertainment-leaderboard-range">{board.rangeLabel}</span> : null}
      </div>

      <div className="entertainment-leaderboard-tabs" role="tablist" aria-label="选择排行榜游戏">
        {ENTERTAINMENT_LEADERBOARDS.map((item) => (
          <button
            key={item.gameKey}
            type="button"
            role="tab"
            aria-selected={gameKey === item.gameKey}
            onClick={() => chooseGame(item.gameKey)}
          >
            {item.name}
          </button>
        ))}
      </div>

      {selectedGame.modes?.length ? (
        <div className="entertainment-leaderboard-subtabs" role="tablist" aria-label={`${selectedGame.name}模式`}>
          {selectedGame.modes.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={mode === item.key} onClick={() => chooseMode(item.key)}>{item.label}</button>
          ))}
        </div>
      ) : null}

      {selectedGame.ranges.length ? (
        <GameRankingRangeTabs value={range} startDate={startDate} endDate={endDate} todayDate={todayDate} onChange={chooseRange} ariaLabel={`${selectedGame.name}排行榜时间范围`} />
      ) : null}

      {error ? (
        <div className="entertainment-leaderboard-message is-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setReloadToken((value) => value + 1)}>重试</button>
        </div>
      ) : loading && !board ? (
        renderSkeleton()
      ) : board?.status === 'unavailable' ? (
        <p className="entertainment-leaderboard-message" role="status">{board.unavailableReason || '该游戏暂未开放排行榜'}</p>
      ) : board?.status === 'empty' || !board?.rows.length ? (
        <p className="entertainment-leaderboard-message" role="status">暂无排行榜数据</p>
      ) : (
        <div className={`entertainment-leaderboard-board${loading ? ' is-loading' : ''}`}>
          <div className="entertainment-leaderboard-row is-head" aria-hidden="true"><span>排名</span><span>用户</span><span>成绩</span><span>辅助数据</span></div>
          {board.rows.slice(0, 10).map((row) => (
            <article key={row.user.id} className={`entertainment-leaderboard-row${row.rank <= 3 ? ` is-top-${row.rank}` : ''}`}>
              <strong>{row.rank}</strong>
              <span className="entertainment-leaderboard-user">
                <SafeAvatar src={row.user.avatarUrl} name={row.user.nickname} uid={row.user.uid} />
                <span className="entertainment-leaderboard-user-copy">
                  <UserDisplayName name={row.user.nickname} uid={row.user.uid} badges={row.user.equippedBadges} badge={row.user.equippedBadge} compact />
                  <small>UID {String(row.user.uid).padStart(5, '0')}</small>
                </span>
              </span>
              <span className="entertainment-leaderboard-primary"><strong>{row.primaryValue}</strong><small>{row.primaryLabel}</small></span>
              <span className="entertainment-leaderboard-secondary">{row.secondary.map((item) => <span key={item.label}>{item.label} {item.value}</span>)}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
