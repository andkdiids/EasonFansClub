'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'

type Period = 'WEEK' | 'MONTH' | 'YEAR'
type Mode = 'EASY' | 'ADVANCED' | 'HARD' | 'ENDLESS' | 'EXPERT'
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

const modeLabels: Record<Mode, string> = {
  EASY: '简单',
  ADVANCED: '进阶',
  HARD: '困难',
  EXPERT: '专家',
  ENDLESS: '无尽',
}
// 模式 Tab 固定顺序：简单 → 进阶 → 困难 → 专家（预留）→ 无尽
const modeOrder: Mode[] = ['EASY', 'ADVANCED', 'HARD', 'EXPERT', 'ENDLESS']
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
// 排行榜展示字段：最高分 / 答对数 / 最高连击（来自最高分对应的那一局）
const statLabels = ['最高分', '答对数', '最高连击']

export function GuessSongLeaderboard({ initialPeriod, initialMode, initialData }: Readonly<{ initialPeriod: Period; initialMode: string; initialData: Data | null }>) {
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const [mode, setMode] = useState<Mode>(initialMode in modeLabels ? (initialMode as Mode) : 'EASY')
  const [data, setData] = useState<Data | null>(initialData)
  const [loading, setLoading] = useState<boolean>(!initialData)
  const [error, setError] = useState('')
  // 已成功加载过的 period:mode 组合，避免切换回已有数据时重复请求/闪屏
  const fetchedFor = useRef<string>(initialData ? `${initialPeriod}:${initialMode}` : '')

  useEffect(() => {
    // 专家模式为预留入口，不请求排行榜 API
    if (mode === 'EXPERT') return
    const key = `${period}:${mode}`
    // 初始周期已由服务端预取；切换回已加载过的周期直接复用，不重新请求
    if (fetchedFor.current === key) return
    fetchedFor.current = key
    setLoading(true)
    setError('')
    fetch(`/api/entertainment/guess-song/leaderboard?period=${period}&mode=${mode}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: Data; error?: string }
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '排行榜加载失败')
        return payload.data
      })
      .then(setData)
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : '排行榜加载失败'))
      .finally(() => setLoading(false))
  }, [mode, period])

  // 当前 data 是否属于「当前选中的周期 + 模式」。不匹配时（切换中或初始无数据）不渲染旧数据
  const ready = !!data && data.periodType === period && data.mode === mode
  const isExpert = mode === 'EXPERT'
  const showSkeleton = loading && !ready && !isExpert
  const ownRank = ready && data.currentUser && data.currentUser.rank > 0 ? data.currentUser : null
  const ownRowBelow = !!ownRank && ownRank.rank > 10
  const ownNone = ready && !ownRank && data.rows.length > 0

  // YEAR 标题：仅当数据已就绪为年榜时使用其 periodKey，否则用当前自然年，杜绝 2026-08年度 闪屏
  const yearLabel = ready && data.periodType === 'YEAR' && data.periodKey ? data.periodKey : String(new Date().getFullYear())
  const headingTitle = period === 'YEAR' ? `${yearLabel}年度听听挑战排名` : periodTitles[period]

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
        <span>{periodNotes[period]}</span>
      </header>
      <div className="guess-song-leaderboard-filters">
        <div>{(['WEEK', 'MONTH', 'YEAR'] as const).map((item) => <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>{periodLabels[item]}</button>)}</div>
        <div>{modeOrder.map((item) => <button key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{modeLabels[item]}</button>)}</div>
      </div>
      {error ? <p className="guess-song-error">{error}</p> : null}
      {isExpert ? (
        <div className="guess-song-leaderboard-expert">
          <strong>专家模式</strong>
          <span>敬请期待</span>
        </div>
      ) : (
        <>
          {ready ? <p className="guess-song-algorithm">{data.algorithm}</p> : null}
          <section className="guess-song-leaderboard">
            {showSkeleton ? (
              renderSkeleton()
            ) : ready && data.rows.length ? (
              <>
                {renderHead()}
                {data.rows.map((row) => renderPlayer(row, row.userId))}
              </>
            ) : <p className="guess-song-empty">当前榜单暂无成绩，完成一局后即可参与排名。</p>}
          </section>
          {ownRowBelow ? <div className="guess-song-leaderboard-ellipsis" aria-hidden="true">···</div> : null}
          {ownRowBelow && ownRank ? renderPlayer(ownRank, 'me', 'guess-song-leaderboard-self is-self') : null}
          {ownNone ? <div className="guess-song-leaderboard-none"><span>暂无排名</span></div> : null}
        </>
      )}
      <nav className="guess-song-back-links"><Link href="/games/guess-song">返回游戏详情</Link><Link href="/games">返回娱乐天空</Link></nav>
    </>
  )
}
