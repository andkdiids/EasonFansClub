'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_AMOUNTS,
  type LeaderboardRewardsConfig,
} from '@/lib/leaderboard-rewards-config'

type Run = {
  id: string
  kind: string
  periodKey: string
  status: string
  attempts: number
  result: unknown
  error: string | null
  createdAt: string
  finishedAt: string | null
}

type ApiState = {
  config: LeaderboardRewardsConfig
  runs: Run[]
  rewardStats: Array<{ runId: string; category: string; _count: number; _sum: { originalAmount: number; actualAmount: number; clippedAmount: number } }>
  badgeStats: Array<{ badgeKey: string; _count: number }>
  audit: Array<{ action: string; occurredAt: string; summary: string }>
}

const emptyConfig: LeaderboardRewardsConfig = {
  enabled: false,
  enabledAt: null,
  entertainment: {
    weeklyEnabled: true, monthlyEnabled: true,
    weeklyTop3: DEFAULT_AMOUNTS.entertainmentWeeklyTop3,
    weeklyTop4To10: DEFAULT_AMOUNTS.entertainmentWeeklyTop4To10,
    monthlyTop3: DEFAULT_AMOUNTS.entertainmentMonthlyTop3,
    monthlyTop4To10: DEFAULT_AMOUNTS.entertainmentMonthlyTop4To10,
    weeklyCap: 270, kSongKingEnabled: true, kSongKingBadgeId: '',
  },
  comment: {
    weeklyEnabled: true, weeklyTop3: DEFAULT_AMOUNTS.commentWeeklyTop3,
    weeklyTop4To10: DEFAULT_AMOUNTS.commentWeeklyTop4To10,
    weeklyCap: 270, thankYouEnabled: true, thankYouBadgeId: '',
  },
  aspirin: {
    weeklyEnabled: true, weeklyTop3: DEFAULT_AMOUNTS.aspirinWeeklyTop3,
    weeklyTop4To10: DEFAULT_AMOUNTS.aspirinWeeklyTop4To10, weeklyCap: 270,
  },
}

