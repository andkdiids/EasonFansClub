'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  WANT_LISTEN_MODE_DESCRIPTIONS,
  WANT_LISTEN_MODE_LABELS,
  WANT_LISTEN_MODES,
  isWantListenModeEnabled,
  type WantListenMode,
} from '@/lib/want-listen-config'

type ModeStats = {
  gamesPlayed: number
  bestScore: number
  totalQuestions: number
  totalCorrect: number
  accuracy: number
  perfectGames: number
  maxStreak: number
  silentMaxStreak: number
}

type Summary = {
  config: { enabled: boolean; wantListenEnabled: boolean; cantoneseFragmentEnabled: boolean; falseTitleEnabled: boolean }
  modes: Record<WantListenMode, ModeStats>
  total: { gamesPlayed: number; totalQuestions: number; totalCorrect: number; accuracy: number; bestMode: WantListenMode | null }
  activeSessions: Array<{ id: string; mode: WantListenMode; currentQuestion: number; score: number; correctCount: number; expiresAt: string }>
  statsUnavailable: boolean
  activeSessionsUnavailable: boolean
}

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null
  if (!response.ok || !payload?.ok || payload.data === undefined) throw new Error(payload?.error || '请求失败，请稍后重试。')
  return payload.data
}

function number(value: number) {
  return value.toLocaleString('zh-CN')
}

export function WantListenHome() {
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState<WantListenMode | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    request<Summary>('/api/entertainment/want-listen/summary', { cache: 'no-store', signal: controller.signal })
      .then(setSummary)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '想听数据加载失败，请稍后重试。')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  async function start(mode: WantListenMode) {
    const active = summary?.activeSessions.find((session) => session.mode === mode)
    if (starting || !summary || (!isWantListenModeEnabled(summary.config, mode) && !active)) return
    setStarting(mode)
    setError('')
    try {
      const data = await request<{ resumed: boolean; session: { id: string } }>('/api/entertainment/want-listen/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      router.push(`/games/want-listen/play?session=${encodeURIComponent(data.session.id)}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始游戏，请稍后重试。')
      setStarting(null)
    }
  }

  const activeByMode = new Map((summary?.activeSessions || []).map((session) => [session.mode, session]))
  const personalStatsUnavailable = summary?.statsUnavailable === true

  return (
    <main className="games-page games-full-width">
      <div className="games-page-inner want-listen-page">
      <header className="want-listen-heading">
        <Link href="/games" className="want-listen-back">← 返回娱乐天空</Link>
        <h1>想听</h1>
        <p>没有声音，你还认得出这些歌吗？</p>
      </header>

      {error ? <p className="want-listen-error" role="alert">{error}</p> : null}
      {!summary && loading ? <p className="want-listen-loading">正在读取想听状态…</p> : null}
      {summary && !summary.config.enabled ? <p className="want-listen-disabled" role="status">想听板块目前暂停开放，请稍后再来。</p> : null}
      {summary && (summary.statsUnavailable || summary.activeSessionsUnavailable) ? <p className="want-listen-degraded" role="status">个人数据暂时无法完整加载，但游戏仍可开始。</p> : null}

      <section className="want-listen-mode-grid" aria-label="想听游戏模式">
        {WANT_LISTEN_MODES.map((mode) => {
          const enabled = Boolean(summary && isWantListenModeEnabled(summary.config, mode))
          const active = activeByMode.get(mode)
          const stats = summary?.modes[mode]
          return (
            <article key={mode} className={`want-listen-mode-card${enabled || active ? '' : ' is-disabled'}`}>
              <span>模式 0{WANT_LISTEN_MODES.indexOf(mode) + 1}</span>
              <h2>{WANT_LISTEN_MODE_LABELS[mode]}</h2>
              <p>{WANT_LISTEN_MODE_DESCRIPTIONS[mode]}</p>
              <div className="want-listen-mode-meta">
                <span>无尽模式 · 答错 3 次结束</span>
                <span>最佳 {personalStatsUnavailable ? '—' : stats?.bestScore ?? '—'} 分</span>
              </div>
              <button type="button" onClick={() => void start(mode)} disabled={(!enabled && !active) || Boolean(starting)}>
                {active ? `继续第 ${active.currentQuestion} 题` : !enabled ? '暂未开放' : starting === mode ? '创建对局中…' : '开始游戏'}
              </button>
            </article>
          )
        })}
      </section>

      <section className="want-listen-summary-panel" aria-labelledby="want-listen-summary-title">
        <div className="want-listen-panel-heading">
          <div><h2 id="want-listen-summary-title">我的数据</h2></div>
          <Link href="/games/want-listen/leaderboard">查看排行榜 →</Link>
        </div>
        <div className="want-listen-total-stats">
          <div><span>累计游玩</span><strong>{personalStatsUnavailable ? '—' : number(summary?.total.gamesPlayed || 0)}</strong></div>
          <div><span>累计答题</span><strong>{personalStatsUnavailable ? '—' : number(summary?.total.totalQuestions || 0)}</strong></div>
          <div><span>累计答对</span><strong>{personalStatsUnavailable ? '—' : number(summary?.total.totalCorrect || 0)}</strong></div>
          <div><span>总正确率</span><strong>{personalStatsUnavailable ? '—' : `${summary?.total.accuracy || 0}%`}</strong></div>
          <div><span>最擅长模式</span><strong>{personalStatsUnavailable ? '—' : summary?.total.bestMode ? WANT_LISTEN_MODE_LABELS[summary.total.bestMode] : '—'}</strong></div>
        </div>
        <div className="want-listen-mode-stats">
          {WANT_LISTEN_MODES.map((mode) => {
            const stats = summary?.modes[mode]
            return <div key={mode}><strong>{WANT_LISTEN_MODE_LABELS[mode]}</strong><span>{personalStatsUnavailable ? '—' : `${stats?.gamesPlayed || 0} 局 · 最高 ${stats?.bestScore || 0} 分 · 最高连击 ${stats?.maxStreak || 0} · 答对 ${stats?.totalCorrect || 0}`}</span></div>
          })}
        </div>
      </section>
      </div>
    </main>
  )
}
