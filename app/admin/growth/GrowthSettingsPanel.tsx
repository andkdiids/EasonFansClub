'use client'

import { useState } from 'react'

type GrowthLevel = {
  level: number
  name: string
  requiredExp: number
}

export function GrowthSettingsPanel({
  initialLevels,
  dailyExpLimit,
  taskCount,
}: {
  initialLevels: GrowthLevel[]
  dailyExpLimit: number
  taskCount: number
}) {
  const [levels, setLevels] = useState(initialLevels)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function updateLevel(index: number, patch: Partial<GrowthLevel>) {
    setLevels((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)))
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/admin/growth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levels }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '成长等级配置保存失败')
      setLevels(Array.isArray(data.levels) ? data.levels : levels)
      setMessage(data.message || '成长等级配置已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '成长等级配置保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/88 p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Growth System</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">成长系统管理</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">
            当前每日经验上限为 {dailyExpLimit} XP。任务系统数据结构已就绪，当前共有 {taskCount} 个任务配置；任务中的 points 字段在业务与界面中统一表示“奖励挂号费”。
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-brand-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-brand-800 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存等级配置'}
        </button>
      </div>

      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4"><span className="text-xs font-black text-slate-500">签到奖励挂号费</span><strong className="mt-1 block text-xl text-brand-950">随机 3～7</strong></div>
        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4"><span className="text-xs font-black text-slate-500">普通挂号费日上限</span><strong className="mt-1 block text-xl text-brand-950">30</strong></div>
        <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4"><span className="text-xs font-black text-slate-500">长期患者额外奖励</span><strong className="mt-1 block text-xl text-brand-950">第 7 天起 +7</strong></div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-sky-100">
        <div className="grid grid-cols-[70px_minmax(0,1fr)_130px] bg-sky-50 px-4 py-2 text-xs font-black text-slate-500">
          <span>等级</span>
          <span>等级名称</span>
          <span>所需经验</span>
        </div>
        <div className="divide-y divide-sky-100">
          {levels.map((item, index) => (
            <div key={item.level} className="grid grid-cols-[70px_minmax(0,1fr)_130px] items-center gap-3 px-4 py-2">
              <span className="text-sm font-black text-brand-950">Lv.{item.level}</span>
              <input
                value={item.name}
                onChange={(event) => updateLevel(index, { name: event.target.value })}
                className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-brand-300"
              />
              <input
                type="number"
                min={item.level === 1 ? 0 : 1}
                value={item.requiredExp}
                onChange={(event) => updateLevel(index, { requiredExp: Number(event.target.value) })}
                className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-brand-300"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
