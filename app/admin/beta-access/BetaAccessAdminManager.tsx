'use client'

import { useEffect, useMemo, useState } from 'react'

type Activation = {
  id: string
  status: 'ACTIVE' | 'REVOKED'
  activatedAt: string
  lastVerifiedAt: string | null
  revokedAt: string | null
}

type Invite = {
  id: string
  maskedCode: string
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED'
  maxActivations: number
  activationCount: number
  expiresAt: string | null
  createdAt: string
  lastActivationAt: string | null
  Activations: Activation[]
}

type Config = { betaAccessRequired: boolean }

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function statusText(status: Invite['status']) {
  return ({ ACTIVE: '可用', USED: '已用尽', EXPIRED: '已过期', REVOKED: '已撤销' } as const)[status]
}

function statusClass(status: Invite['status']) {
  return status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : status === 'REVOKED' || status === 'EXPIRED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
}

export function BetaAccessAdminManager() {
  const [config, setConfig] = useState<Config | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [quantity, setQuantity] = useState('1')
  const [maxActivations, setMaxActivations] = useState('1')
  const [expiresAt, setExpiresAt] = useState('')
  const [freshCodes, setFreshCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const activeLabel = useMemo(() => config?.betaAccessRequired ? '已开启：需要内测资格' : '已关闭：暂不要求内测资格', [config])

  async function load() {
    const response = await fetch('/api/admin/beta-access', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.message || '内测准入数据加载失败')
    setConfig(payload.config || null)
    setInvites(Array.isArray(payload.invites) ? payload.invites : [])
  }

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : '加载失败')) }, [])

  async function toggle() {
    if (!config) return
    const enabled = !config.betaAccessRequired
    const prompt = enabled
      ? '开启后，所有未验证 Android 安装实例都必须输入有效内测码。确认开启？'
      : '关闭后，Android App 将暂时跳过内测准入校验，但已有资格数据会保留。确认关闭？'
    if (!window.confirm(prompt)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/admin/beta-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', enabled, confirm: true }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '内测开关更新失败')
      setConfig(payload.config)
      setMessage(enabled ? 'Android 内测准入已开启。' : 'Android 内测准入已关闭；已有资格数据未删除。')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '内测开关更新失败') } finally { setBusy(false) }
  }

  async function createCodes() {
    setBusy(true); setError(''); setMessage(''); setFreshCodes([])
    try {
      const response = await fetch('/api/admin/beta-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', quantity: Number(quantity), maxActivations: Number(maxActivations), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '内测码创建失败')
      const rawCodes = Array.isArray(payload.codes) ? payload.codes as unknown[] : []
      const codes = rawCodes.reduce<string[]>((result, item: unknown) => {
            if (item && typeof item === 'object' && typeof (item as { code?: unknown }).code === 'string') result.push((item as { code: string }).code)
            return result
          }, [])
      setFreshCodes(codes)
      setMessage('内测码已创建。请立即复制并安全发送给受邀测试用户；离开页面后无法恢复完整码。')
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '内测码创建失败') } finally { setBusy(false) }
  }

  async function revokeInvite(invite: Invite) {
    if (!window.confirm(`确认撤销 ${invite.maskedCode}？其下已有设备资格也会立即失效。`)) return
    await mutate(`/api/admin/beta-access/invites/${invite.id}`, '内测码已撤销。')
  }

  async function revokeActivation(activation: Activation) {
    if (!window.confirm('确认撤销这台设备的内测资格？下次联网验证时该 App 将回到内测验证页。')) return
    await mutate(`/api/admin/beta-access/activations/${activation.id}`, '设备内测资格已撤销。')
  }

  async function mutate(url: string, success: string) {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(url, { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '操作失败')
      setMessage(success)
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败') } finally { setBusy(false) }
  }

  async function copyCodes() {
    if (!freshCodes.length) return
    try { await navigator.clipboard.writeText(freshCodes.join('\n')); setMessage('完整内测码已复制到剪贴板。') } catch { setError('复制失败，请手动复制显示的内测码。') }
  }

  return (
    <section className="space-y-6" aria-busy={busy}>
      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}

      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Global Gate</p><h2 className="mt-2 text-2xl font-black text-brand-950">Android 内测总开关</h2><p className="mt-2 text-sm font-bold text-slate-500">{activeLabel}</p></div>
          <button type="button" disabled={!config || busy} onClick={() => void toggle()} className={`min-h-11 rounded-full px-5 text-sm font-black text-white disabled:opacity-50 ${config?.betaAccessRequired ? 'bg-amber-600' : 'bg-brand-950'}`}>{config?.betaAccessRequired ? '关闭准入' : '开启准入'}</button>
        </div>
        <p className="mt-4 text-xs font-bold leading-5 text-slate-400">关闭只改变当前入口校验，不会删除历史邀请码、设备激活或 SecureStore 中的本机资格。</p>
      </section>

      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-7">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Create Invites</p><h2 className="mt-2 text-2xl font-black text-brand-950">生成内测码</h2></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[150px_180px_minmax(0,1fr)_auto]">
          <label className="text-xs font-black text-slate-500">数量<select value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"><option value="1">1 个</option><option value="10">10 个</option><option value="50">50 个</option><option value="100">100 个</option></select></label>
          <label className="text-xs font-black text-slate-500">每码最大设备数<input type="number" min="1" max="100" value={maxActivations} onChange={(event) => setMaxActivations(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold" /></label>
          <label className="text-xs font-black text-slate-500">有效期（可选）<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold" /></label>
          <button type="button" disabled={busy} onClick={() => void createCodes()} className="self-end rounded-xl bg-brand-950 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy ? '处理中…' : '生成内测码'}</button>
        </div>
        {freshCodes.length ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-black text-amber-900">完整内测码（仅本次显示）</p><button type="button" onClick={() => void copyCodes()} className="rounded-full bg-amber-900 px-4 py-2 text-xs font-black text-white">复制全部</button></div><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-white/80 p-3 text-sm font-black tracking-wide text-brand-950">{freshCodes.join('\n')}</pre></div> : null}
      </section>

      <section className="overflow-hidden rounded-[28px] border border-sky-100 bg-white/90 shadow-sm">
        <div className="border-b border-sky-100 px-6 py-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Invite Inventory</p><h2 className="mt-2 text-2xl font-black text-brand-950">内测码与设备激活</h2></div>
        <div className="divide-y divide-sky-50">
          {invites.map((invite) => <article key={invite.id} className="space-y-3 px-6 py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-brand-950">{invite.maskedCode}</p><p className="mt-1 text-xs font-bold text-slate-500">创建于 {formatDate(invite.createdAt)} · 有效期 {formatDate(invite.expiresAt)}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(invite.status)}`}>{statusText(invite.status)}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{invite.activationCount} / {invite.maxActivations} 台</span>{invite.status !== 'REVOKED' ? <button type="button" disabled={busy} onClick={() => void revokeInvite(invite)} className="rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-700 disabled:opacity-50">撤销</button> : null}</div></div>{invite.Activations.length ? <div className="grid gap-2 sm:grid-cols-2">{invite.Activations.map((activation) => <div key={activation.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-xs"><div><p className="font-black text-slate-700">设备资格：{activation.status === 'ACTIVE' ? '有效' : '已撤销'}</p><p className="mt-1 font-bold text-slate-400">激活 {formatDate(activation.activatedAt)} · 最近验证 {formatDate(activation.lastVerifiedAt)}</p></div>{activation.status === 'ACTIVE' ? <button type="button" disabled={busy} onClick={() => void revokeActivation(activation)} className="shrink-0 rounded-full bg-red-50 px-3 py-1.5 font-black text-red-700 disabled:opacity-50">撤销设备</button> : null}</div>)}</div> : <p className="text-xs font-bold text-slate-400">尚未激活设备。</p>}</article>)}
          {!invites.length ? <p className="px-6 py-12 text-center text-sm font-bold text-slate-400">暂无内测码，请先生成。</p> : null}
        </div>
      </section>
    </section>
  )
}
