'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ACTIVITY_TIER_LABELS, shunConfigError, type ShunConfig } from '@/lib/shun-config'
import { ShunDiagnosePanel } from './ShunDiagnosePanel'

const FALLBACK_LABELS: Record<string, string> = {
  FRIEND_CHANCE_OFF: '好友概率为 0',
  NO_FRIENDS: '发起人无好友',
  POOL_EMPTY_AFTER_FILTERS: '好友全部被资格规则排除',
  DICE_LOSS: '好友池非空但概率未命中',
}

type Summary = {
  rulesVersion: number
  effectiveEnabled: boolean
  config: ShunConfig; day: string; reserved: number; compensated: number; activePlayers: number; hasMore: boolean
  totals: { _count: number; _sum: { amount: number | null; recovered: number | null; compensation: number | null } }
  amounts: { rolled: number; amount: number; _count: { _all: number } }[]
  records: { id: string; actorId: string; victimId: string; rolled: number; amount: number; result: string | null;
    recovered: number; compensation: number; createdAt: string; capturedAt: string | null }[]
  audit: { action: string; occurredAt: string; operatorUserId: string | null; summary: string; metadata: unknown }[]
  abuse: { id: string; createdAt: string; userId: string; metadata: { endpoint?: string } | null }[]
  outstanding: { count: number; oldest: string | null }
  candidatePool: { day: string; eligible: number; excluded: { account: number; balance: number; dailyCap: number } }
  refusalAudit: { id: string; userId: string; action: 'LEAVE' | 'PROTECT' | 'UNPROTECT' | 'REJOIN'; occurredAt: string }[]
  matchStats: { day: string; total: number; friendHits: number; friendRate: number; unknownTier: number
    tiers: { tier: number; label: string; count: number }[]
    fallbacks: { reason: string | null; count: number }[] }
  notifyStats: { day: string; pending: number; plain: number; letter: number; auto: number; retryAttempts: number }
  // V5: cumulative recovery-bonus audit (admin-only).
  bonusStats: { recoveredCount: number; bonusCount: number; bonusRate: number; bonusTotal: number; recoveredTotal: number }
  comboStats: { day: string; singleItem: number; multiItem: number; targetFriendQuotaUsed: number
    byCombination: { combination: string; count: number }[]; consumed: Record<string, number>; failureReasons: Record<string, number> }
  // V6: the daily window as the server judges it right now.
  openHoursNow: { openHoursEnabled: boolean; openTime: string; closeTime: string; label: string
    open: boolean; nextOpenAt: string | null }
  serverNow: string
}
const refusalLabels = { LEAVE: '旧版明确退出', PROTECT: '旧版开启保护', UNPROTECT: '旧版关闭保护', REJOIN: '旧版重新参与' }
const integerFields = [
  ['attempts', '每日顺取次数'], ['victimCap', '每日普通被顺取上限'], ['goldenMinutes', '黄金抓捕分钟'],
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
    // The form and the API validate with the same function, so a rejected value
    // is explained here before the request is even sent.
    const invalid = shunConfigError(config)
    if (invalid) { setMessage(invalid); return }
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
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/shun-master', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: enabled ? 'enable' : 'disable' }) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || '状态更新失败。')
      setConfig((current) => current && { ...current, enabled: json.config.enabled })
      setData((current) => current && { ...current, config: json.config, effectiveEnabled: json.effectiveEnabled })
      setMessage(enabled ? '顺大师已开启。' : '顺大师已关闭。')
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
          <div><h2 className="font-semibold">游戏状态</h2><p className="text-sm text-[var(--foreground-muted)]">启用使用已保存的规则。保存配置不会改变启停状态。</p></div>
          <strong aria-live="polite">{effectiveEnabled ? '已开启' : '已关闭'}</strong>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="flat-button-primary" disabled={saving || effectiveEnabled} onClick={() => void setEnabled(true)}>启用顺大师</button>
          <button type="button" className="border px-3 py-2" disabled={saving || !data?.config.enabled} onClick={() => void setEnabled(false)}>关闭顺大师</button>
        </div>
      </section>
      {/* 每日开放时间：只限制新的顺取，历史记录、抓捕调查与已有留言不受影响 */}
      <section className="grid gap-2 border-b pb-4" aria-label="每日开放时间">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">每日开放时间</h2>
          <strong aria-live="polite">{!data?.openHoursNow ? '—'
            : data.openHoursNow.openHoursEnabled ? (data.openHoursNow.open ? '当前开放中' : '当前休息中') : '全天开放'}</strong>
        </div>
        <label className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={config.openHoursEnabled}
            onChange={(event) => setConfig({ ...config, openHoursEnabled: event.target.checked })} />
          启用开放时间限制
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-wrap items-center gap-2">开始时间
            <input className="border p-2" type="time" step={60} required aria-label="每日开放开始时间"
              value={config.openTime} onChange={(event) => setConfig({ ...config, openTime: event.target.value })} />
          </label>
          <label className="flex min-w-0 flex-wrap items-center gap-2">结束时间
            <input className="border p-2" type="time" step={60} required aria-label="每日开放结束时间"
              value={config.closeTime} onChange={(event) => setConfig({ ...config, closeTime: event.target.value })} />
          </label>
        </div>
        <p className="text-sm">时区：北京时间（UTC+8）</p>
        <p className="text-sm text-[var(--foreground-muted)]">开启后，用户只能在设定时间内发起新的顺取。历史记录、抓捕调查及已有留言不受限制。</p>
        <p className="text-sm text-[var(--foreground-muted)]">开放区间为左闭右开：{config.openTime || '--:--'} ≤ 当前北京时间 &lt; {config.closeTime || '--:--'}。
          支持跨午夜（如 22:00–02:00）；开始与结束时间相同时无法保存。</p>
        <button className="flat-button-primary w-fit" disabled={saving}>保存开放时间</button>
      </section>
      <div className="grid gap-2 sm:grid-cols-2">{integerFields.map(([key, title]) => <label className="flex min-w-0 flex-wrap items-center justify-between gap-2" key={key}>{title}
        <input className="w-28 max-w-full border p-2" type="number" min={1} step={1} required value={config[key]}
          onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })} />
      </label>)}
        <p className="col-span-full text-sm text-[var(--foreground-muted)]">
          任我顺专属被顺取上限固定为 1（全站共享）；每日被顺取总上限由普通上限 + 1 自动得出，当前为 {config.victimCap + 1}。
        </p>
        {/* 后台隐藏机制：只改目标池优先级，不改任何顺取规则 */}
        <label className="flex min-w-0 flex-wrap items-center justify-between gap-2">好友命中概率（%）
          <input className="w-28 max-w-full border p-2" aria-label="好友命中概率" type="number" min={0} max={100} step={1} required
            value={config.friendChance}
            onChange={(event) => setConfig({ ...config, friendChance: Number(event.target.value) })} />
        </label>
        {/* 追回额外奖励：只影响抓捕成功后的平台额外发放，普通用户不可见 */}
        <label className="flex min-w-0 flex-wrap items-center justify-between gap-2">追回额外奖励概率（%）
          <input className="w-28 max-w-full border p-2" aria-label="追回额外奖励概率" type="number" min={0} max={100} step={1} required
            value={config.bonusChance}
            onChange={(event) => setConfig({ ...config, bonusChance: Number(event.target.value) })} />
        </label>
      </div>
      <p className="text-sm text-[var(--foreground-muted)]">追回额外奖励：抓捕成功时按该概率由平台额外发放与本次实际追回等额的挂号费，不扣被抓到用户的余额，0% 关闭、100% 必定触发，只影响之后的抓捕。</p>
      {(['probabilities', 'weights'] as const).map((key) => <fieldset className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap" key={key}>
        <legend>{key === 'probabilities' ? '金额概率（%）' : '活跃度权重（极低到极高，1–300，只表示相对倾向）'}</legend>
        {config[key].map((value, index) => <label className="flex min-w-0 items-center gap-2" key={index}>{key === 'probabilities' ? index + 1 : ACTIVITY_TIER_LABELS[index]}
          <input className="w-20 min-w-0 max-w-full border p-2" type="number" step={1} required
            min={key === 'probabilities' ? 0 : 1} max={key === 'probabilities' ? 100 : 300} value={value}
            onChange={(event) => setConfig({ ...config, [key]: config[key].map((item, position) => position === index ? Number(event.target.value) : item) })} />
        </label>)}
        <p className="basis-full text-sm text-[var(--foreground-muted)]">{key === 'probabilities'
          ? '七档任意顺序均可，单档可为 0%，合计必须等于 100%。'
          : '五档权重互不排序、允许相同，空群体不参与抽取，其余群体按权重重新归一。'}</p>
      </fieldset>)}
      <button className="flat-button-primary w-fit" disabled={saving}>保存配置</button>
    </form>}
    <label className="flex max-w-full flex-wrap items-center gap-2">顺取日（北京时间） <input className="max-w-full" type="date" value={day || data?.day || ''} onChange={(event) => { setDay(event.target.value); setPage(1) }} /></label>
    {data && <>
      <p>活跃顺取者 {data.activePlayers} 人 · {data.totals._count} 笔 · 顺取 {data.totals._sum.amount ?? 0} · 追回 {data.totals._sum.recovered ?? 0} · 当日记录补偿 {data.totals._sum.compensation ?? 0}</p>
      <p>已占用准备金 {data.reserved} · 累计平台补偿 {data.compensated}</p>
      <p>待抓捕记录 {data.outstanding.count} 笔{data.outstanding.oldest &&
        ` · 最早产生于 ${new Date(data.outstanding.oldest).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）`}</p>
      <section aria-label="今日候选池" className="grid min-w-0 gap-2 break-words border p-4">
        <h2 className="font-semibold">符合今日扣费目标条件 {data.candidatePool.eligible} 人</h2>
        <p>本次筛查共 {accountCount} 个账户。</p>
        <p>{data.candidatePool.day}（北京时间）。每笔匹配会另外排除发起者本人、互相拉黑者、关联账号和已顺取的对象。</p>
        <p>账户不符合 {data.candidatePool.excluded.account} · 余额不足 {data.candidatePool.excluded.balance} · 被顺次数已满 {data.candidatePool.excluded.dailyCap}</p>
        <details><summary>历史参与状态审计</summary>
          <p>最近更新的有效拒绝记录（最多 50 条）</p>
          <p>最近 50 条历史退出、保护与恢复动作。</p>
          <ul>{data.refusalAudit.map((item) => <li key={item.id}>{new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {refusalLabels[item.action]} · {item.userId}</li>)}</ul>
        </details>
      </section>
      <details><summary>实际金额分布</summary><ul>{data.amounts.map((row) =>
        <li key={row.rolled + ':' + row.amount}>抽中 {row.rolled} · 实付 {row.amount} · {row._count._all} 笔</li>)}</ul></details>
      <details open><summary>通知发送统计 · {data.notifyStats.day}</summary>
        <ul>
          <li>匿名留言通知 {data.notifyStats.letter} 笔</li>
          <li>普通被顺通知 {data.notifyStats.plain} 笔</li>
          <li>待通知 {data.notifyStats.pending} 笔</li>
          <li>超时自动发送普通通知 {data.notifyStats.auto} 笔</li>
          <li>发送失败重试 {data.notifyStats.retryAttempts} 次</li>
        </ul>
        <p className="text-sm text-[var(--foreground-muted)]">待通知为玩家仍可选择是否留言的顺取；超过 120 秒未选择由服务端自动发送普通通知。</p>
      </details>
      <details open><summary>追回额外奖励统计（累计）</summary>
        <ul>
          <li>成功追回次数 {data.bonusStats.recoveredCount} 次</li>
          <li>额外奖励触发次数 {data.bonusStats.bonusCount} 次</li>
          <li>实际奖励触发率 {data.bonusStats.bonusRate}%（当前配置 {data.config.bonusChance}%）</li>
          <li>累计额外奖励挂号费 {data.bonusStats.bonusTotal}</li>
          <li>累计原额追回挂号费 {data.bonusStats.recoveredTotal}</li>
        </ul>
        <p className="text-sm text-[var(--foreground-muted)]">额外奖励单独计入「顺大师 · 额外奖励」流水，不占用准备金、不扣被抓到用户余额，也不计入勋章「累计成功追回」进度。</p>
      </details>
      <details open><summary>组合道具统计 · {data.comboStats.day}</summary>
        <ul>
          <li>单道具顺取 {data.comboStats.singleItem} 笔 · 多道具组合 {data.comboStats.multiItem} 笔</li>
          <li>任我顺专属额度已使用 {data.comboStats.targetFriendQuotaUsed} 次</li>
          {(data.comboStats.byCombination ?? []).map((row) => <li key={row.combination}>{row.combination} · {row.count} 笔</li>)}
          <li>道具消耗：任我顺 {data.comboStats.consumed?.TARGET_FRIEND ?? 0} · 碌卡 {data.comboStats.consumed?.DOUBLE_AMOUNT ?? 0} · 十面埋伏 {data.comboStats.consumed?.EXTRA_SUSPECT ?? 0}</li>
          <li>组合失败原因：{Object.entries(data.comboStats.failureReasons ?? {}).map(([reason, count]) => `${reason} ${count}`).join(' · ') || '无'}</li>
        </ul>
        <p className="text-sm text-[var(--foreground-muted)]">组合笔数按顺取记录去重；同一笔三道具只计入一次金额结算。</p>
      </details>
      <details open><summary>匹配来源与活跃度命中分布 · {data.matchStats.day}</summary>
        <p>好友池命中 {data.matchStats.friendHits} 笔 / 全部 {data.matchStats.total} 笔 · 实际好友命中比例 {data.matchStats.friendRate}%</p>
        <p>配置的好友命中概率为 {data.config.friendChance}%，实际比例会因好友池为空或无合格好友而低于该值。</p>
        <ul>{data.matchStats.tiers.map((row) => <li key={row.tier}>{row.label} · {row.count} 笔</li>)}</ul>
        {data.matchStats.unknownTier > 0 && <p>另有 {data.matchStats.unknownTier} 笔发生在本次统计上线前的记录，未记录活跃度档位。</p>}
        <p className="text-sm text-[var(--foreground-muted)]">该统计仅管理员可见，前台不展示好友概率、目标池来源或活跃度抽样细节。</p>
      </details>
      <details><summary>好友池回退原因分布 · {data.matchStats.day}</summary>
        <ul>{(data.matchStats.fallbacks ?? []).map((row) => <li key={row.reason ?? 'used'}>{row.reason === null ? '好友池命中' : FALLBACK_LABELS[row.reason] ?? row.reason} · {row.count} 笔</li>)}</ul>
        {!(data.matchStats.fallbacks ?? []).some((row) => row.reason === null) && <p>当天没有任何一笔从好友池命中。</p>}
      </details>
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
      <ShunDiagnosePanel />
    </>}
  </main>
}
