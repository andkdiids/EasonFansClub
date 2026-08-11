'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type {
  CanonicalRegistrationControlMode,
  RegistrationAvailabilityPayload,
  RegistrationControlPayload,
  RegistrationDailyScheduleWindow,
} from '@/lib/registration'
import { formatBeijingDateTimeDisplay, validateRegistrationDailySchedule } from '@/lib/registration-availability'

type RegistrationControlFormProps = {
  initialControl: RegistrationControlPayload
  initialAvailability: RegistrationAvailabilityPayload
}

const modeOptions: Array<{ value: CanonicalRegistrationControlMode; label: string; description: string }> = [
  { value: 'MANUAL', label: '手动控制', description: '按照管理员操作立即开放或关闭注册。' },
  { value: 'DAILY_SCHEDULE', label: '每日定时', description: '按照每天固定的时间段自动开放和关闭注册。' },
  { value: 'ONE_TIME', label: '单次限时', description: '只在指定的日期时间范围内开放一次。' },
]

const modeLabels: Record<CanonicalRegistrationControlMode, string> = {
  MANUAL: '手动控制',
  DAILY_SCHEDULE: '每日定时',
  ONE_TIME: '单次限时',
}

const statusLabels: Record<RegistrationAvailabilityPayload['status'], string> = {
  CLOSED: '已关闭',
  WAITING: '等待开放',
  OPEN: '开放中',
  ENDED: '本次已结束',
}

const emptyDailyWindow = (): RegistrationDailyScheduleWindow => ({ start: '', end: '' })
const isOneTimeMode = (mode: string) => mode === 'ONE_TIME' || mode === 'SCHEDULED'

function parseBeijingInputTimestamp(value: string) {
  if (!value) return NaN
  return Date.parse(`${value}:00+08:00`)
}

function formatWindow(window: RegistrationDailyScheduleWindow) {
  return `${window.start}–${window.end}`
}

