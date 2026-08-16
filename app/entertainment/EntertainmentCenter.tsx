'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { UiIcon } from '@/components/UiIcon'
import { SavePrescriptionButton } from '@/components/games/SavePrescriptionButton'
import { PrescriptionUserBadge } from '@/components/games/PrescriptionUserBadge'
import type { DailyPrescriptionUser } from '@/lib/daily-prescription-types'
import { MAX_DAILY_PRESCRIPTION_REWARD, MIN_DAILY_PRESCRIPTION_REWARD } from '@/lib/daily-prescription-reward'

type DrawResult = {
  id: string
  dateKey: string
  points: number
  totalPoints: number
  user: DailyPrescriptionUser
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
    let active = true
    const controller = new AbortController()
    const load = () => {
      setLoading(true)
      setError('')
      fetch('/api/entertainment/daily-draw', {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((response) => readJson<DrawStatus>(response))
        .then((data) => {
          if (!active) return
          setStatus(data)
          if (data.hasDrawn) setDrawOpen(true)
        })
        .catch((requestError: unknown) => {
          if (!active || (requestError instanceof DOMException && requestError.name === 'AbortError')) return
          setError(requestError instanceof Error ? requestError.message : '娱乐天空加载失败')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }

    load()
    window.addEventListener('profile-updated', load)
    return () => {
      active = false
      controller.abort()
      window.removeEventListener('profile-updated', load)
    }
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
        <h1>娱乐天空</h1>
        <span>每日来一点小惊喜</span>
      </header>

      {error ? <p className="entertainment-error" role="alert">{error}</p> : null}

      <section className="entertainment-entry-grid" aria-label="娱乐天空功能">
        <button type="button" className="entertainment-entry is-active" onClick={() => setDrawOpen(true)}>
          <UiIcon name="star" />
          <span>
            <strong>每日抽奖</strong>
            <small>{loading ? '正在读取今日状态…' : `今日次数 ${remaining}/1`}</small>
          </span>
          <b>本期正式开放</b>
        </button>
        <Link href="/entertainment/guess-song" className="entertainment-entry is-active">
          <UiIcon name="music" />
          <span><strong>听听</strong><small>听短音频，猜出正确歌曲</small></span>
          <b>立即挑战</b>
        </Link>
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
              <h2 id="daily-draw-title">每日抽奖</h2>
              <span>每日 00:00 按北京时间更新</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/prescription/history" className="text-xs font-black text-brand-700">历史处方 →</Link>
              <strong>今日剩余次数 {remaining}/1</strong>
            </div>
          </div>

          {loading ? <p className="daily-draw-loading">正在读取今日处方…</p> : null}

          {!loading && !drawResult ? (
            <div className="daily-draw-action">
              <p>每日随机获得 {MIN_DAILY_PRESCRIPTION_REWARD}～{MAX_DAILY_PRESCRIPTION_REWARD} 挂号费，数值越高越稀有。奖励与歌词处方均由服务端随机决定。</p>
              <button type="button" onClick={issueDraw} disabled={drawing}>
                {drawing ? '正在开具处方……' : '抽取今日处方'}
              </button>
            </div>
          ) : null}

          {drawResult ? (
            <article className="prescription-card">
              <header>
                <p>私家E院 · 今日幸运处方</p>
                <PrescriptionUserBadge user={drawResult.user} />
              </header>
              <div className="prescription-points">
                <span>获得奖励</span>
                <strong>+{drawResult.points} 挂号费</strong>
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
                <SavePrescriptionButton data={drawResult} />
              </footer>
            </article>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
