'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GameCatalogItem } from '@/lib/game-catalog'
import { GUESS_SONG_MODE_CONFIG, type GuessSongPublicMode } from '@/lib/guess-song-config'
import { createUUID } from '@/lib/utils/uuid'
import { GameDetailLayout } from './GameDetailLayout'

type Mode = GuessSongPublicMode
type LobbySummary = {
  expertEnabled: boolean
  weeklyBest: number | null
  monthlyBest: number | null
  recentSession: {
    mode: Mode
    score: number
    correctCount: number
    maxStreak: number
  } | null
  activeSessions: Array<{ id: string; mode: Mode; currentPosition: number }>
  pausedSessions: Array<{
    id: string
    mode: Mode
    score: number
    currentStreak: number
    wrongCount: number
    livesRemaining: number
    currentPosition: number
    pausedAt: string
    expiresAt: string
  }>
}

const modes: Array<{ mode: Mode; label: string; detail: string }> = [
  { mode: 'EASY', label: GUESS_SONG_MODE_CONFIG.EASY.label, detail: '7秒听歌挑战 · 无限题目 · 5次播放' },
  { mode: 'ADVANCED', label: GUESS_SONG_MODE_CONFIG.ADVANCED.label, detail: '5秒听歌挑战 · 无限题目 · 5次播放' },
  { mode: 'HARD', label: GUESS_SONG_MODE_CONFIG.HARD.label, detail: '3秒听歌挑战 · 无限题目 · 5次播放' },
  { mode: 'EXPERT', label: GUESS_SONG_MODE_CONFIG.EXPERT.label, detail: '歌名记忆挑战 · 手动输入 · 5次播放' },
]

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json() as { ok?: boolean; data?: T; error?: string }
  if (!response.ok || !payload.ok || payload.data === undefined) throw new Error(payload.error || '请求失败')
  return payload.data
}

function formatPausedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function GuessSongDetail({ game }: Readonly<{ game: GameCatalogItem }>) {
  const router = useRouter()
  const [summary, setSummary] = useState<LobbySummary | null>(null)
  const [starting, setStarting] = useState<Mode | null>(null)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<null | 'records'>(null)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [pausedChoice, setPausedChoice] = useState<LobbySummary['pausedSessions'][number] | null>(null)
  const [newGameConfirmOpen, setNewGameConfirmOpen] = useState(false)

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

  async function beginSession(mode: Mode, replacePausedSessionId?: string) {
    if (starting) return
    setStarting(mode)
    setError('')
    try {
      const data = await request<{ resumed: boolean; session: { id: string } }>('/api/entertainment/guess-song/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, clientFlowNonce: createUUID(), ...(replacePausedSessionId ? { replacePausedSessionId } : {}) }),
      })
      router.push(`/games/guess-song/play?session=${encodeURIComponent(data.session.id)}&from=detail`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始游戏')
      setStarting(null)
    }
  }

  function start(mode: Mode) {
    if (starting) return
    const paused = summary?.pausedSessions.find((item) => item.mode === mode)
    if (paused) {
      setPausedChoice(paused)
      setNewGameConfirmOpen(false)
      return
    }
    void beginSession(mode)
  }

  async function resumePausedSession() {
    if (!pausedChoice || starting) return
    setStarting(pausedChoice.mode)
    setError('')
    try {
      const data = await request<{ session: { id: string } }>(`/api/entertainment/guess-song/sessions/${pausedChoice.id}/resume`, {
        method: 'POST',
      })
      router.push(`/games/guess-song/play?session=${encodeURIComponent(data.session.id)}&from=detail`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法恢复暂停存档')
      setStarting(null)
      setPausedChoice(null)
    }
  }

  function openNewGameConfirmation() {
    if (!pausedChoice) return
    setNewGameConfirmOpen(true)
  }

  function cancelPausedChoice() {
    if (starting) return
    setPausedChoice(null)
    setNewGameConfirmOpen(false)
  }

  function confirmNewGame() {
    if (!pausedChoice) return
    const choice = pausedChoice
    setPausedChoice(null)
    setNewGameConfirmOpen(false)
    void beginSession(choice.mode, choice.id)
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
      {pausedChoice && !newGameConfirmOpen ? (
        <div className="guess-session-choice-backdrop" role="presentation" onClick={cancelPausedChoice}>
          <section className="guess-session-choice-modal" role="dialog" aria-modal="true" aria-labelledby="guess-session-choice-title" onClick={(event) => event.stopPropagation()}>
            <span>PAUSED SESSION</span>
            <h3 id="guess-session-choice-title">发现未完成的游戏</h3>
            <p>你还有一局已暂停的游戏，可以继续之前的进度，或开始新游戏。</p>
            <dl>
              <div><dt>当前分数</dt><dd>{pausedChoice.score}</dd></div>
              <div><dt>连续答对</dt><dd>{pausedChoice.currentStreak}</dd></div>
              <div><dt>当前题目</dt><dd>第 {pausedChoice.currentPosition} 题</dd></div>
              <div><dt>暂停时间</dt><dd>{formatPausedAt(pausedChoice.pausedAt)}</dd></div>
            </dl>
            <div className="guess-session-choice-actions">
              <button type="button" onClick={cancelPausedChoice} disabled={Boolean(starting)}>取消</button>
              <button type="button" onClick={openNewGameConfirmation} disabled={Boolean(starting)}>新游戏</button>
              <button type="button" className="is-primary" onClick={() => void resumePausedSession()} disabled={Boolean(starting)}>{starting ? '处理中…' : '继续游戏'}</button>
            </div>
          </section>
        </div>
      ) : null}
      {pausedChoice && newGameConfirmOpen ? (
        <div className="guess-session-choice-backdrop" role="presentation" onClick={() => setNewGameConfirmOpen(false)}>
          <section className="guess-session-choice-modal" role="dialog" aria-modal="true" aria-labelledby="guess-new-game-title" onClick={(event) => event.stopPropagation()}>
            <span>NEW SESSION</span>
            <h3 id="guess-new-game-title">开始新游戏？</h3>
            <p>你当前还有一局未完成的游戏。开始新游戏后，原有游戏存档将被放弃，且无法恢复。</p>
            <p className="guess-session-choice-highlight">当前分数：{pausedChoice.score} · 连续答对：{pausedChoice.currentStreak}</p>
            <div className="guess-session-choice-actions">
              <button type="button" onClick={() => setNewGameConfirmOpen(false)} disabled={Boolean(starting)}>取消</button>
              <button type="button" className="is-danger" onClick={confirmNewGame} disabled={Boolean(starting)}>{starting ? '处理中…' : '确认开始新游戏'}</button>
            </div>
          </section>
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
              const paused = summary?.pausedSessions.find((entry) => entry.mode === item.mode)
              const unavailable = item.mode === 'EXPERT' && summary?.expertEnabled === false
              return (
                <button key={item.mode} type="button" onClick={() => void start(item.mode)} disabled={Boolean(starting) || unavailable} aria-label={paused ? `继续${item.label}存档` : undefined}>
                  <span>{item.label}挑战</span>
                  <strong>{item.label}</strong>
                  <small>{unavailable ? '当前暂未开放' : item.detail}</small>
                  <b>{unavailable ? '暂未开放' : active ? `继续第 ${active.currentPosition} 题` : '开始挑战'}</b>
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