export function RegistrationControlForm({ initialControl, initialAvailability }: RegistrationControlFormProps) {
  const router = useRouter()
  const [control, setControl] = useState<RegistrationControlPayload>(() => ({
    ...initialControl,
    dailySchedule: initialControl.dailySchedule?.length
      ? initialControl.dailySchedule
      : initialControl.mode === 'DAILY_SCHEDULE'
        ? [emptyDailyWindow()]
        : [],
  }))
  const [availability, setAvailability] = useState(initialAvailability)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState('')

  function updateControl<Field extends 'mode' | 'opensAt' | 'closesAt' | 'dailySchedule'>(field: Field, value: RegistrationControlPayload[Field]) {
    setControl((current) => ({ ...current, [field]: value }))
    setMessage('')
    setError('')
  }

  function selectMode(mode: CanonicalRegistrationControlMode) {
    setControl((current) => ({
      ...current,
      mode,
      dailySchedule: mode === 'DAILY_SCHEDULE' && current.dailySchedule.length === 0 ? [emptyDailyWindow()] : current.dailySchedule,
    }))
    setMessage('')
    setError('')
  }

  function updateDailyWindow(index: number, field: keyof RegistrationDailyScheduleWindow, value: string) {
    const dailySchedule = control.dailySchedule.map((window, currentIndex) => currentIndex === index ? { ...window, [field]: value } : window)
    updateControl('dailySchedule', dailySchedule)
  }

  function addDailyWindow() {
    if (control.dailySchedule.length >= 10) return
    updateControl('dailySchedule', [...control.dailySchedule, emptyDailyWindow()])
  }

  function removeDailyWindow(index: number) {
    if (control.dailySchedule.length <= 1) return
    updateControl('dailySchedule', control.dailySchedule.filter((_, currentIndex) => currentIndex !== index))
  }

  async function save() {
    const oneTime = isOneTimeMode(control.mode)
    if (oneTime && (!control.opensAt || !control.closesAt)) {
      setError('单次限时开放必须填写开始时间和结束时间')
      return
    }
    if (oneTime && control.opensAt && control.closesAt && control.closesAt <= control.opensAt) {
      setError('结束时间必须晚于开始时间')
      return
    }
    if (control.mode === 'DAILY_SCHEDULE') {
      const dailyError = validateRegistrationDailySchedule(control.dailySchedule)
      if (dailyError) {
        setError(dailyError)
        return
      }
    }

    const ended = oneTime && parseBeijingInputTimestamp(control.closesAt) <= Date.now()
    const confirmEnded = ended && window.confirm('该注册时间段已经结束，请确认是否仍要保存。')
    if (ended && !confirmEnded) return

    setBusyAction('SAVE')
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/admin/security-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          registrationControl: {
            mode: control.mode,
            dailySchedule: control.mode === 'DAILY_SCHEDULE' ? control.dailySchedule : [],
            opensAt: oneTime ? control.opensAt : '',
            closesAt: oneTime ? control.closesAt : '',
          },
          confirmEnded,
        }),
      })
      const data = await response.json().catch(() => ({})) as {
        message?: string
        registrationControl?: RegistrationControlPayload
        availability?: RegistrationAvailabilityPayload
      }
      if (!response.ok || !data.registrationControl || !data.availability) {
        setError(data.message || '保存失败')
        return
      }
      setControl(data.registrationControl)
      setAvailability(data.availability)
      setMessage(data.message || '注册开放设置已保存并立即生效')
      router.refresh()
    } catch {
      setError('保存失败，请检查网络后重试')
    } finally {
      setBusyAction('')
    }
  }

  async function runAction(action: 'OPEN_NOW' | 'CLOSE_NOW' | 'STOP_SCHEDULED') {
    setBusyAction(action)
    setMessage('')
    setError('')
    try {
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
      if (!response.ok || !data.registrationControl || !data.availability) {
        setError(data.message || '操作失败')
        return
      }
      setControl(data.registrationControl)
      setAvailability(data.availability)
      setMessage(data.message || '操作已生效')
      router.refresh()
    } catch {
      setError('操作失败，请检查网络后重试')
    } finally {
      setBusyAction('')
    }
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
        {modeOptions.map((option) => (
          <label key={option.value} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${control.mode === option.value ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}>
            <input type="radio" name="registration-control-mode" checked={control.mode === option.value} onChange={() => selectMode(option.value)} className="mt-1" />
            <span className="min-w-0">
              <span className="block text-sm font-black text-brand-950">{option.label}</span>
              <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {control.mode === 'DAILY_SCHEDULE' ? (
        <div className="mt-5 space-y-4 rounded-2xl bg-sky-50/70 p-4">
          <div>
            <p className="text-sm font-black text-brand-950">每日开放时间段</p>
            <p className="mt-1 text-xs font-bold leading-5 text-slate-500">时间使用北京时间（Asia/Shanghai），支持跨午夜时段，例如 22:00–02:00；相邻时段可以连续排列。</p>
          </div>
          <div className="space-y-3">
            {control.dailySchedule.map((window, index) => (
              <div key={`daily-window-${index}`} className="grid gap-3 rounded-xl border border-sky-100 bg-white p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="text-xs font-black text-brand-950">
                  <span className="mb-1.5 block">开放时间</span>
                  <input type="time" value={window.start} onChange={(event) => updateDailyWindow(index, 'start', event.target.value)} className="block w-full rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-brand-700" />
                </label>
                <label className="text-xs font-black text-brand-950">
                  <span className="mb-1.5 block">关闭时间</span>
                  <input type="time" value={window.end} onChange={(event) => updateDailyWindow(index, 'end', event.target.value)} className="block w-full rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-brand-700" />
                </label>
                <button type="button" onClick={() => removeDailyWindow(index)} disabled={control.dailySchedule.length <= 1 || isBusy} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:cursor-not-allowed disabled:opacity-40">删除</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addDailyWindow} disabled={control.dailySchedule.length >= 10 || isBusy} className="rounded-xl border border-brand-200 bg-white px-4 py-2.5 text-sm font-black text-brand-800 disabled:cursor-not-allowed disabled:opacity-40">＋ 添加时间段</button>
          <p className="text-xs font-bold leading-5 text-slate-500">至少配置 1 个时段，最多 10 个；保存时会检查时间格式和重叠。</p>
        </div>
      ) : isOneTimeMode(control.mode) ? (
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

        {availability.mode === 'DAILY_SCHEDULE' ? (
          <div className="grid gap-2 border-t border-sky-100 pt-3 text-sm font-bold text-slate-600">
            <p>今日开放时段：{availability.dailySchedule.length ? availability.dailySchedule.map(formatWindow).join('、') : '未设置'}</p>
            <p>下一次状态变化：{availability.nextChangeAt ? `${formatBeijingDateTimeDisplay(availability.nextChangeAt)} ${availability.nextChangeType === 'OPEN' ? '自动开放' : '自动关闭'}` : '暂无'}</p>
            <p>时区：北京时间（Asia/Shanghai）</p>
          </div>
        ) : isOneTimeMode(availability.mode) ? (
          <div className="grid gap-2 border-t border-sky-100 pt-3 text-sm font-bold text-slate-600 sm:grid-cols-2">
            <p>开放时间：{formatBeijingDateTimeDisplay(availability.opensAt) || '未设置'}</p>
            <p>关闭时间：{formatBeijingDateTimeDisplay(availability.closesAt) || '未设置'}</p>
            <p className="sm:col-span-2">下一次状态变化：{availability.nextChangeAt ? `${formatBeijingDateTimeDisplay(availability.nextChangeAt)} ${availability.nextChangeType === 'OPEN' ? '自动开放' : '自动关闭'}` : '暂无'}</p>
            <p className="sm:col-span-2">时区：北京时间（Asia/Shanghai）</p>
          </div>
        ) : null}
        {control.mode !== 'DAILY_SCHEDULE' && control.override === 'OPEN' ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">当前已启用“立即开放”服务端覆盖。</p> : null}
        {control.mode !== 'DAILY_SCHEDULE' && control.override === 'CLOSED' ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700">当前已启用“立即关闭”服务端覆盖。</p> : null}
      </div>

      {control.mode === 'MANUAL' ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void runAction('OPEN_NOW')} disabled={isBusy} className="rounded-xl bg-brand-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">立即开放注册</button>
          <button type="button" onClick={() => void runAction('CLOSE_NOW')} disabled={isBusy} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 disabled:opacity-50">立即关闭注册</button>
        </div>
      ) : control.mode === 'ONE_TIME' ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void runAction('OPEN_NOW')} disabled={isBusy} className="rounded-xl bg-brand-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">立即开放</button>
          <button type="button" onClick={() => void runAction('CLOSE_NOW')} disabled={isBusy} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 disabled:opacity-50">立即关闭</button>
          <button type="button" onClick={() => void runAction('STOP_SCHEDULED')} disabled={isBusy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 disabled:opacity-50">切换为手动控制</button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void runAction('STOP_SCHEDULED')} disabled={isBusy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 disabled:opacity-50">切换为手动控制</button>
        </div>
      )}

      <button type="button" onClick={() => void save()} disabled={isBusy} className="mt-4 w-full rounded-2xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{busyAction === 'SAVE' ? '保存中…' : '保存设置'}</button>
      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">{error}</p> : null}
    </section>
  )
}
