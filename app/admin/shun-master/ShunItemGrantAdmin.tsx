'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type PreviewItem = { code: string; name: string; rarity: string; enabled: boolean }
type Task = {
  id: string; status: string; reason: string; notify: boolean; createdBy: string
  createdAt: string; startedAt: string | null; finishedAt: string | null; cancelledAt: string | null
  totalUsers: number; totalItems: number; succeededUsers: number; failedUsers: number
  skippedUsers: number; grantedItems: number
  items: { code: string; name: string; quantity: number }[]
}
type Overview = {
  enabled: boolean; users?: number; items?: PreviewItem[]; tasks?: Task[]
  detail?: { task: Task; failures: { userId: string; status: string; failureReason: string | null }[] } | null
}

const statusLabel: Record<string, string> = {
  PENDING: '待执行', RUNNING: '执行中', COMPLETED: '已完成', PARTIAL_FAILED: '部分失败', CANCELLED: '已取消',
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
}

export function ShunItemGrantAdmin() {
  const [data, setData] = useState<Overview>()
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState<Overview['detail']>()

  const load = useCallback(async (taskId?: string) => {
    setBusy(true)
    try {
      const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''
      const response = await fetch('/api/admin/shun-master/item-grants' + query, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      setData(body)
      if (body.detail) setDetail(body.detail)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败。')
    } finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const selected = useMemo(() => Object.entries(quantities).filter(([, quantity]) => quantity > 0), [quantities])
  const perUser = selected.reduce((sum, [, quantity]) => sum + quantity, 0)
  const users = data?.users ?? 0
  const totalItems = users * perUser

  async function submit() {
    if (!idempotencyKey) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/shun-master/item-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selected.map(([code, quantity]) => ({ code, quantity })),
          reason, notify, idempotencyKey,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      setMessage(`发放任务 ${body.task.id} 已创建（${body.reused ? '幂等复用已有任务' : '新建'}），后台将分批执行。`)
      setConfirming(false)
      setIdempotencyKey('')
      setQuantities({})
      setReason('')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建失败。')
    } finally { setBusy(false) }
  }

  async function act(taskId: string, action: 'cancel' | 'retry') {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/shun-master/item-grants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      setMessage(action === 'cancel' ? '未处理部分已取消，已发放道具不受影响。' : `已重新排入 ${body.retried ?? 0} 位用户的失败记录。`)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。')
    } finally { setBusy(false) }
  }

  if (data && !data.enabled) return <section className="mx-auto my-6 max-w-6xl border p-4">顺大师道具功能未开启。</section>

  return <section className="mx-auto my-6 max-w-6xl space-y-4 border p-4" aria-labelledby="shun-item-grant-title">
    <h2 id="shun-item-grant-title" className="text-xl font-semibold">道具发放</h2>
    {message && <p role="status">{message}</p>}
    <p className="text-sm">
      符合发放条件的用户：<strong>{users}</strong> 人（全站有效注册用户，排除已注销、已删除与系统账号）
    </p>
    <table className="w-full text-sm">
      <thead><tr><th className="text-left">道具</th><th className="text-left">稀有度</th><th className="text-left">每位用户数量</th></tr></thead>
      <tbody>
        {(data?.items ?? []).map((item) => <tr key={item.code}>
          <td>{item.name}{item.enabled ? '' : '（已停用）'}</td>
          <td>{item.rarity}</td>
          <td>
            <input className="w-20 border p-1" type="number" min={0} max={99} value={quantities[item.code] ?? 0}
              aria-label={`${item.name} 发放数量`}
              onChange={(event) => {
                const next = Math.max(0, Math.min(99, Number(event.target.value) || 0))
                setQuantities((current) => ({ ...current, [item.code]: next }))
                setConfirming(false)
              }} />
          </td>
        </tr>)}
      </tbody>
    </table>
    <label className="block">发放原因（用户可见）
      <input className="mt-1 block w-full border p-2" maxLength={60} value={reason}
        onChange={(event) => { setReason(event.target.value); setConfirming(false) }} />
    </label>
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={notify} onChange={(event) => { setNotify(event.target.checked); setConfirming(false) }} />
      发送站内奖励通知（同一任务合并为一条）
    </label>

    {!confirming ? <button type="button" className="border px-3 py-1"
      disabled={busy || !selected.length || !reason.trim()}
      onClick={() => { setConfirming(true); setIdempotencyKey(crypto.randomUUID()) }}>
      预览并确认发放
    </button> : <div className="space-y-2 border p-3">
      <p className="font-semibold">请确认本次发放</p>
      <p>发放道具：{selected.map(([code, quantity]) => `${data?.items?.find((item) => item.code === code)?.name ?? code}×${quantity}`).join('、')}</p>
      <p>预计发放用户：{users.toLocaleString('zh-CN')} 人</p>
      <p>每位用户获得：{perUser} 个</p>
      <p>预计发放总量：{totalItems.toLocaleString('zh-CN')} 个</p>
      <p>发放原因：{reason}</p>
      <p>站内通知：{notify ? '发送' : '不发送'}</p>
      <div className="flex gap-2">
        <button type="button" className="border px-3 py-1" disabled={busy} onClick={() => void submit()}>确认创建任务</button>
        <button type="button" className="border px-3 py-1" disabled={busy} onClick={() => setConfirming(false)}>返回修改</button>
      </div>
    </div>}

    <h3 className="text-lg font-semibold">发放历史</h3>
    {!data?.tasks?.length && <p className="text-sm">暂无发放任务。</p>}
    {!!data?.tasks?.length && <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead><tr>
          {['任务', '状态', '道具', '原因', '用户数', '成功', '失败', '跳过', '实发', '创建时间', '操作'].map((label) => <th key={label} className="text-left">{label}</th>)}
        </tr></thead>
        <tbody>
          {data.tasks.map((task) => <tr key={task.id}>
            <td className="font-mono">{task.id.slice(-8)}</td>
            <td>{statusLabel[task.status] ?? task.status}</td>
            <td>{task.items.map((item) => `${item.name}×${item.quantity}`).join('、')}</td>
            <td>{task.reason}</td>
            <td>{task.totalUsers}</td>
            <td>{task.succeededUsers}</td>
            <td>{task.failedUsers}</td>
            <td>{task.skippedUsers}</td>
            <td>{task.grantedItems}</td>
            <td>{formatTime(task.createdAt)}</td>
            <td className="space-x-2 whitespace-nowrap">
              <button type="button" className="border px-2" disabled={busy} onClick={() => void load(task.id)}>详情</button>
              {task.status !== 'COMPLETED' && task.status !== 'CANCELLED' &&
                <button type="button" className="border px-2" disabled={busy} onClick={() => void act(task.id, 'cancel')}>取消</button>}
              {task.failedUsers > 0 &&
                <button type="button" className="border px-2" disabled={busy} onClick={() => void act(task.id, 'retry')}>重试失败</button>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    {detail && <div className="space-y-1 border p-3 text-xs">
      <p className="font-semibold">任务 {detail.task.id} 明细</p>
      <p>开始：{formatTime(detail.task.startedAt)} · 完成：{formatTime(detail.task.finishedAt)}</p>
      {!detail.failures.length && <p>没有失败或跳过记录。</p>}
      {!!detail.failures.length && <table className="w-full">
        <thead><tr><th className="text-left">用户</th><th className="text-left">状态</th><th className="text-left">原因</th></tr></thead>
        <tbody>{detail.failures.map((row) => <tr key={row.userId}>
          <td className="font-mono">{row.userId.slice(-8)}</td>
          <td>{statusLabel[row.status] ?? row.status}</td>
          <td>{row.failureReason ?? '—'}</td>
        </tr>)}</tbody>
      </table>}
    </div>}
  </section>
}
