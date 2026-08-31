'use client'

import { useState } from 'react'
import {
  getProfileRecordLabel,
  type ProfileRecordPreference,
  type ProfileRecordSectionKey,
} from '@/lib/profile-record-sections'

type Props = {
  initialPreferences: readonly ProfileRecordPreference[]
  onSaved: (preferences: ProfileRecordPreference[]) => void
}

function orderedCopy(preferences: readonly ProfileRecordPreference[]) {
  return [...preferences].sort((left, right) => left.order - right.order).map((preference, index) => ({ ...preference, order: index + 1 }))
}

export function ProfileRecordSettings({ initialPreferences, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [preferences, setPreferences] = useState(() => orderedCopy(initialPreferences))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= preferences.length || saving) return
    setPreferences((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return orderedCopy(next)
    })
    setNotice('')
  }

  function toggle(section: ProfileRecordSectionKey) {
    if (saving) return
    setPreferences((current) => current.map((preference) => preference.key === section ? { ...preference, visible: !preference.visible } : preference))
    setNotice('')
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    const next = orderedCopy(preferences)
    try {
      const response = await fetch('/api/profile/record-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ sections: next.map(({ key, order, visible }) => ({ key, order, visible })) }),
      })
      const data = await response.json().catch(() => null) as { sections?: ProfileRecordPreference[]; message?: string } | null
      if (!response.ok || !Array.isArray(data?.sections)) throw new Error(data?.message || '个人记录设置保存失败，请稍后重试')
      const saved = orderedCopy(data.sections)
      setPreferences(saved)
      onSaved(saved)
      setNotice('个人记录设置已更新')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '个人记录设置保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return <div className="mb-3 rounded-xl border border-sky-100 bg-sky-50/50 p-2.5 sm:p-3">
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="inline-flex min-h-9 items-center rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-black text-brand-700 transition hover:bg-sky-50">
      {open ? '收起记录管理' : '管理记录'}
    </button>
    {open ? <div className="mt-3 space-y-2" aria-label="个人记录管理">
      <p className="text-xs font-bold leading-5 text-slate-500">调整记录分区顺序，或隐藏它们在公开主页中的入口。隐藏不会删除任何内容。</p>
      {preferences.map((preference, index) => {
        const label = getProfileRecordLabel(preference.key, true)
        return <div key={preference.key} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-sky-100 bg-white px-2.5 py-2">
          <span className="min-w-0 flex-1 break-words text-sm font-black text-brand-950">{label}</span>
          {!preference.visible ? <span className="text-[11px] font-black text-slate-400">公开主页隐藏</span> : null}
          <button type="button" aria-label={`上移${label}`} disabled={index === 0 || saving} onClick={() => move(index, -1)} className="rounded border border-sky-100 px-2 py-1 text-xs font-black text-brand-700 disabled:opacity-40">↑</button>
          <button type="button" aria-label={`下移${label}`} disabled={index === preferences.length - 1 || saving} onClick={() => move(index, 1)} className="rounded border border-sky-100 px-2 py-1 text-xs font-black text-brand-700 disabled:opacity-40">↓</button>
          <button type="button" role="switch" aria-label={`${label}${preference.visible ? '已显示' : '已隐藏'}`} aria-checked={preference.visible} disabled={saving} onClick={() => toggle(preference.key)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${preference.visible ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'} disabled:opacity-50`}>{preference.visible ? '显示' : '隐藏'}</button>
        </div>
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-brand-950 px-3 py-2 text-xs font-black text-white disabled:cursor-wait disabled:opacity-60">{saving ? '保存中…' : '保存设置'}</button>
        {notice ? <span role="status" className="text-xs font-black text-emerald-700">{notice}</span> : null}
        {error ? <span role="alert" className="text-xs font-black text-red-600">{error}</span> : null}
      </div>
    </div> : null}
  </div>
}
