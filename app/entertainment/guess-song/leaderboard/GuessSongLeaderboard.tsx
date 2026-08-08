'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'

type Period = 'WEEK' | 'MONTH' | 'YEAR'
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
}
const modeOrder: Mode[] = ['EASY', 'ADVANCED', 'HARD', 'EXPERT']
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
  // 周期/模式初始值直接来自 URL（已由服务端 page.tsx 解析），首屏即正确，不存在 WEEK→YEAR 二次渲染
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const [mode, setMode] = useState<Mode>(initialMode in modeLabels ? (initialMode as Mode) : 'EASY')
  // 始终保留「上一份数据」：切换周期时先显示旧榜单，避免空列表 / 骨架闪烁，数据返回后直接原地替换
  const [data, setData] = useState<Data | null>(initialData)
  // 仅在尚未加载过任何数据时进入 loading；专家模式也使用真实排行榜。
  const [loading, setLoading] = useState<boolean>(!initialData)
  const [error, setError] = useState('')
  // 已加载数据缓存：period:mode -> Data。命中即秒切、不触发 loading 闪烁；未命中也保留旧列表仅显轻量 loading
  const cache = useRef<Map<string, Data>>(new Map())
  if (initialData) cache.current.set(`${initialPeriod}:${initialMode}`, initialData)

  useEffect(() => {
    const key = `${period}:${mode}`
    // 命中缓存：直接替换，无需 loading，无闪烁
    const cached = cache.current.get(key)
    if (cached) {
      setData(cached)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    // 保留旧 data 不清除，仅置轻量 loading（细进度条 + 轻微降透明度），杜绝空列表 / 骨架闪现
    setLoading(true)
    setError('')
    fetch(`/api/entertainment/guess-song/leaderboard?period=${period}&mode=${mode}`, { cache: 'no-store' })
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
  }, [mode, period])

  // 仅当「从未成功加载过任何数据」且仍在首次请求中，才显示骨架（切换时旧数据在场，永不显骨架）
  const firstLoad = !data && loading
  const ownRank = data && data.currentUser && data.currentUser.rank > 0 ? data.currentUser : null
  const ownRowBelow = !!ownRank && ownRank.rank > 10
  const ownNone = !!data && !ownRank && data.rows.length > 0

  // YEAR 标题：仅当已加载数据确为年榜时使用其 periodKey，否则用当前自然年，杜绝 2026-08年度 闪屏
  const yearLabel = period === 'YEAR' ? (data && data.periodType === 'YEAR' && data.periodKey ? data.periodKey : String(new Date().getFullYear())) : ''
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
      <div className="guess-song-board-wrap">
          {/* 轻量 loading 指示：仅细进度条，绝不替换内容，杜绝空列表 / 骨架闪现 */}
          {loading ? <div className="guess-song-loading-bar" aria-hidden="true" /> : null}
          {data ? (
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
            <p className="guess-song-empty">当前榜单暂无成绩，完成一局后即可参与排名。</p>
          )}
      </div>
      <nav className="guess-song-back-links"><Link href="/games/guess-song">返回游戏详情</Link><Link href="/games">返回娱乐天空</Link></nav>
    </>
  )
}
