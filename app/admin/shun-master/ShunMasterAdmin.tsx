'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { ShunConfig } from '@/lib/shun-master-rules'

type Summary = {
  rulesVersion: number
  launchNoticeId: string | null
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
  const [noticeId, setNoticeId] = useState<string>()
  const [confirmProtection, setConfirmProtection] = useState(false)
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
        body: JSON.stringify({ ...config, launchNoticeId: (noticeId ?? data?.launchNoticeId ?? '').trim(), confirmProtection }) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || '保存失败。')
      setConfig(json.config)
      setConfirmProtection(false)
      setMessage('顺大师规则已保存。')
      setRefresh((value) => value + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。') } finally { setSaving(false) }
  }
  return <main className="mx-auto grid max-w-6xl gap-4 px-4 py-6">
    <h1 className="text-2xl font-semibold">顺大师管理</h1>
    {message && <p role="status">{message}</p>}
    {config && <form className="grid gap-3 border p-4" onSubmit={(event) => void save(event)}>
      <label><input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /> 启用顺大师</label>
      {integerFields.map(([key, title]) => <label key={key}>{title}
        <input className="ml-2 border p-2" type="number" min={key === 'budget' ? 0 : 1} step={1} required value={config[key]}
          onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })} />
      </label>)}
      {(['probabilities', 'weights'] as const).map((key) => <fieldset className="flex flex-wrap gap-2" key={key}>
        <legend>{key === 'probabilities' ? '金额概率（%）' : '活跃度权重（极低到极高，100 = 1.00）'}</legend>
        {config[key].map((value, index) => <label key={index}>{key === 'probabilities' ? index + 1 : ['极低', '低', '中', '高', '极高'][index]}
          <input className="ml-1 w-20 border p-2" type="number" step={1} required value={value}
            onChange={(event) => setConfig({ ...config, [key]: config[key].map((item, position) => position === index ? Number(event.target.value) : item) })} />
        </label>)}
      </fieldset>)}
      <label>已发布的全站公告 ID <input className="border p-2" value={noticeId ?? data?.launchNoticeId ?? ''} onChange={(event) => setNoticeId(event.target.value)} /></label>
      {config.enabled && <label><input type="checkbox" checked={confirmProtection} onChange={(event) => setConfirmProtection(event.target.checked)} /> 已核对全站公告、历史拒绝扣费记录与补偿预算，确认开放</label>}
      <button className="flat-button-primary w-fit" disabled={saving}>保存并发布配置</button>
    </form>}
    <label>顺取日（北京时间） <input type="date" value={day || data?.day || ''} onChange={(event) => { setDay(event.target.value); setPage(1) }} /></label>
    {data && <>
      {data.budgetWarning && <p role="alert">补偿预算余量不足，新的顺取会暂停。</p>}
      <p>活跃顺取者 {data.activePlayers} 人 · {data.totals._count} 笔 · 顺取 {data.totals._sum.amount ?? 0} · 追回 {data.totals._sum.recovered ?? 0} · 当日记录补偿 {data.totals._sum.compensation ?? 0}</p>
      <p>已占用准备金 {data.reserved} · 累计平台补偿 {data.compensated}</p>
      <p>待抓捕记录 {data.outstanding.count} 笔{data.outstanding.oldest &&
        ` · 最早产生于 ${new Date(data.outstanding.oldest).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）`}</p>
      <section aria-label="今日候选池" className="grid gap-2 border p-4">
        <h2 className="font-semibold">符合今日扣费目标条件 {data.candidatePool.eligible} 人</h2>
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
      <div className="overflow-x-auto"><table className="w-full border text-left">
        <thead><tr>{['记录', '顺走入账方', '被顺扣款方', '顺取时间', '抽中 / 实付', '结果', '原额追回 / 平台补偿'].map((title) => <th className="p-2" key={title}>{title}</th>)}</tr></thead>
        <tbody>{data.records.map((row) => <tr key={row.id} className="border-t">
          <td className="p-2">{row.id}</td><td>{row.actorId}</td><td>{row.victimId}</td><td>{new Date(row.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
          <td>{row.rolled} / {row.amount}</td><td>{row.result ?? '未抓捕'}</td><td>{row.recovered} / {row.compensation}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="flex gap-3"><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</button>
        <span>第 {page} 页</span><button disabled={!data.hasMore} onClick={() => setPage(page + 1)}>下一页</button></div>
      <details><summary>配置与补偿审计</summary><ul>{data.audit.map((item, index) =>
        <li key={item.occurredAt + index}>{item.occurredAt} · {item.summary} · {item.operatorUserId || '系统'}
          <pre className="overflow-auto">{JSON.stringify(item.metadata, null, 2)}</pre></li>)}</ul></details>
      <details><summary>近期高频请求拦截</summary>{data.abuse.length
        ? <ul>{data.abuse.map((item) => <li key={item.id}>{item.createdAt} · {item.userId} · {item.metadata?.endpoint}</li>)}</ul>
        : <p>暂无拦截记录。</p>}</details>
    </>}
  </main>
}
