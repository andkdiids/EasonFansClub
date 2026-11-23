'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { ShunConfig } from '@/lib/shun-master-rules'

type Summary = {
  rulesVersion: number
  effectiveEnabled: boolean
  config: ShunConfig; day: string; reserved: number; compensated: number; budgetWarning: boolean; activePlayers: number; hasMore: boolean
  totals: { _count: number; _sum: { amount: number | null; recovered: number | null; compensation: number | null } }
  amounts: { rolled: number; amount: number; _count: { _all: number } }[]
  records: { id: string; actorId: string; victimId: string; rolled: number; amount: number; result: string | null;
    recovered: number; compensation: number; createdAt: string; capturedAt: string | null }[]
  audit: { action: string; occurredAt: string; operatorUserId: string | null; summary: string; metadata: unknown }[]
  abuse: { id: string; createdAt: string; userId: string; metadata: { endpoint?: string } | null }[]
  outstanding: { count: number; oldest: string | null }
  candidatePool: { day: string; eligible: number; excluded: { account: number; refused: number; balance: number; dailyCap: number } }
  refusalCount: number
  activeRefusals: { userId: string; updatedAt: string }[]
  refusalAudit: { id: string; userId: string; action: 'LEAVE' | 'PROTECT' | 'UNPROTECT' | 'REJOIN'; occurredAt: string }[]
}
const refusalLabels = { LEAVE: '旧版明确退出', PROTECT: '旧版开启保护', UNPROTECT: '旧版关闭保护', REJOIN: '旧版重新参与' }
const integerFields = [
  ['attempts', '每日顺取次数'], ['victimCap', '每日被顺上限'], ['goldenMinutes', '黄金抓捕分钟'], ['budget', '平台补偿总预算'],
] as const

