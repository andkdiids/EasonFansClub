'use client'

import { useEffect, useState } from 'react'
import { UiIcon } from '@/components/UiIcon'

type DrawResult = {
  id: string
  dateKey: string
  points: number
  totalPoints: number
  prescriptionCode: string
  issuedAtBeijing: string
  lyric: {
    id: string | null
    text: string
    songTitle: string
    albumTitle: string | null
  } | null
}

type DrawStatus = {
  todayDateKey: string
  hasDrawn: boolean
  remainingCount: number
  availableLyricCount: number
  totalPoints: number
  draw: DrawResult | null
}

type ApiPayload<T> = {
  ok: boolean
  data: T | null
  error: string | null
}

async function readJson<T>(response: Response) {
  const body = await response.json().catch(() => null) as ApiPayload<T> | null
  if (!response.ok || !body?.ok || !body.data) {
    throw new Error(body?.error || '请求失败，请稍后重试')
  }
  return body.data
}

export function EntertainmentCenter() {
  const [status, setStatus] = useState<DrawStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [error, setError] = useState('')
  const [drawOpen, setDrawOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/entertainment/daily-draw', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => readJson<DrawStatus>(response))
      .then((data) => {
        setStatus(data)
        if (data.hasDrawn) setDrawOpen(true)
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setError(requestError instanceof Error ? requestError.message : '娱乐中心加载失败')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  async function issueDraw() {
    if (drawing || status?.hasDrawn) return
    setDrawing(true)
    setError('')
    try {
      const data = await readJson<{
        created: boolean
        draw: DrawResult
        todayDateKey: string
        hasDrawn: true
        remainingCount: 0
      }>(await fetch('/api/entertainment/daily-draw', { method: 'POST' }))
      setStatus((current) => ({
        todayDateKey: data.todayDateKey,
        hasDrawn: true,
        remainingCount: 0,
        availableLyricCount: current?.availableLyricCount ?? 0,
        totalPoints: data.draw.totalPoints,
        draw: data.draw,
      }))
      window.dispatchEvent(new CustomEvent('user:points-updated', {
        detail: { points: data.draw.totalPoints, gainedPoints: data.created ? data.draw.points : 0 },
      }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '抽取失败，请稍后重试')
    } finally {
      setDrawing(false)
    }
  }

  const remaining = status?.remainingCount ?? 1
  const drawResult = status?.draw

  return (
    <>
      <header className="entertainment-heading">
        <p>Entertainment</p>
        <h1>娱乐中心</h1>
        <span>每日来一点小惊喜</span>
      </header>

      {error ? <p className="entertainment-error" role="alert">{error}</p> : null}

      <section className="entertainment-entry-grid" aria-label="娱乐中心功能">
        <button type="button" className="entertainment-entry is-active" onClick={() => setDrawOpen(true)}>
          <UiIcon name="star" />
          <span>
            <strong>每日抽奖</strong>
            <small>{loading ? '正在读取今日状态…' : `今日次数 ${remaining}/1`}</small>
          </span>
          <b>本期正式开放</b>
        </button>
        <div className="entertainment-entry is-coming">
          <UiIcon name="music" />
          <span><strong>猜歌挑战</strong><small>更多音乐互动正在准备</small></span>
          <b>即将开放</b>
        </div>
        <div className="entertainment-entry is-coming">
          <UiIcon name="archive" />
          <span><strong>E院成就</strong><small>收藏属于你的E院时刻</small></span>
          <b>即将开放</b>
        </div>
      </section>

      {drawOpen ? (
        <section className="daily-draw-panel" aria-labelledby="daily-draw-title">
          <div className="daily-draw-intro">
            <div>
              <p>Daily prescription</p>
              <h2 id="daily-draw-title">每日抽奖</h2>
              <span>每日 00:00 按北京时间更新</span>
            </div>
            <strong>今日剩余次数 {remaining}/1</strong>
          </div>

          {loading ? <p className="daily-draw-loading">正在读取今日处方…</p> : null}

          {!loading && !drawResult ? (
            <div className="daily-draw-action">
              <p>今天的幸运处方尚未开具。积分奖励与歌词处方均由服务端随机决定。</p>
              <button type="button" onClick={issueDraw} disabled={drawing}>
                {drawing ? '正在开具处方……' : '抽取今日处方'}
              </button>
            </div>
          ) : null}

          {drawResult ? (
            <article className="prescription-card">
              <header>
                <p>私家E院 · 今日幸运处方</p>
                <span>{drawResult.dateKey}</span>
              </header>
              <div className="prescription-points">
                <span>获得奖励</span>
                <strong>+{drawResult.points} 积分</strong>
                <small>当前积分 {drawResult.totalPoints}</small>
              </div>
              <div className="prescription-lyric">
                <span>今日歌词处方</span>
                {drawResult.lyric ? (
                  <>
                    <blockquote>「{drawResult.lyric.text}」</blockquote>
                    <cite>——《{drawResult.lyric.songTitle}》</cite>
                  </>
                ) : (
                  <p>今日处方暂未开具，请等待管理员补充歌词库</p>
                )}
              </div>
              <footer>
                <span>处方编号：{drawResult.prescriptionCode}</span>
                <span>开具时间：{drawResult.issuedAtBeijing}</span>
              </footer>
            </article>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
