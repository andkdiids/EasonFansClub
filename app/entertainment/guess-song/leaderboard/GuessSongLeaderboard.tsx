'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'

type Period = 'WEEK' | 'MONTH' | 'YEAR'
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
const periodLabels: Record<Period, string> = { WEEK: '周榜', MONTH: '月榜', YEAR: '年榜' }
const periodTitles: Record<Period, string> = {
  WEEK: '本周听听挑战排名',
  MONTH: '本月听听挑战排名',
  YEAR: '年度听听挑战排名',
}
const periodNotes: Record<Period, string> = {
  WEEK: '每周一按北京时间开启新榜单',
  MONTH: '每月1日按北京时间开启新榜单',
  YEAR: '每年1月1日按北京时间开启新榜单',
}

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

  const headingTitle = period === 'YEAR'
    ? `${data?.periodKey ?? new Date().getFullYear()}年度听听挑战排名`
    : periodTitles[period]

  const renderPlayer = (row: Row, key: string, className?: string) => (
    <article key={key} className={className}>
      <strong className="guess-song-rank">{row.rank}</strong>
      <span className="guess-song-rank-avatar"><SafeAvatar src={row.avatarUrl} name={row.nickname} uid={row.uid} /></span>
      <div className="guess-song-rank-user"><strong>{row.nickname}</strong></div>
      <span className="guess-song-stat">{row.score}</span>
      <span className="guess-song-stat is-desktop-only">{row.correctCount}</span>
      <span className="guess-song-stat is-desktop-only">{row.maxStreak}</span>
    </article>
  )

  return (
    <>
      <header className="guess-song-heading">
        <p>Leaderboard</p>
        <h1>{headingTitle}</h1>
        <span>{periodNotes[period]}</span>
      </header>
      <div className="guess-song-leaderboard-filters">
        <div>{(['WEEK', 'MONTH', 'YEAR'] as const).map((item) => <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>{periodLabels[item]}</button>)}</div>
        <div>{(Object.keys(modeLabels) as Mode[]).map((item) => <button key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{modeLabels[item]}</button>)}</div>
      </div>
      {error ? <p className="guess-song-error">{error}</p> : null}
      {data ? <p className="guess-song-algorithm">{data.algorithm}</p> : null}
      <section className="guess-song-leaderboard">
        {data?.rows.length ? (
          <>
            <div className="guess-song-leaderboard-head" aria-hidden="true">
              <span />
              <span />
              <span />
              <span className="guess-song-stat-head">总得分</span>
              <span className="guess-song-stat-head is-desktop-only">总答对</span>
              <span className="guess-song-stat-head is-desktop-only">最高连击</span>
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