export function ShunMasterAdmin() {
  const [data, setData] = useState<Summary>()
  const [config, setConfig] = useState<ShunConfig>()
  const [day, setDay] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ page: String(page) })
    if (day) query.set('day', day)
    fetch('/api/admin/shun-master?' + query, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const json = await response.json()
        if (!response.ok) throw new Error(json.message || '加载失败。')
        if (controller.signal.aborted) return
        setData(json)
        setConfig((current) => current ?? json.config)
      }).catch((error) => { if (!controller.signal.aborted) setMessage(error.message) })
    return () => controller.abort()
  }, [day, page, refresh])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!config || saving) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/shun-master', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || '保存失败。')
      setConfig(json.config)
      setMessage('顺大师规则已保存，启停状态未改变。')
      setRefresh((value) => value + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。') } finally { setSaving(false) }
  }
  async function setEnabled(enabled: boolean) {
    if (saving || !config) return
    if (enabled && !window.confirm('即将开放真实挂号费转移功能。请确认全站告知已完成、历史明确拒绝记录仍受保护、补偿预算已核对。确定启用顺大师吗？')) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/shun-master', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: enabled ? 'enable' : 'disable', confirmed: enabled }) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || '状态更新失败。')
      setConfig((current) => current && { ...current, enabled: json.config.enabled })
      setData((current) => current && { ...current, config: json.config, effectiveEnabled: json.effectiveEnabled })
      setMessage(enabled ? '顺大师已启用。' : '顺大师已关闭。')
      setRefresh((value) => value + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : '状态更新失败。') } finally { setSaving(false) }
  }
  const effectiveEnabled = data?.effectiveEnabled ?? false
  const accountCount = data ? data.candidatePool.eligible + Object.values(data.candidatePool.excluded).reduce((sum, count) => sum + count, 0) : 0
  return <main className="mx-auto grid min-w-0 max-w-6xl grid-cols-1 gap-4 px-3 py-5 pb-20 sm:px-4 sm:py-6">
    <h1 className="text-2xl font-semibold">顺大师管理</h1>
    {message && <p role="status">{message}</p>}
    {config && <form className="grid min-w-0 gap-4 border p-3 sm:p-4" onSubmit={(event) => void save(event)}>
      <section className="grid gap-2 border-b pb-4" aria-label="游戏状态">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold">游戏状态</h2><p className="text-sm text-[var(--foreground-muted)]">启用使用已保存的规则和预算。保存配置不会改变启停状态。</p></div>
          <strong aria-live="polite">{effectiveEnabled ? '已启用' : '已关闭'}</strong>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="flat-button-primary" disabled={saving || effectiveEnabled} onClick={() => void setEnabled(true)}>启用顺大师</button>
          <button type="button" className="border px-3 py-2" disabled={saving || !data?.config.enabled} onClick={() => void setEnabled(false)}>关闭顺大师</button>
        </div>
      </section>
      <div className="grid gap-2 sm:grid-cols-2">{integerFields.map(([key, title]) => <label className="flex min-w-0 flex-wrap items-center justify-between gap-2" key={key}>{title}
        <input className="w-28 max-w-full border p-2" type="number" min={key === 'budget' ? 0 : 1} step={1} required value={config[key]}
          onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })} />
      </label>)}</div>
      {(['probabilities', 'weights'] as const).map((key) => <fieldset className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap" key={key}>
        <legend>{key === 'probabilities' ? '金额概率（%）' : '活跃度权重（极低到极高，100 = 1.00）'}</legend>
        {config[key].map((value, index) => <label className="flex min-w-0 items-center gap-2" key={index}>{key === 'probabilities' ? index + 1 : ['极低', '低', '中', '高', '极高'][index]}
          <input className="w-20 min-w-0 max-w-full border p-2" type="number" step={1} required value={value}
            onChange={(event) => setConfig({ ...config, [key]: config[key].map((item, position) => position === index ? Number(event.target.value) : item) })} />
        </label>)}
      </fieldset>)}
      <button className="flat-button-primary w-fit" disabled={saving}>保存配置</button>
    </form>}
    <label className="flex max-w-full flex-wrap items-center gap-2">顺取日（北京时间） <input className="max-w-full" type="date" value={day || data?.day || ''} onChange={(event) => { setDay(event.target.value); setPage(1) }} /></label>
    {data && <>
      {data.budgetWarning && <p role="alert">补偿预算余量不足，新的顺取会暂停。</p>}
      <p>活跃顺取者 {data.activePlayers} 人 · {data.totals._count} 笔 · 顺取 {data.totals._sum.amount ?? 0} · 追回 {data.totals._sum.recovered ?? 0} · 当日记录补偿 {data.totals._sum.compensation ?? 0}</p>
      <p>已占用准备金 {data.reserved} · 累计平台补偿 {data.compensated}</p>
      <p>待抓捕记录 {data.outstanding.count} 笔{data.outstanding.oldest &&
        ` · 最早产生于 ${new Date(data.outstanding.oldest).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）`}</p>
      <section aria-label="今日候选池" className="grid min-w-0 gap-2 break-words border p-4">
        <h2 className="font-semibold">符合今日扣费目标条件 {data.candidatePool.eligible} 人</h2>
        <p>本次筛查共 {accountCount} 个账户。</p>
        <p>{data.candidatePool.day}（北京时间）。每笔匹配会另外排除发起者本人、互相拉黑者、关联账号和已顺取的对象。</p>
        <p>账户不符合 {data.candidatePool.excluded.account} · 明确拒绝 {data.candidatePool.excluded.refused} · 余额不足 {data.candidatePool.excluded.balance} · 被顺次数已满 {data.candidatePool.excluded.dailyCap}</p>
        <details><summary>历史拒绝审计 · 有效记录 {data.refusalCount} 条</summary>
          <p>最近更新的有效拒绝记录（最多 50 条）</p>
          <ul>{data.activeRefusals.map((item) => <li key={item.userId}>{item.userId} · {new Date(item.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</li>)}</ul>
          <p>最近 50 条历史退出、保护与恢复动作。</p>
          <ul>{data.refusalAudit.map((item) => <li key={item.id}>{new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {refusalLabels[item.action]} · {item.userId}</li>)}</ul>
        </details>
      </section>
      <details><summary>实际金额分布</summary><ul>{data.amounts.map((row) =>
        <li key={row.rolled + ':' + row.amount}>抽中 {row.rolled} · 实付 {row.amount} · {row._count._all} 笔</li>)}</ul></details>
      <div className="min-w-0 overflow-x-auto"><table className="w-full border text-left">
        <thead><tr>{['记录', '顺走入账方', '被顺扣款方', '顺取时间', '抽中 / 实付', '结果', '原额追回 / 平台补偿'].map((title) => <th className="p-2" key={title}>{title}</th>)}</tr></thead>
        <tbody>{data.records.map((row) => <tr key={row.id} className="border-t">
          <td className="p-2">{row.id}</td><td>{row.actorId}</td><td>{row.victimId}</td><td>{new Date(row.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
          <td>{row.rolled} / {row.amount}</td><td>{row.result ?? '未抓捕'}</td><td>{row.recovered} / {row.compensation}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="flex gap-3"><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} 页</span><button disabled={!data.hasMore} onClick={() => setPage(page + 1)}>下一页</button></div>
      <details className="min-w-0 break-words"><summary>配置与补偿审计</summary><ul>{data.audit.map((item, index) =>
        <li key={item.occurredAt + index}>{item.occurredAt} · {item.summary} · {item.operatorUserId || '系统'}
          <pre className="overflow-auto">{JSON.stringify(item.metadata, null, 2)}</pre></li>)}</ul></details>
      <details className="min-w-0 break-words"><summary>近期高频请求拦截</summary>{data.abuse.length
        ? <ul>{data.abuse.map((item) => <li key={item.id}>{item.createdAt} · {item.userId} · {item.metadata?.endpoint}</li>)}</ul>
        : <p>暂无拦截记录。</p>}</details>
    </>}
  </main>
}
