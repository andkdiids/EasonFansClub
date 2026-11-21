'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const dates = [
  ['previewAt', '预告开始'], ['reservationOpensAt', '预约开始'], ['reservationClosesAt', '预约截止'],
  ['statisticsStartAt', '统计开始'], ['statisticsEndAt', '统计截止'], ['reportOpensAt', '报告开放'],
  ['notificationAt', '站内通知'], ['endsAt', '活动结束'], ['settlementAt', '年度勋章结算'],
] as const
type Config = Record<(typeof dates)[number][0], string> & {
  enabled: boolean; reservationPoints: number; reservationBadgeId: string | null; annualBadgeId: string | null
  statisticsLockedAt: string | null; templateVersion: number
}
type Data = {
  config: Config | null
  badges: { id: string; name: string }[]
  outstanding: { id: string; user: { uid: number } }[]
  stats: { reservations: number; reports: number; notified: number; settled: number; medals: number; points: number }
}

export function AnnualMemoirAdmin({ activityId }: { activityId: string }) {
  const url = `/api/admin/activities/${encodeURIComponent(activityId)}/annual-memoir`
  const [data, setData] = useState<Data | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal, cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error()
      return response.json()
    }).then(setData).catch(() => { if (!controller.signal.aborted) setMessage('无法读取年度配置。') })
    return () => controller.abort()
  }, [url, revision])
  async function send(method: 'PUT' | 'POST', body: object) {
    setBusy(true)
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json()
      setMessage(result.message || (response.ok ? '已保存。' : '操作失败。'))
      if (response.ok || method === 'POST') {
        setData(null)
        setRevision((value) => value + 1)
      }
    } catch {
      setMessage('请求失败，请重试。')
    } finally {
      setBusy(false)
    }
  }
  const config = data?.config
  return <details className="my-5 space-y-3 border p-4">
    <summary>葡萄成熟时 · 年度回忆录配置</summary>
    <Link className="underline" href={`/admin/activities/${encodeURIComponent(activityId)}/annual-memoir-preview`}>打开只读预览</Link>
    <p>先用上方现有活动设置保存名称、介绍、封面、首页精选和广场置顶，再保存年度配置。</p>
    {message && <p role="status">{message}</p>}
    {data && <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
      {dates.map(([key, label]) => <label key={key}>{label}（北京时间）
        <input className="block w-full" data-memoir={key} type="datetime-local" step="1"
          readOnly={!!config?.statisticsLockedAt && (key === 'statisticsStartAt' || key === 'statisticsEndAt')}
          defaultValue={config ? new Date(new Date(config[key]).getTime() + 28_800_000).toISOString().slice(0, 19) : ''} />
      </label>)}
      <label>预约挂号费（填 0 关闭）<input data-memoir="reservationPoints" type="number" min="0" defaultValue={config?.reservationPoints ?? 74} /></label>
      {(['reservationBadgeId', 'annualBadgeId'] as const).map((key) => <label key={key}>
        {key === 'reservationBadgeId' ? '预约勋章' : '年度限定勋章'}
        <select data-memoir={key} defaultValue={config?.[key] ?? ''}>
          <option value="">请选择</option>
          {data.badges.map((badge) => <option key={badge.id} value={badge.id}>{badge.name}</option>)}
        </select>
      </label>)}
      <label><input type="checkbox" data-memoir="enabled" defaultChecked={config?.enabled ?? false} />启用年度活动</label>
      <button type="button" onClick={(event) => {
        const fields = event.currentTarget.closest('fieldset')?.querySelectorAll<HTMLInputElement>('[data-memoir]')
        const values = Object.fromEntries(Array.from(fields ?? []).map((field) => {
          const key = field.dataset.memoir
          return [key, key === 'enabled' ? field.checked : key === 'reservationPoints' ? field.valueAsNumber : field.value]
        }))
        void send('PUT', values)
      }}>保存年度配置</button>
    </fieldset>}
    {data && <>
      <p>预约 {data.stats.reservations} 人 · 已发挂号费 {data.stats.points} · 预约勋章 {data.stats.medals} 人 · 通知 {data.stats.notified} 人</p>
      <p>已生成 {data.stats.reports} 份 · 模板版本 {config?.templateVersion ?? 1} · 年度勋章 {data.stats.settled} 人</p>
      {data.outstanding.map((row) => <div key={row.id} className="flex flex-wrap gap-3">
        <span>UID {row.user.uid} · 有预约奖励待发</span>
        <button type="button" disabled={busy} onClick={() => void send('POST', { reservationId: row.id })}>补发未到账奖励</button>
      </div>)}
    </>}
  </details>
}
