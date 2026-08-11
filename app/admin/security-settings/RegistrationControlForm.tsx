'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type {
  RegistrationAvailabilityPayload,
  RegistrationControlMode,
  RegistrationControlPayload,
} from '@/lib/registration'
import { formatBeijingDateTimeDisplay } from '@/lib/registration-availability'

type RegistrationControlFormProps = {
  initialControl: RegistrationControlPayload
  initialAvailability: RegistrationAvailabilityPayload
}

const modeLabels: Record<RegistrationControlMode, string> = {
  MANUAL: '手动控制',
  SCHEDULED: '限时开放',
}

const statusLabels: Record<RegistrationAvailabilityPayload['status'], string> = {
  CLOSED: '已关闭',
  WAITING: '等待开放',
  OPEN: '开放中',
  ENDED: '本轮已结束',
}

function parseBeijingInputTimestamp(value: string) {
  if (!value) return NaN
  return Date.parse(`${value}:00+08:00`)
}

export function RegistrationControlForm({ initialControl, initialAvailability }: RegistrationControlFormProps) {
  const router = useRouter()
  const [control, setControl] = useState(initialControl)
  const [availability, setAvailability] = useState(initialAvailability)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState('')

  function updateControl<Field extends 'mode' | 'opensAt' | 'closesAt'>(field: Field, value: RegistrationControlPayload[Field]) {
    setControl((current) => ({ ...current, [field]: value }))
    setMessage('')
    setError('')
  }

  async function save() {
    if (control.mode === 'SCHEDULED') {
      if (!control.opensAt || !control.closesAt) {
        setError('限时开放必须填写开始时间和结束时间')
        return
      }
      if (control.closesAt <= control.opensAt) {
        setError('结束时间必须晚于开始时间')
        return
      }
    }

    const ended = control.mode === 'SCHEDULED' && parseBeijingInputTimestamp(control.closesAt) <= Date.now()
    const confirmEnded = ended && window.confirm('该注册时间段已经结束，请确认是否仍要保存。')
    if (ended && !confirmEnded) return

    setBusyAction('SAVE')
    setMessage('')
    setError('')
    const response = await fetch('/api/admin/security-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ registrationControl: { mode: control.mode, opensAt: control.opensAt, closesAt: control.closesAt }, confirmEnded }),
    })
    const data = await response.json().catch(() => ({})) as {
      message?: string
      registrationControl?: RegistrationControlPayload
      availability?: RegistrationAvailabilityPayload
    }
    setBusyAction('')
    if (!response.ok || !data.registrationControl || !data.availability) {
      setError(data.message || '保存失败')
      return
    }
    setControl(data.registrationControl)
    setAvailability(data.availability)
    setMessage(data.message || '注册开放设置已保存并立即生效')
    router.refresh()
  }

  async function runAction(action: 'OPEN_NOW' | 'CLOSE_NOW' | 'STOP_SCHEDULED') {
    setBusyAction(action)
    setMessage('')
    setError('')
    const response = await fetch('/api/admin/security-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ registrationControlAction: action }),
    })
    const data = await response.json().catch(() => ({})) as {
      message?: string
      registrationControl?: RegistrationControlPayload
      availability?: RegistrationAvailabilityPayload
    }
    setBusyAction('')
    if (!response.ok || !data.registrationControl || !data.availability) {
      setError(data.message || '操作失败')
      return
    }
    setControl(data.registrationControl)
    setAvailability(data.availability)
    setMessage(data.message || '操作已生效')
    router.refresh()
  }

  const isBusy = Boolean(busyAction)
  const statusLabel = statusLabels[availability.status]
  const statusTone = availability.status === 'OPEN'
    ? 'bg-emerald-50 text-emerald-700'
    : availability.status === 'WAITING'
      ? 'bg-amber-50 text-amber-800'
      : 'bg-slate-100 text-slate-700'

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white p-6 shadow-sm">
      <div>
        <p className="text-sm font-black tracking-[0.18em] text-brand-700">注册开放控制</p>
        <h2 className="mt-2 text-2xl font-black text-brand-950">注册开放控制</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">设置私家E院注册入口的开放方式与开放时间。</p>
      </div>

      <fieldset className="mt-5 space-y-3">
        <legend className="text-sm font-black text-brand-950">注册开放模式</legend>
        {(['MANUAL', 'SCHEDULED'] as const).map((mode) => (
          <label key={mode} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${control.mode === mode ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}>
            <input type="radio" name="registration-control-mode" checked={control.mode === mode} onChange={() => updateControl('mode', mode)} className="mt-1" />
            <span className="min-w-0">
              <span className="block text-sm font-black text-brand-950">{modeLabels[mode]}</span>
              <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">
                {mode === 'MANUAL' ? '按照管理员操作立即开放或关闭注册。' : '按照北京时间自动开放，并在结束时间自动关闭。'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {control.mode === 'SCHEDULED' ? (
        <div className="mt-5 space-y-4 rounded-2xl bg-sky-50/70 p-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-black text-brand-950">
              <span className="mb-2 block">开始时间</span>
              <input type="datetime-local" value={control.opensAt} onChange={(event) => updateControl('opensAt', event.target.value)} className="block w-full min-w-0 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none" />
            </label>
            <label className="min-w-0 text-sm font-black text-brand-950">
              <span className="mb-2 block">结束时间</span>
              <input type="datetime-local" value={control.closesAt} onChange={(event) => updateControl('closesAt', event.target.value)} className="block w-full min-w-0 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none" />
            </label>
          </div>
          <p className="text-xs font-black text-slate-600">时区：北京时间（Asia/Shanghai）</p>
          <p className="text-xs font-bold leading-5 text-slate-500">注册入口将在开始时间自动开放，并在结束时间自动关闭。</p>
        </div>
      ) : null}

      <div className="mt-5 space-y-3 rounded-2xl border border-sky-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black text-slate-500">当前模式</p>
            <p className="mt-1 text-sm font-black text-brand-950">{modeLabels[availability.mode]}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-black text-slate-500">当前注册状态</p>
            <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-black ${statusTone}`}>{statusLabel}</span>
          </div>
        </div>
        {control.mode === 'SCHEDULED' ? (
          <div className="grid gap-2 border-t border-sky-100 pt-3 text-sm font-bold text-slate-600 sm:grid-cols-2">
            <p>开放时间：{formatBeijingDateTimeDisplay(availability.opensAt) || '未设置'}</p>
            <p>关闭时间：{formatBeijingDateTimeDisplay(availability.closesAt) || '未设置'}</p>
            <p className="sm:col-span-2">时区：北京时间</p>
          </div>
        ) : null}
        {control.override === 'OPEN' ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">当前已启用“立即开放”服务端覆盖。</p> : null}
        {control.override === 'CLOSED' ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700">当前已启用“立即关闭”服务端覆盖。</p> : null}
      </div>

      {control.mode === 'MANUAL' ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void runAction('OPEN_NOW')} disabled={isBusy} className="rounded-xl bg-brand-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">立即开放注册</button>
          <button type="button" onClick={() => void runAction('CLOSE_NOW')} disabled={isBusy} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 disabled:opacity-50">立即关闭注册</button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void runAction('OPEN_NOW')} disabled={isBusy} className="rounded-xl bg-brand-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">立即开放</button>
          <button type="button" onClick={() => void runAction('CLOSE_NOW')} disabled={isBusy} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 disabled:opacity-50">立即关闭</button>
          <button type="button" onClick={() => void runAction('STOP_SCHEDULED')} disabled={isBusy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 disabled:opacity-50">停止限时开放</button>
        </div>
      )}

      <button type="button" onClick={() => void save()} disabled={isBusy} className="mt-4 w-full rounded-2xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{busyAction === 'SAVE' ? '保存中...' : '保存设置'}</button>
      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">{error}</p> : null}
    </section>
  )
}
