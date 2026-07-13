'use client'

import { useEffect, useRef, useState } from 'react'
import { FormError } from '@/components/FormError'
import type { RegistrationMode, RegistrationType } from '@/lib/registration'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string
      reset: (widgetId?: string) => void
    }
  }
}

type RegisterPolicy = {
  allowRegister: boolean
  registrationMode: RegistrationMode
  registrationModeLabel: string
  allowPhoneRegistration: boolean
  allowEmailRegistration: boolean
  registrationClosed: boolean
  enableTurnstile: boolean
  turnstileSiteKey: string
  envForcedClosed: boolean
}

type RegisterErrors = Partial<{
  password: string
  confirmPassword: string
  nickname: string
  email: string
  phone: string
  acceptedAgreement: string
  turnstileToken: string
  registrationType: string
  form: string
}>

export function RegisterForm({ policy }: { policy: RegisterPolicy }) {
  const initialType: RegistrationType = policy.allowEmailRegistration ? 'EMAIL' : 'PHONE'
  const [registrationType, setRegistrationType] = useState<RegistrationType>(initialType)
  const [form, setForm] = useState({
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    acceptedAgreement: false,
  })
  const [turnstileToken, setTurnstileToken] = useState('')
  const [errors, setErrors] = useState<RegisterErrors>({})
  const [message, setMessage] = useState('')
  const [devVerificationUrl, setDevVerificationUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string>('')
  const showTabs = policy.allowPhoneRegistration && policy.allowEmailRegistration
  const shouldRenderTurnstile = policy.enableTurnstile && policy.turnstileSiteKey && !policy.registrationClosed

  useEffect(() => {
    if (!shouldRenderTurnstile || !turnstileRef.current || widgetIdRef.current) return

    const render = () => {
      if (!window.turnstile || !turnstileRef.current || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: policy.turnstileSiteKey,
        callback: setTurnstileToken,
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      })
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]')
    if (existing) {
      render()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = 'true'
    script.onload = render
    document.head.appendChild(script)
  }, [policy.turnstileSiteKey, shouldRenderTurnstile])

  function updateField(field: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function switchType(type: RegistrationType) {
    setRegistrationType(type)
    setErrors((current) => ({
      form: current.form,
      nickname: current.nickname,
      password: current.password,
      confirmPassword: current.confirmPassword,
      acceptedAgreement: current.acceptedAgreement,
      turnstileToken: current.turnstileToken,
    }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setMessage('')
    setDevVerificationUrl('')

    if (shouldRenderTurnstile && !turnstileToken) {
      setErrors({ turnstileToken: '请先完成人机验证' })
      return
    }

    setIsSubmitting(true)
    const payload = {
      registrationType,
      nickname: form.nickname,
      password: form.password,
      confirmPassword: form.confirmPassword,
      acceptedAgreement: form.acceptedAgreement,
      turnstileToken,
      ...(registrationType === 'PHONE' ? { phone: form.phone } : { email: form.email }),
    }
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)
    window.turnstile?.reset(widgetIdRef.current)
    setTurnstileToken('')

    if (!response.ok) {
      setErrors({ form: data.message, ...data.errors })
      return
    }

    setMessage(data.message || '注册成功')
    setDevVerificationUrl(data.devVerificationUrl || '')
    setForm({ phone: '', email: '', password: '', confirmPassword: '', nickname: '', acceptedAgreement: false })
  }

  if (policy.registrationClosed) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 text-sm font-bold leading-7 text-amber-800">
          网站目前处于内测阶段，暂未开放注册，请关注后续公告。
        </div>
        {policy.envForcedClosed ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">
            注册已被服务器环境变量强制关闭，后台注册模式无法覆盖。
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <FormError message={errors.form} />

      {showTabs ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-sky-50 p-1">
          <button
            type="button"
            onClick={() => switchType('EMAIL')}
            className={`rounded-lg px-3 py-2 text-sm font-black transition ${registrationType === 'EMAIL' ? 'bg-white text-brand-950 shadow-sm' : 'text-slate-500 hover:text-brand-700'}`}
          >
            邮箱注册
          </button>
          <button
            type="button"
            onClick={() => switchType('PHONE')}
            className={`rounded-lg px-3 py-2 text-sm font-black transition ${registrationType === 'PHONE' ? 'bg-white text-brand-950 shadow-sm' : 'text-slate-500 hover:text-brand-700'}`}
          >
            手机号注册
          </button>
        </div>
      ) : null}

      <p className="rounded-2xl bg-sky-50 px-4 py-3 text-xs font-bold leading-6 text-slate-600">
        当前注册模式：{policy.registrationModeLabel}。注册方式只影响新用户注册，不影响已有用户登录。
      </p>

      {registrationType === 'PHONE' ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-800">
          当前开放手机号注册，手机号尚未经过短信验证，请妥善保管密码并尽快绑定邮箱。
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-bold text-slate-700">用户名 / 昵称</span>
        <input
          value={form.nickname}
          onChange={(event) => updateField('nickname', event.target.value)}
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="2-16 个字符"
        />
        <FormError message={errors.nickname} />
      </label>

      {registrationType === 'PHONE' ? (
        <label className="block">
          <span className="text-sm font-bold text-slate-700">手机号</span>
          <input
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
            type="tel"
            autoComplete="tel"
            className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
            placeholder="中国大陆 11 位手机号"
          />
          <FormError message={errors.phone} />
        </label>
      ) : (
        <label className="block">
          <span className="text-sm font-bold text-slate-700">邮箱</span>
          <input
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
            type="email"
            autoComplete="email"
            className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
            placeholder="用于验证账号和邮箱登录"
          />
          <FormError message={errors.email} />
        </label>
      )}

      <label className="block">
        <span className="text-sm font-bold text-slate-700">密码</span>
        <input
          value={form.password}
          onChange={(event) => updateField('password', event.target.value)}
          type="password"
          autoComplete="new-password"
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="至少 8 位"
        />
        <FormError message={errors.password} />
      </label>

      <label className="block">
        <span className="text-sm font-bold text-slate-700">确认密码</span>
        <input
          value={form.confirmPassword}
          onChange={(event) => updateField('confirmPassword', event.target.value)}
          type="password"
          autoComplete="new-password"
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="再次输入密码"
        />
        <FormError message={errors.confirmPassword} />
      </label>

      {shouldRenderTurnstile ? <div ref={turnstileRef} className="min-h-[65px]" /> : null}
      <FormError message={errors.turnstileToken} />

      <label className="flex items-start gap-3 rounded-xl bg-sky-50/70 p-4 text-sm font-bold text-slate-600">
        <input
          type="checkbox"
          checked={form.acceptedAgreement}
          onChange={(event) => updateField('acceptedAgreement', event.target.checked)}
          className="mt-1"
        />
        <span>我已阅读并同意《私家E院用户协议》和社区管理规范。</span>
      </label>
      <FormError message={errors.acceptedAgreement} />

      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</p> : null}
      {devVerificationUrl ? (
        <a className="block break-all rounded-xl bg-sky-50 px-4 py-3 text-xs font-bold text-brand-700" href={devVerificationUrl}>
          开发环境验证链接：{devVerificationUrl}
        </a>
      ) : null}

      <button
        disabled={isSubmitting}
        className="w-full rounded-lg bg-brand-700 px-4 py-3 font-black text-white shadow-lg shadow-sky-900/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? '注册中...' : registrationType === 'PHONE' ? '手机号注册' : '注册并发送验证邮件'}
      </button>
    </form>
  )
}
