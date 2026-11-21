'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export function AnnualMemoirCountdown({ target, serverNow }: { target: number; serverNow: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, target - serverNow))
  useEffect(() => {
    const started = performance.now()
    const timer = window.setInterval(() => {
      const next = Math.max(0, target - serverNow - (performance.now() - started))
      setRemaining(next)
      if (next === 0) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [target, serverNow])
  const minutes = Math.ceil(remaining / 60_000)
  return minutes > 0 ? <p>距报告开放 {Math.floor(minutes / 1440)} 天 {Math.floor(minutes / 60) % 24} 小时 {minutes % 60} 分钟</p> :
    <p>请刷新查看最新活动状态。</p>
}

export function AnnualMemoirReserve({ endpoint }: { endpoint: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function reserve() {
    setBusy(true)
    setError('')
    try {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) })
      if (result.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`)
        return
      }
      if (!result.ok) throw new Error()
      setConfirm(false)
      router.refresh()
    } catch {
      setError('暂时无法预约，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }
  return <div className="mt-3">
    {!confirm ? <button type="button" onClick={() => setConfirm(true)}>预约我的年度回忆录</button> :
      <div role="dialog" aria-label="确认预约">
        <p>预约成功后，将获得本次活动的预约奖励。预约不可取消，也不能重复预约。</p>
        <button type="button" disabled={busy} onClick={() => setConfirm(false)}>再想想</button>
        <button type="button" disabled={busy} onClick={reserve}>确认预约</button>
      </div>}
    {error && <p role="alert">{error}</p>}
  </div>
}
