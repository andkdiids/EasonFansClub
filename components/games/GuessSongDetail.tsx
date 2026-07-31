'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GameCatalogItem } from '@/lib/game-catalog'
import { GameDetailLayout } from './GameDetailLayout'

type Mode = 'EASY' | 'ADVANCED' | 'HARD' | 'ENDLESS'
type LobbySummary = {
  weeklyBest: number | null
  monthlyBest: number | null
  recentSession: {
    mode: Mode
    score: number
    correctCount: number
    maxStreak: number
  } | null
  activeSessions: Array<{ id: string; mode: Mode; currentPosition: number }>
}

const modes: Array<{ mode: Mode; label: string; detail: string }> = [
  { mode: 'EASY', label: '简单', detail: '7 秒片段 · 最多播放 2 次' },
  { mode: 'ADVANCED', label: '进阶', detail: '4 秒片段 · 最多播放 3 次' },
  { mode: 'HARD', label: '困难', detail: '2 秒片段 · 最多播放 5 次' },
  { mode: 'ENDLESS', label: '无尽', detail: '随机片段 · 3 次失误机会' },
]

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json() as { ok?: boolean; data?: T; error?: string }
  if (!response.ok || !payload.ok || payload.data === undefined) throw new Error(payload.error || '请求失败')
  return payload.data
}

export function GuessSongDetail({ game }: Readonly<{ game: GameCatalogItem }>) {
  const router = useRouter()
  const [summary, setSummary] = useState<LobbySummary | null>(null)
  const [starting, setStarting] = useState<Mode | null>(null)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<null | 'records'>(null)
  const [ruleOpen, setRuleOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    request<LobbySummary>('/api/entertainment/guess-song/sessions', { signal: controller.signal, cache: 'no-store' })
      .then(setSummary)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '读取游戏状态失败')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!ruleOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRuleOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [ruleOpen])

  async function start(mode: Mode) {
    if (starting) return
    setStarting(mode)
    setError('')
    try {
      const data = await request<{ resumed: boolean; session: { id: string } }>('/api/entertainment/guess-song/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      router.push(`/games/guess-song/play?session=${encodeURIComponent(data.session.id)}&from=detail`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始游戏')
      setStarting(null)
    }
  }

  function scrollToDifficulty() {
    if (typeof document === 'undefined') return
    document.getElementById('difficulty')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const actions = (
    <>
      <div className="game-detail-actions">
        <button type="button" onClick={() => void start('EASY')} disabled={Boolean(starting)}>
          {starting ? '正在进入…' : '立即开始'}
        </button>
        <button type="button" onClick={() => setRuleOpen(true)}>游戏规则</button>
        <Link href="/entertainment/guess-song/leaderboard">排行榜</Link>
        <a href="#history">历史记录</a>
      </div>
      {/* 移动端专用：Hero 右上角入口（规则 / 排行），点击展开对应内容 */}
      <div className="game-detail-mobile-top">
        <button type="button" onClick={() => setRuleOpen(true)}>规则</button>
        <Link href="/entertainment/guess-song/leaderboard">排行</Link>
      </div>
      {/* 移动端专用：底部同行（紧凑记录信息 左 / 开始游戏 右）；开始游戏滚动到难度选择，不自动开局 */}
      <div className="game-detail-mobile-bottom">
        <div className="guess-detail-records-inline">
          <span>最高分 <b>{summary?.weeklyBest ?? '—'}</b></span>
          <span>最高连击 <b>{summary?.recentSession?.maxStreak ?? '—'}</b></span>
        </div>
        <button type="button" className="guess-detail-start-mobile" onClick={scrollToDifficulty}>开始游戏</button>
      </div>
      {panel ? (
        <div className="game-detail-mobile-panel" role="dialog" aria-modal="true" aria-label="我的记录">
          <div className="game-detail-mobile-panel-backdrop" onClick={() => setPanel(null)} />
          <div className="game-detail-mobile-panel-sheet">
            <header>
              <h3>我的记录</h3>
              <button type="button" className="game-detail-mobile-panel-close" onClick={() => setPanel(null)} aria-label="关闭">✕</button>
            </header>
            <div className="panel-records">
              <dl>
                <div><dt>本周最佳</dt><dd>{summary?.weeklyBest ?? '—'}</dd></div>
                <div><dt>本月最佳</dt><dd>{summary?.monthlyBest ?? '—'}</dd></div>
              </dl>
              {summary?.recentSession ? (
                <p>最近一局 {summary.recentSession.score} 分 · 答对 {summary.recentSession.correctCount} · 最高连击 {summary.recentSession.maxStreak}</p>
              ) : <p>完成第一场游戏后，记录会显示在这里。</p>}
            </div>
          </div>
        </div>
      ) : null}
      {ruleOpen ? (
        <div className="game-rules-modal-backdrop" role="presentation" onClick={() => setRuleOpen(false)}>
          <div className="game-rules-modal" role="dialog" aria-modal="true" aria-labelledby="game-rules-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3 id="game-rules-title">游戏规则</h3>
              <button type="button" className="game-rules-modal-close" onClick={() => setRuleOpen(false)} aria-label="关闭">✕</button>
            </header>
            <div className="game-rules-modal-body">
              <section>
                <span>玩法说明</span>
                <ol>{game.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
              </section>
              <section>
                <span>难度说明</span>
                <ul>{modes.map((item) => <li key={item.mode}><b>{item.label}</b>：{item.detail}</li>)}</ul>
              </section>
              <section>
                <span>奖励与积分</span>
                <ul>{game.rewards.map((reward) => <li key={reward}>{reward}</li>)}</ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )

  return (
    <GameDetailLayout game={game} actions={actions}>
      {error ? <p className="game-detail-error" role="alert">{error}</p> : null}
      <section className="guess-detail-dashboard">
        <div className="guess-detail-modes" id="difficulty">
          <header><span>SELECT MODE</span><h2>选择难度</h2></header>
          <div>
            {modes.map((item) => {
              const active = summary?.activeSessions.find((entry) => entry.mode === item.mode)
              return (
                <button key={item.mode} type="button" onClick={() => void start(item.mode)} disabled={Boolean(starting)}>
                  <span>{item.mode}</span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                  <b>{active ? `继续第 ${active.currentPosition} 题` : '开始挑战'}</b>
                </button>
              )
            })}
          </div>
        </div>
        <aside id="history">
          <span>YOUR RECORDS</span>
          <h2>我的记录</h2>
          <dl>
            <div><dt>本周最佳</dt><dd>{summary?.weeklyBest ?? '—'}</dd></div>
            <div><dt>本月最佳</dt><dd>{summary?.monthlyBest ?? '—'}</dd></div>
          </dl>
          {summary?.recentSession ? (
            <p>最近一局 {summary.recentSession.score} 分 · 答对 {summary.recentSession.correctCount} · 最高连击 {summary.recentSession.maxStreak}</p>
          ) : <p>完成第一场游戏后，记录会显示在这里。</p>}
        </aside>
      </section>
    </GameDetailLayout>
  )
}
