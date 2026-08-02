'use client'

import { useState } from 'react'

type Config = {
  enabled: boolean
  questionCount: number
  audioSeconds: number
  passScore: number
  dailyLimit: number
}

export function EHospitalCheckSettingsForm({ initial }: { initial: Config }) {
  const [config, setConfig] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/admin/ehospital-check', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(config),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '保存失败')
      setConfig(data.config)
      setMessage('配置已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-brand-950">🏥 E院体检</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500">新用户必须通过音乐听力检查，服务端只保存答案判定，不向前台下发正确答案。</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-black text-brand-950">
          <input type="checkbox" checked={config.enabled} onChange={(event) => setConfig((current) => ({ ...current, enabled: event.target.checked }))} />
          开启 E院体检
        </label>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-black text-slate-700">
          每日次数
          <input type="number" min={1} max={20} value={config.dailyLimit} onChange={(event) => setConfig((current) => ({ ...current, dailyLimit: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" />
        </label>
        <label className="text-sm font-black text-slate-700">
          题目数量
          <input type="number" min={1} max={20} value={config.questionCount} onChange={(event) => setConfig((current) => ({ ...current, questionCount: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" />
        </label>
        <label className="text-sm font-black text-slate-700">
          单题秒数（固定）
          <input type="number" value={config.audioSeconds} readOnly className="mt-2 w-full rounded-xl border border-sky-100 bg-slate-50 px-3 py-2" />
        </label>
        <label className="text-sm font-black text-slate-700">
          通过分数
          <input type="number" min={0} value={config.passScore} onChange={(event) => setConfig((current) => ({ ...current, passScore: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" />
        </label>
      </div>

      <p className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-xs font-bold leading-5 text-sky-800">当前默认规则：10 题、每题 7 秒、答对 6 题（60 分）通过。音频时长固定为 7 秒，以确保只读取 REGISTER_CHECK 音频变体。</p>
      {message ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
      <button type="button" onClick={() => void save()} disabled={saving} className="mt-5 rounded-full bg-brand-700 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
        {saving ? '保存中…' : '保存配置'}
      </button>
    </section>
  )
}
