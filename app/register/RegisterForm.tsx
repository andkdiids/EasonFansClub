'use client'

import { useEffect, useRef, useState } from 'react'
import { FormError } from '@/components/FormError'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string
      reset: (widgetId?: string) => void
    }
  }
}

type RegisterErrors = Partial<{
  password: string
  confirmPassword: string
  nickname: string
  email: string
  acceptedAgreement: string
  turnstileToken: string
  form: string
}>

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

export function RegisterForm() {
  const [form, setForm] = useState({
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

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileRef.current || widgetIdRef.current) return

    const render = () => {
      if (!window.turnstile || !turnstileRef.current || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: turnstileSiteKey,
        callback: setTurnstileToken,
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      })
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = render
    document.head.appendChild(script)
    render()
  }, [])

  function updateField(field: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setMessage('')
    setDevVerificationUrl('')

    if (turnstileSiteKey && !turnstileToken) {
      setErrors({ turnstileToken: '请先完成人机验证' })
      return
    }

    setIsSubmitting(true)
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, turnstileToken }),
    })

    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)
    window.turnstile?.reset(widgetIdRef.current)
    setTurnstileToken('')

    if (!response.ok) {
      setErrors({ form: data.message, ...data.errors })
      return
    }

    setMessage(data.message || '注册成功，请先查收邮件完成邮箱验证')
    setDevVerificationUrl(data.devVerificationUrl || '')
    setForm({ email: '', password: '', confirmPassword: '', nickname: '', acceptedAgreement: false })
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <FormError message={errors.form} />

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

      {turnstileSiteKey ? <div ref={turnstileRef} className="min-h-[65px]" /> : null}
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
        {isSubmitting ? '注册中...' : '注册并发送验证邮件'}
      </button>
    </form>
  )
}
