'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { RegistrationMode } from '@/lib/registration'

type Policy = {
  allowRegister: boolean
  registrationMode: RegistrationMode
  registrationModeLabel: string
  allowPhoneRegistration: boolean
  allowEmailRegistration: boolean
  registrationClosed: boolean
  enableTurnstile: boolean
  envForcedClosed: boolean
  registrationLimitEnabled: boolean
}

const options: { value: RegistrationMode; label: string; description: string }[] = [
  { value: 'PHONE', label: '仅手机号注册', description: '备案期间临时使用，不发送短信验证码。' },
  { value: 'EMAIL', label: '仅邮箱注册', description: '注册后必须完成邮箱验证。' },
  { value: 'BOTH', label: '手机号和邮箱均可注册', description: '注册页显示两种注册方式。' },
  { value: 'CLOSED', label: '暂停注册', description: '新用户无法注册，旧用户仍可登录。' },
]

export function RegistrationSettingsForm({ initialPolicy }: { initialPolicy: Policy }) {
  const router = useRouter()
  const [policy, setPolicy] = useState(initialPolicy)
  const [mode, setMode] = useState<RegistrationMode>(initialPolicy.registrationMode)
  const [registrationLimitEnabled, setRegistrationLimitEnabled] = useState(initialPolicy.registrationLimitEnabled)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function save() {
    if (mode !== policy.registrationMode && mode === 'PHONE' && !confirm('手机号注册暂不进行短信验证，用户可能填写非本人号码。确定继续吗？')) return
    if (mode !== policy.registrationMode && mode === 'CLOSED' && !confirm('关闭后新用户将无法注册，但不会影响已有用户登录。确定继续吗？')) return

    setMessage('')
    setError('')
    setIsSaving(true)
    const response = await fetch('/api/admin/registration-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationMode: mode, registrationLimitEnabled }),
    })
    const data = await response.json().catch(() => ({}))
    setIsSaving(false)
    if (!response.ok) {
      setError(data.message || '保存失败')
      return
    }
    setPolicy(data.policy)
    setRegistrationLimitEnabled(Boolean(data.policy.registrationLimitEnabled))
    setMessage(data.message || '注册模式已保存')
    router.refresh()
  }

  const hasChanges = mode !== policy.registrationMode || registrationLimitEnabled !== policy.registrationLimitEnabled

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
      <div>
        <p className="text-sm font-black tracking-[0.18em] text-brand-700">注册安全</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">注册模式设置</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600">
          注册方式不等于登录方式。切换注册模式只影响新用户注册，旧手机号用户仍可继续手机号登录。
        </p>
      </div>

      <div className="mt-5 grid gap-3">
        {options.map((item) => (
          <label key={item.value} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${mode === item.value ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}>
            <input type="radio" checked={mode === item.value} onChange={() => setMode(item.value)} className="mt-1" />
            <span>
              <span className="block text-sm font-black text-brand-950">{item.label}</span>
              <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">{item.description}</span>
            </span>
          </label>
        ))}
      </div>

      <label className={`mt-5 flex cursor-pointer gap-3 rounded-2xl border p-4 ${registrationLimitEnabled ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}>
        <input type="checkbox" checked={registrationLimitEnabled} onChange={(event) => setRegistrationLimitEnabled(event.target.checked)} className="mt-1 size-5" />
        <span>
          <span className="block text-sm font-black text-brand-950">注册限制</span>
          <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">
            {registrationLimitEnabled ? '开启后，同一 IP 每日最多成功发送 3 次注册验证码。' : '关闭后，不限制同一 IP 每日发送注册验证码次数。'}
          </span>
          <span className="mt-1 block text-xs font-black leading-5 text-slate-600">固定规则：每日体检最多 3 次，不受此开关影响。</span>
        </span>
      </label>

      <div className="mt-5 space-y-2 rounded-2xl bg-sky-50/70 p-4 text-sm font-bold text-slate-600">
        <p>当前注册模式：{policy.registrationModeLabel}</p>
        <p>环境总开关：{policy.allowRegister ? '允许注册' : '强制关闭注册'}</p>
        <p>Turnstile：{policy.enableTurnstile ? '已启用' : '未启用'}</p>
        <p>手机号验证：未启用短信验证</p>
        <p>注册限制：{registrationLimitEnabled ? '已开启' : '已关闭'}</p>
      </div>

      {policy.envForcedClosed ? (
        <p className="mt-4 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">
          注册已被服务器环境变量强制关闭，后台注册模式无法覆盖。
        </p>
      ) : null}

      {mode === 'PHONE' ? (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black text-amber-800">
          当前手机号注册未验证号码归属，请仅用于备案期间或受控测试。
        </p>
      ) : null}

      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">{error}</p> : null}

      <button
        onClick={save}
        disabled={isSaving || !hasChanges}
        className="mt-5 w-full rounded-2xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? '保存中...' : '保存注册设置'}
      </button>
    </section>
  )
}
