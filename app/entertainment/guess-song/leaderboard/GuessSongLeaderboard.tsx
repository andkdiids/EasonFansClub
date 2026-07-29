'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { formatUid } from '@/lib/uid'

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

  return (
    <>
      <header className="guess-song-heading">
        <p>Leaderboard</p>
        <h1>E声猜歌排行榜</h1>
        <span>每周一及每月1日按北京时间开启新榜单</span>
      </header>
      <div className="guess-song-leaderboard-filters">
        <div>{(['WEEK', 'MONTH'] as const).map((item) => <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>{item === 'WEEK' ? '周榜' : '月榜'}</button>)}</div>
        <div>{(Object.keys(modeLabels) as Mode[]).map((item) => <button key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{modeLabels[item]}</button>)}</div>
      </div>
      {error ? <p className="guess-song-error">{error}</p> : null}
      {data ? <p className="guess-song-algorithm">{data.algorithm}</p> : null}
      {data?.currentUser ? <section className="guess-song-own-rank">我的排名：第 {data.currentUser.rank} 名 · {data.currentUser.score} 分</section> : null}
      <section className="guess-song-leaderboard">
        {data?.rows.length ? data.rows.map((row) => (
          <article key={row.userId}>
            <strong className="guess-song-rank">{row.rank}</strong>
            <span className="guess-song-rank-avatar"><SafeAvatar src={row.avatarUrl} name={row.nickname} uid={row.uid} /></span>
            <div><strong>{row.nickname}</strong><small>UID {formatUid(row.uid)}</small></div>
            <div><strong>{row.score}</strong><small>最高分</small></div>
            <div><strong>{row.correctCount}</strong><small>答对</small></div>
            <div><strong>{row.maxStreak}</strong><small>连击</small></div>
            <time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.achievedAt))}</time>
          </article>
        )) : <p className="guess-song-empty">当前榜单暂无成绩，完成一局后即可参与排名。</p>}
      </section>
      <nav className="guess-song-back-links"><Link href="/entertainment/guess-song">返回模式选择</Link><Link href="/entertainment">返回娱乐中心</Link></nav>
    </>
  )
}
