'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'

type Period = 'WEEK' | 'MONTH'
type Mode = 'ALL' | 'EASY' | 'ADVANCED' | 'HARD' | 'ENDLESS'
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
}
type Data = {
  periodType: Period
  periodKey: string
  mode: Mode
  algorithm: string
  rows: Row[]
  currentUser: Row | null
}

const modeLabels: Record<Mode, string> = { ALL: '综合', EASY: '简单', ADVANCED: '进阶', HARD: '困难', ENDLESS: '无尽' }

export function GuessSongLeaderboard({ initialPeriod, initialMode }: Readonly<{ initialPeriod: Period; initialMode: string }>) {
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const [mode, setMode] = useState<Mode>(initialMode in modeLabels ? initialMode as Mode : 'ALL')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    fetch(`/api/entertainment/guess-song/leaderboard?period=${period}&mode=${mode}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: Data; error?: string }
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '排行榜加载失败')
        return payload.data
      })
      .then(setData)
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : '排行榜加载失败'))
  }, [mode, period])

  const ownRank = data?.currentUser && data.currentUser.rank > 0 ? data.currentUser : null
  const ownRowBelow = !!ownRank && ownRank.rank > 10
  const ownNone = !!data && !ownRank && data.rows.length > 0

  const renderPlayer = (row: Row, key: string, className?: string) => (
    <article key={key} className={className}>
      <strong className="guess-song-rank">{row.rank}</strong>
      <span className="guess-song-rank-avatar"><SafeAvatar src={row.avatarUrl} name={row.nickname} uid={row.uid} /></span>
      <div className="guess-song-rank-user"><strong>{row.nickname}</strong></div>
      <div className="guess-song-rank-stats">
        <span>{row.score}</span>
        <span>{row.correctCount}</span>
        <span>{row.maxStreak}</span>
      </div>
    </article>
  )

  return (
    <>
      <header className="guess-song-heading">
        <p>Leaderboard</p>
        <h1>听听排行榜</h1>
        <span>每周一及每月1日按北京时间开启新榜单</span>
      </header>
      <div className="guess-song-leaderboard-filters">
        <div>{(['WEEK', 'MONTH'] as const).map((item) => <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>{item === 'WEEK' ? '周榜' : '月榜'}</button>)}</div>
        <div>{(Object.keys(modeLabels) as Mode[]).map((item) => <button key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{modeLabels[item]}</button>)}</div>
      </div>
      {error ? <p className="guess-song-error">{error}</p> : null}
      {data ? <p className="guess-song-algorithm">{data.algorithm}</p> : null}
      <div className="guess-song-sort-bar" role="group" aria-label="排行榜排序">
        <span className="guess-song-sort-label">排序：</span>
        <button type="button" aria-pressed="true">总得分 ↓</button>
        <button type="button" disabled aria-disabled="true" title="敬请期待">总答对</button>
        <button type="button" disabled aria-disabled="true" title="敬请期待">最高连击</button>
      </div>
      <section className="guess-song-leaderboard">
        {data?.rows.length ? (
          <>
            <div className="guess-song-leaderboard-head" aria-hidden="true">
              <span />
              <span />
              <span />
              <div className="guess-song-rank-stats">
                <span>总得分</span>
                <span>总答对</span>
                <span>最高连击</span>
              </div>
            </div>
            {data.rows.map((row) => renderPlayer(row, row.userId))}
          </>
        ) : <p className="guess-song-empty">当前榜单暂无成绩，完成一局后即可参与排名。</p>}
      </section>
      {ownRowBelow ? <div className="guess-song-leaderboard-ellipsis" aria-hidden="true">···</div> : null}
      {ownRowBelow && ownRank ? renderPlayer(ownRank, 'me', 'guess-song-leaderboard-self is-self') : null}
      {ownNone ? <div className="guess-song-leaderboard-none"><span>暂无排名</span></div> : null}
      <nav className="guess-song-back-links"><Link href="/games/guess-song">返回游戏详情</Link><Link href="/games">返回娱乐天空</Link></nav>
    </>
  )
}