export function LeaderboardRewardsAdmin() {
  const [config, setConfig] = useState<LeaderboardRewardsConfig>(emptyConfig)
  const [runs, setRuns] = useState<Run[]>([])
  const [audit, setAudit] = useState<ApiState['audit']>([])
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/leaderboard-rewards', { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json() as ApiState
    setConfig(data.config)
    setRuns(data.runs || [])
    setAudit(data.audit || [])
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/admin/leaderboard-rewards', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      setMessage(res.ok ? `已保存 (v${data.rulesVersion})` : (data.message || '保存失败'))
      await load()
    } finally {
      setSaving(false)
    }
  }

  const retry = async (runId: string) => {
    setMessage('')
    const res = await fetch('/api/admin/leaderboard-rewards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'retry', runId }),
    })
    const data = await res.json()
    setMessage(res.ok ? '已重试结算' : (data.message || '重试失败'))
    await load()
  }

  const ent = config.entertainment
  const cmt = config.comment
  const asp = config.aspirin

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">排行榜自动奖励</h1>
        <p className="mt-1 text-sm text-neutral-500">
          每周一 06:00 结算上周，每月 1 日 06:00 结算上月（Asia/Shanghai）。首次启用后，从第一个完整周期开始自动发放，不补发历史。
        </p>
      </header>

      {message && <div className="rounded border px-3 py-2 text-sm">{message}</div>}

      <section className="space-y-3 rounded border p-4">
        <h2 className="text-lg font-medium">总开关</h2>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
          启用排行榜自动奖励
        </label>
        <p className="text-xs text-neutral-500">生效时间：{config.enabledAt || '尚未启用'}</p>
      </section>

      <section className="space-y-3 rounded border p-4">
        <h2 className="text-lg font-medium">娱乐天空</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Toggle label="周榜自动奖励" checked={ent.weeklyEnabled}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, weeklyEnabled: v } })} />
          <Toggle label="月榜额外奖励" checked={ent.monthlyEnabled}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, monthlyEnabled: v } })} />
          <Toggle label="K歌之王自动发放" checked={ent.kSongKingEnabled}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, kSongKingEnabled: v } })} />
          <Num label="周榜前三 (挂号费)" value={ent.weeklyTop3}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, weeklyTop3: v } })} />
          <Num label="周榜 4–10 名" value={ent.weeklyTop4To10}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, weeklyTop4To10: v } })} />
          <Num label="月榜前三" value={ent.monthlyTop3}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, monthlyTop3: v } })} />
          <Num label="月榜 4–10 名" value={ent.monthlyTop4To10}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, monthlyTop4To10: v } })} />
          <Num label="每周上限" value={ent.weeklyCap}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, weeklyCap: v } })} />
          <Text label="K歌之王勋章 ID" value={ent.kSongKingBadgeId}
            onChange={(v) => setConfig({ ...config, entertainment: { ...ent, kSongKingBadgeId: v } })} />
        </div>
      </section>

      <section className="space-y-3 rounded border p-4">
        <h2 className="text-lg font-medium">E院广场评论榜</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Toggle label="周榜自动奖励" checked={cmt.weeklyEnabled}
            onChange={(v) => setConfig({ ...config, comment: { ...cmt, weeklyEnabled: v } })} />
          <Toggle label="谢谢侬自动发放" checked={cmt.thankYouEnabled}
            onChange={(v) => setConfig({ ...config, comment: { ...cmt, thankYouEnabled: v } })} />
          <Num label="前三 (挂号费)" value={cmt.weeklyTop3}
            onChange={(v) => setConfig({ ...config, comment: { ...cmt, weeklyTop3: v } })} />
          <Num label="4–10 名" value={cmt.weeklyTop4To10}
            onChange={(v) => setConfig({ ...config, comment: { ...cmt, weeklyTop4To10: v } })} />
          <Num label="每周上限" value={cmt.weeklyCap}
            onChange={(v) => setConfig({ ...config, comment: { ...cmt, weeklyCap: v } })} />
          <Text label="谢谢侬勋章 ID" value={cmt.thankYouBadgeId}
            onChange={(v) => setConfig({ ...config, comment: { ...cmt, thankYouBadgeId: v } })} />
        </div>
      </section>

      <section className="space-y-3 rounded border p-4">
        <h2 className="text-lg font-medium">阿士匹灵门诊部会诊榜</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Toggle label="周榜自动奖励" checked={asp.weeklyEnabled}
            onChange={(v) => setConfig({ ...config, aspirin: { ...asp, weeklyEnabled: v } })} />
          <Num label="前三 (挂号费)" value={asp.weeklyTop3}
            onChange={(v) => setConfig({ ...config, aspirin: { ...asp, weeklyTop3: v } })} />
          <Num label="4–10 名" value={asp.weeklyTop4To10}
            onChange={(v) => setConfig({ ...config, aspirin: { ...asp, weeklyTop4To10: v } })} />
          <Num label="每周上限" value={asp.weeklyCap}
            onChange={(v) => setConfig({ ...config, aspirin: { ...asp, weeklyCap: v } })} />
        </div>
      </section>

      <button onClick={() => void save()} disabled={saving}
        className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {saving ? '保存中…' : '保存配置'}
      </button>

      <section className="space-y-2 rounded border p-4">
        <h2 className="text-lg font-medium">结算记录</h2>
        {runs.length === 0 && <p className="text-sm text-neutral-500">暂无结算记录</p>}
        {runs.map((run) => (
          <div key={run.id} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
            <div>
              <span className="font-medium">{run.kind}</span> · {run.periodKey} · {run.status}
              {run.error && <span className="ml-2 text-red-600">{run.error}</span>}
            </div>
            {run.status === 'FAILED' && (
              <button onClick={() => void retry(run.id)} className="rounded border px-2 py-1">重试</button>
            )}
          </div>
        ))}
      </section>

      {audit.length > 0 && (
        <section className="space-y-2 rounded border p-4">
          <h2 className="text-lg font-medium">操作审计</h2>
          {audit.map((row, i) => (
            <div key={i} className="text-sm text-neutral-600">{row.occurredAt} · {row.action} · {row.summary}</div>
          ))}
        </section>
      )}
    </main>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input type="number" min={0} max={1000000} step={1} value={value}
        onChange={(e) => onChange(numValue(e.target.value))}
        className="rounded border px-2 py-1" />
    </label>
  )
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value.trim())}
        className="rounded border px-2 py-1" />
    </label>
  )
}

function numValue(value: string) {
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : 0
}
