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
}

export function ShunItemAdmin() {
  const [report, setReport] = useState<Report>()
  const [draft, setDraft] = useState('')
  const [userId, setUserId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (id = '') => {
    setBusy(true)
    try {
      const query = new URLSearchParams(id ? { userId: id } : {})
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
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void load(userId.trim()) }}>
        <label>用户 ID <input className="border p-1" value={userId} onChange={(event) => setUserId(event.target.value)} /></label>
        <button type="submit" className="border px-3 py-1" disabled={busy}>查询库存和流水</button>
      </form>
      {([
        ['库存', report.stock], ['道具流水', report.entries], ['好友赠送', report.gifts],
        ['挂号费转移、追回及补偿', report.effects], ['库存对账差异', report.discrepancy],
        ['审计记录', report.audit], ['异常行为', report.abuse],
      ] as const).map(([label, value]) => <details key={label}>
        <summary>{label}</summary>
        <pre className="max-h-96 overflow-auto border p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
      </details>)}
    </>}
  </section>
}
