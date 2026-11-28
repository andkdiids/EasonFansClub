'use client'

import { useCallback, useEffect, useState } from 'react'

type Report = {
  featureEnabled: boolean
  version: number
  draft: unknown
  stock: unknown[]
  entries: unknown[]
  gifts: unknown[]
  effects: unknown[]
  audit: unknown[]
  abuse: unknown[]
  discrepancy: unknown
  giftRules?: { receiveDailyLimit: number; pool: Record<string, number> }
  giftStatus?: { status: string; count: number }[]
  giftLedger?: { type: string; count: number; amount: number }[]
  giftRecords?: unknown[]
  communityGuarantee?: { budget: number; granted: number }
}

const giftTypeLabels: Record<string, string> = {
  GIFT_SENT: '送出（消耗天使的礼物）', GIFT_RECEIVED: '收到道具', GIFT_REWARD: '赠送者回礼',
}

export function ShunItemAdmin() {
  const [report, setReport] = useState<Report>()
  const [draft, setDraft] = useState('')
  const [userId, setUserId] = useState('')
  const [day, setDay] = useState('')
  const [code, setCode] = useState('')
  const [version, setVersion] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (id = '', filters: { day?: string; code?: string; version?: string } = {}) => {
    setBusy(true)
    try {
      const base = { ...(id ? { userId: id } : {}), ...filters } as Record<string, string>
      const query = new URLSearchParams(Object.entries(base).filter(([, value]) => value))
      const response = await fetch('/api/admin/shun-master/items?' + query, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      setReport(data)
      setDraft(JSON.stringify(data.draft, null, 2))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法加载道具配置。')
    } finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!report) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/shun-master/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: report.version, draft: JSON.parse(draft) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      await load(userId.trim())
      setMessage(`道具配置版本 ${data.version} 已保存。`)
    } catch (error) {
      setMessage(error instanceof SyntaxError ? '配置须为有效 JSON。'
        : error instanceof Error ? error.message : '保存失败。')
    } finally { setBusy(false) }
  }

  return <section className="mx-auto my-6 max-w-6xl space-y-4 border p-4" aria-labelledby="shun-item-admin-title">
    <h2 id="shun-item-admin-title" className="text-xl font-semibold">顺大师道具管理</h2>
    {message && <p role="status">{message}</p>}
    {report && <>
      <p>配置版本 {report.version} · 服务端开关{report.featureEnabled ? '已开启' : '已关闭'}</p>
      <label className="block">道具配置
        <textarea className="mt-1 block w-full border p-2 font-mono text-sm" rows={20} value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button type="button" className="border px-3 py-1" disabled={busy} onClick={() => void save()}>保存新版本</button>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault()
        void load(userId.trim(), { day: day.trim(), code: code.trim(), version: version.trim() })
      }}>
        <label>用户 ID <input className="border p-1" value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
        <label>日期 <input className="border p-1" type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>
        <label>道具 <select className="border p-1" value={code} onChange={(event) => setCode(event.target.value)}>
          <option value="">全部</option>
          <option value="FRIEND_GIFT">天使的礼物</option>
          <option value="EXTRA_ATTEMPT">顺手牵羊</option>
          <option value="EXTRA_SUSPECT">十面埋伏</option>
          <option value="REVENGE">最佳损友</option>
          <option value="TARGET_FRIEND">任我顺</option>
          <option value="DOUBLE_AMOUNT">碌卡</option>
          <option value="RETRY_CAPTURE">时光倒流</option>
        </select></label>
        <label>配置版本 <input className="border p-1 w-20" inputMode="numeric" value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        <button type="submit" className="border px-3 py-1" disabled={busy}>查询</button>
      </form>
      {report.giftRules && <p>
        赠礼规则：每日最多收到 {report.giftRules.receiveDailyLimit} 次 ·
        赠礼专属池 {Object.entries(report.giftRules.pool).map(([key, weight]) => `${key} ${weight}%`).join(' / ')}
      </p>}
      {!!report.giftLedger?.length && <p>
        双向赠礼统计：{report.giftLedger.map((row) => `${giftTypeLabels[row.type] ?? row.type} ${row.count} 笔 / ${row.amount} 件`).join(' · ')}
      </p>}
      {!!report.giftStatus?.length && <p>
        赠礼意图状态：{report.giftStatus.map((row) => `${row.status} ${row.count}`).join(' · ')}
      </p>}
      {report.communityGuarantee && <p>
        社区互动保底（内部指标，用户端不可见）：每日额度 {report.communityGuarantee.budget} 次 · 本期保底发放 {report.communityGuarantee.granted} 次
      </p>}
      {([
        ['库存', report.stock], ['道具流水', report.entries], ['好友赠送', report.gifts],
        ['赠礼结算明细（双方道具 + 回礼）', report.giftRecords ?? []],
        ['挂号费转移、追回及补偿', report.effects], ['库存对账差异', report.discrepancy],
        ['审计记录', report.audit], ['异常行为', report.abuse],
      ] as const).map(([label, value]) => <details key={label}>
        <summary>{label}</summary>
        <pre className="max-h-96 overflow-auto border p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
      </details>)}
    </>}
  </section>
}
