'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { WANT_LISTEN_MODE_LABELS, WANT_LISTEN_MODES, type WantListenMode } from '@/lib/want-listen-config'
import { UserDisplayName } from '@/components/UserDisplayName'
import type { EquippedBadgeView } from '@/lib/badge-types'

type Row = {
  rank: number
  userId: string
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  completionTimeMs: number
  user: { nickname: string; uid: number; avatarUrl: string | null; equippedBadge?: EquippedBadgeView | null }
}

type Board = { rows: Row[]; self: Row | null; period: string; periodKey: string }

async function request<T>(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '排行榜加载失败，请稍后重试。')
  return payload.data
}

export function WantListenLeaderboard() {
  const [mode, setMode] = useState<WantListenMode>('WANT_LISTEN')
  const [period, setPeriod] = useState<'TODAY' | 'WEEK' | 'ALL'>('WEEK')
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    request<Board>(`/api/entertainment/want-listen/leaderboard?mode=${mode}&period=${period}`)
      .then((data) => { if (active) setBoard(data) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '排行榜加载失败，请稍后重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [mode, period])

  return (
    <main className="games-page games-full-width">
      <div className="games-page-inner want-listen-page want-listen-board-page">
      <header className="want-listen-heading">
        <Link href="/games/want-listen" className="want-listen-back">← 返回想听</Link>
        <h1>想听榜</h1>
        <p>每个模式独立记录，自己的最佳成绩只占一个位置。</p>
      </header>
      <div className="want-listen-board-filters"><div>{WANT_LISTEN_MODES.map((item) => <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)}>{WANT_LISTEN_MODE_LABELS[item]}</button>)}</div><div>{[['TODAY', '今日'], ['WEEK', '本周'], ['ALL', '总榜']].map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value as typeof period)}>{label}</button>)}</div></div>
      {error ? <p className="want-listen-error" role="alert">{error}</p> : null}
      <section className={`want-listen-board${loading ? ' is-loading' : ''}`} aria-label={`${WANT_LISTEN_MODE_LABELS[mode]}排行榜`}>
        <div className="want-listen-board-head"><span>排名</span><span>用户</span><span>分数</span><span>答对</span><span>连击</span><span>用时</span></div>
        {board?.rows.map((row) => <article key={row.userId}><span>{row.rank}</span><span className="want-listen-board-user">{row.user.avatarUrl ? <img src={row.user.avatarUrl} alt="" /> : <i>{String(row.user.uid).slice(-1)}</i>}<b><UserDisplayName name={row.user.nickname} uid={row.user.uid} badge={row.user.equippedBadge} compact /></b></span><strong>{row.score}</strong><span>{row.correctCount}</span><span>{row.maxStreak}</span><span>{Math.max(1, Math.round(row.completionTimeMs / 1000))}s</span></article>)}
        {!loading && !board?.rows.length ? <p className="want-listen-board-empty">当前周期还没有完成成绩。</p> : null}
      </section>
        {board?.self ? <p className="want-listen-board-self">我的最佳：{board.self.score} 分 · 答对 {board.self.correctCount} · 最高连击 {board.self.maxStreak} · {Math.max(1, Math.round(board.self.completionTimeMs / 1000))} 秒</p> : null}
      </div>
    </main>
  )
}
