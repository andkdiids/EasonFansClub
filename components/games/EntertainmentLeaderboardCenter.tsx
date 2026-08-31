'use client'

import { useEffect, useMemo, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'
import {
  ENTERTAINMENT_LEADERBOARDS,
  getEntertainmentLeaderboardDefinition,
  type EntertainmentLeaderboardGameKey,
} from '@/lib/entertainment-leaderboard-registry'

type Row = {
  rank: number
  user: {
    id: string
    uid: number
    nickname: string
    displayName: string
    avatarUrl: string | null
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
  rangeLabel: string | null
  rows: Row[]
  unavailableReason?: string
}

export function EntertainmentLeaderboardCenter() {
  const defaultGame = ENTERTAINMENT_LEADERBOARDS[0]
  const [gameKey, setGameKey] = useState<EntertainmentLeaderboardGameKey>(defaultGame.gameKey)
  const [mode, setMode] = useState<string | null>(defaultGame.defaultMode)
  const [period, setPeriod] = useState<string | null>(defaultGame.defaultPeriod)
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const selectedGame = useMemo(() => getEntertainmentLeaderboardDefinition(gameKey) || defaultGame, [defaultGame, gameKey])

  useEffect(() => {
    let cancelled = false
    setError('')
    setBoard(null)

    setLoading(true)
    const params = new URLSearchParams({ game: gameKey })
    if (mode) params.set('mode', mode)
    if (period) params.set('period', period)
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
  }, [gameKey, mode, period, reloadToken, defaultGame])

  function chooseGame(nextGameKey: EntertainmentLeaderboardGameKey) {
    const nextGame = getEntertainmentLeaderboardDefinition(nextGameKey)
    if (!nextGame) return
    setGameKey(nextGame.gameKey)
    setMode(nextGame.defaultMode)
    setPeriod(nextGame.defaultPeriod)
  }

  function chooseMode(nextMode: string) {
    setMode(nextMode)
    setBoard(null)
  }

  function choosePeriod(nextPeriod: string) {
    setPeriod(nextPeriod)
    setBoard(null)
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

      {selectedGame.periods.length ? (
        <div className="entertainment-leaderboard-subtabs" role="tablist" aria-label={`${selectedGame.name}排行榜周期`}>
          {selectedGame.periods.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={period === item.key} onClick={() => choosePeriod(item.key)}>{item.label}</button>
          ))}
        </div>
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
                  <UserDisplayName name={row.user.nickname} uid={row.user.uid} badge={row.user.equippedBadge} compact />
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
