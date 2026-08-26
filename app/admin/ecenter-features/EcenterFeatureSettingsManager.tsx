'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UiIcon } from '@/components/UiIcon'
import type { EcenterFeatureItem } from '@/lib/ecenter-features'

export function EcenterFeatureSettingsManager({ initial }: Readonly<{ initial: EcenterFeatureItem[] }>) {
  const router = useRouter()
  const [features, setFeatures] = useState(() => initial.map((feature) => ({ ...feature })))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function move(index: number, offset: -1 | 1) {
    setFeatures((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next.map((feature, rowIndex) => ({ ...feature, sortOrder: rowIndex + 1 }))
    })
    setMessage('')
    setError('')
  }

  function toggle(featureKey: string) {
    setFeatures((current) => current.map((feature) => feature.featureKey === featureKey ? { ...feature, isEnabled: !feature.isEnabled } : feature))
    setMessage('')
    setError('')
  }

  async function save() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/admin/ecenter/features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: features.filter((feature) => feature.isManageable).map(({ featureKey, sortOrder, isEnabled }) => ({ featureKey, sortOrder, isEnabled })) }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '保存失败，请稍后重试')
      setFeatures(payload.features)
      setMessage(payload.message || 'E院中心设置已保存')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function restoreDefaults() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/admin/ecenter/features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '恢复默认失败，请稍后重试')
      setFeatures(payload.features)
      setMessage(payload.message || '已恢复默认配置')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '恢复默认失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100 pb-4">
        <div>
          <h2 className="text-xl font-black text-brand-950">入口顺序与状态</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">上移/下移后点击保存；停用只隐藏入口，不会关闭对应页面。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void restoreDefaults()} className="min-h-10 rounded-full border border-sky-200 px-4 text-xs font-black text-brand-700 disabled:opacity-50">恢复默认配置</button>
          <button type="button" disabled={busy} onClick={() => void save()} className="min-h-10 rounded-full bg-brand-950 px-5 text-xs font-black text-white disabled:opacity-50">{busy ? '保存中…' : '保存设置'}</button>
        </div>
      </div>

      {message ? <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700" role="alert">{error}</p> : null}

      <div className="mt-4 space-y-2" aria-label="E院中心功能入口列表">
        {features.map((feature, index) => (
          <article key={feature.featureKey} className="grid min-w-0 gap-3 rounded-2xl border border-sky-100 bg-sky-50/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-sm"><UiIcon name={feature.icon} /></span>
              <div className="min-w-0">
                <strong className="block break-words text-sm font-black text-brand-950">{feature.label}</strong>
                <span className="mt-0.5 block truncate text-[10px] font-bold tracking-[0.08em] text-slate-400">{feature.featureKey} · {feature.href}</span>
                {feature.requiresAdmin ? <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">仅有后台权限的管理员可见</span> : null}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <span className="text-xs font-black text-slate-500">第 {index + 1} 位</span>
              <div className="flex gap-1">
                <button type="button" aria-label={`上移${feature.label}`} disabled={busy || !feature.isManageable || index === 0} onClick={() => move(index, -1)} className="grid size-9 place-items-center rounded-lg border border-sky-200 bg-white text-sm font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-35">↑</button>
                <button type="button" aria-label={`下移${feature.label}`} disabled={busy || !feature.isManageable || index === features.length - 1} onClick={() => move(index, 1)} className="grid size-9 place-items-center rounded-lg border border-sky-200 bg-white text-sm font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-35">↓</button>
              </div>
            </div>
            <label className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-white px-3 text-xs font-black text-brand-950 sm:min-w-24">
              <span>{feature.isEnabled ? '开启' : '停用'}</span>
              <input type="checkbox" checked={feature.isEnabled} disabled={busy || !feature.isManageable} onChange={() => toggle(feature.featureKey)} className="size-4 accent-sky-700" />
            </label>
          </article>
        ))}
      </div>
    </section>
  )
}
