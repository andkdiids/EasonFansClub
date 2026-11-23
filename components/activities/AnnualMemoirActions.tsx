'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export const memoirPrimary = 'inline-flex min-h-12 w-full items-center justify-center rounded-sm bg-[#69354d] px-4 py-3 text-center font-bold leading-snug text-[#fff6e8] hover:bg-[#54283d] disabled:opacity-70'

type Reservation = { points: number; badgeId: string | null; pointsGrantedAt: string | null; badgeGrantedAt: string | null }
type Props = {
  href: string; title: string; serverNow: number; reportOpens: number; reservationCloses: number; endsAt: number
  canReserve: boolean; canGenerate: boolean; activityDetail: boolean; hasSnapshot: boolean; ended: boolean
  reservation: Reservation | null; points: number; badge: string | null
}

function clockText(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':')
}

export function AnnualMemoirActions(props: Props) {
  const { href, title, serverNow, reportOpens, reservationCloses, endsAt, canReserve, canGenerate, activityDetail, hasSnapshot, ended, points, badge } = props
  const router = useRouter()
  const [serverClock, setServerClock] = useState(serverNow)
  const [localReservation, setLocalReservation] = useState<Reservation | null>(null)
  const reservation = props.reservation ?? localReservation
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const opening = useRef(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const nextPhase = [reservationCloses, reportOpens, endsAt].filter((time) => time > serverNow).sort((a, b) => a - b)[0]
  useEffect(() => {
    if (nextPhase === undefined) return
    const started = performance.now()
    const timer = window.setInterval(() => {
      const current = serverNow + performance.now() - started
      setServerClock(current)
      if (current >= nextPhase) {
        window.clearInterval(timer)
        router.refresh()
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [nextPhase, serverNow, router])

  async function reserve() {
    setBusy(true)
    setError('')
    try {
      const result = await fetch('/api' + href + '/annual-memoir/reservation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
      })
      if (result.status === 401) {
        router.push('/login?next=' + encodeURIComponent(href))
        return
      }
      if (!result.ok) throw new Error()
      const data = await result.json()
      setLocalReservation(data.reservation)
      setConfirm(false)
      router.refresh()
    } catch {
      setError('暂时无法预约，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function openMemoir() {
    if (opening.current || !activityDetail) return
    opening.current = true
    setGenerating(true)
    setError('')
    try {
      const response = await fetch('/api' + href + '/annual-memoir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
      })
      if (response.status === 401) { router.push('/login?next=' + encodeURIComponent(href)); return }
      if (!response.ok) throw new Error()
      // The report document must read the newly committed snapshot, not a prefetched route.
      window.location.assign(href + '/annual-memoir')
    } catch {
      setError('暂时无法开启年度回忆，请重试。')
    } finally {
      opening.current = false
      setGenerating(false)
    }
  }

  return <div className="min-w-0 space-y-4">
    {!ended && !canGenerate && !hasSnapshot && serverNow < reportOpens && <div className="space-y-2"><p className="text-sm font-semibold">距离你的年度回忆开启，还有</p><p aria-label="距年度报告开放" className="font-mono text-[clamp(1.6rem,8vw,2.75rem)] font-semibold leading-none tabular-nums tracking-tight text-[#69354d]">
      {clockText(Math.max(0, Math.ceil((reportOpens - Math.max(serverNow, serverClock)) / 1000)))}
    </p></div>}
    {hasSnapshot ? <Link prefetch={false} className={memoirPrimary} href={href + '/annual-memoir'}>查看我的年度回忆</Link> :
      canGenerate ? (activityDetail ? <button type="button" className={memoirPrimary} disabled={generating} aria-busy={generating} onClick={() => void openMemoir()}>{generating ? <span className="motion-safe:animate-pulse">你的年度回忆，正在慢慢展开……</span> : '开启我在私家E院的年度回忆'}</button> : null) :
      reservation ? <p className={'flex min-h-12 items-center justify-center rounded-sm bg-[#e9d8d9] px-3 py-2 text-center font-semibold text-[#54283d]'}>{ended ? '已预约 · 活动已结束' : '已预约 · 等待回忆开启'}</p> :
      canReserve && serverClock < reservationCloses && !confirm ? <button type="button" className={memoirPrimary} onClick={() => setConfirm(true)}>预约我在私家E院的年度回忆</button> :
      !confirm ? <p className="text-sm text-[#58434b]">{ended ? '活动已结束' : '预约已截止'}</p> : null}
    {confirm && !reservation && <section aria-label="确认预约" className="space-y-3 rounded-sm border border-[#d9bec2] bg-[#fff8ee] p-4">
      <h2 className="break-words font-bold">预约「{title}」</h2>
      {points > 0 && <p>预约成功可获得 {points} 挂号费。</p>}
      {badge && <p>预约勋章：{badge}</p>}
      <p className="text-sm">预约成功后不可取消。</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="min-h-11 px-2" disabled={busy} onClick={() => { setConfirm(false); setError('') }}>再想想</button>
        <button type="button" className={memoirPrimary + ' sm:w-auto'} disabled={busy} onClick={() => void reserve()}>{busy ? '正在预约…' : '确认预约'}</button>
      </div>
    </section>}
    {reservation ? <ul className="space-y-1 break-words text-sm text-[#58434b]">
      {reservation.points > 0 && <li>{reservation.points} 挂号费 · {reservation.pointsGrantedAt ? '已到账' : '待发放'}</li>}
      {reservation.badgeId && <li>预约勋章 · {reservation.badgeGrantedAt ? '已到账' : '待发放'}</li>}
    </ul> : (points > 0 || badge) && !ended ? <p className="break-words text-sm text-[#58434b]">预约礼遇：{[points > 0 ? points + ' 挂号费' : '', badge].filter(Boolean).join(' · ')}</p> : null}
    {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
  </div>
}
