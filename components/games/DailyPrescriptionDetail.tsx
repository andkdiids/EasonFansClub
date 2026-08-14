'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SavePrescriptionButton } from './SavePrescriptionButton'
import { PrescriptionUserBadge } from './PrescriptionUserBadge'
import type { DailyPrescriptionUser } from '@/lib/daily-prescription-types'

type DrawResult = {
  dateKey: string
  points: number
  totalPoints: number
  user: DailyPrescriptionUser
  prescriptionCode: string
  issuedAtBeijing: string
  lyric: { text: string; songTitle: string } | null
}
type DrawStatus = {
  hasDrawn: boolean
  remainingCount: number
  totalPoints: number
  draw: DrawResult | null
}

type IssueDrawResult = {
  created: boolean
  draw: DrawResult
  hasDrawn: true
  remainingCount: 0
}

async function request<T>(init?: RequestInit) {
  const response = await fetch('/api/entertainment/daily-draw', init)
  const payload = await response.json() as { ok?: boolean; data?: T; error?: string }
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || '请求失败')
  return payload.data
}

export function DailyPrescriptionDetail() {
  const [status, setStatus] = useState<DrawStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    request<DrawStatus>({ cache: 'no-store' }).then(setStatus).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '读取今日状态失败')
    }).finally(() => setLoading(false))
  }, [])

  async function draw() {
    if (loading || status?.hasDrawn) return
    setLoading(true)
    setError('')
    try {
      const data = await request<IssueDrawResult>({ method: 'POST' })
      setStatus({
        hasDrawn: true,
        remainingCount: 0,
        totalPoints: data.draw.totalPoints,
        draw: data.draw,
      })
      window.dispatchEvent(new CustomEvent('user:points-updated', {
        detail: { points: data.draw.totalPoints, gainedPoints: data.created ? data.draw.points : 0 },
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '领取失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="daily-game-panel">
      <header>
        <span>BEIJING TIME · DAILY</span>
        <h2>今日处方</h2>
        <Link href="/prescription/history" className="daily-prescription-history-link">查看历史处方 →</Link>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!status?.draw ? (
        <button type="button" onClick={() => void draw()} disabled={loading}>
          {loading ? '正在读取…' : '领取今日处方'}
        </button>
      ) : (
        <article>
          <header className="daily-prescription-card-header">
            <div>
              <span>BEIJING TIME · DAILY</span>
              <h3>今日处方</h3>
            </div>
            <PrescriptionUserBadge user={status.draw.user} />
          </header>
          <span>获得奖励</span>
          <strong>+{status.draw.points} 挂号费</strong>
          {status.draw.lyric ? <blockquote>“{status.draw.lyric.text}”<cite>《{status.draw.lyric.songTitle}》</cite></blockquote> : null}
          <small>处方编号：{status.draw.prescriptionCode}</small>
          <footer className="daily-prescription-footer">
            <SavePrescriptionButton data={status.draw} />
          </footer>
        </article>
      )}
    </section>
  )
}
