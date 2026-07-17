'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
  requireSecurityQuestionsForNewUsers: boolean
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
  securityQuestions: string
}>

const errorFieldOrder: (keyof RegisterErrors)[] = [
  'registrationType',
  'nickname',
  'phone',
  'email',
  'password',
  'confirmPassword',
  'securityQuestions',
  'acceptedAgreement',
  'turnstileToken',
  'form',
]

function unicodeLength(value: string) {
  return Array.from(value).length
}

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
    securityQuestions: Array.from({ length: 1 }, () => ({ question: '', answer: '' })),
  })
  const [turnstileToken, setTurnstileToken] = useState('')
  const [errors, setErrors] = useState<RegisterErrors>({})
  const [message, setMessage] = useState('')
  const [devVerificationUrl, setDevVerificationUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginUrl, setLoginUrl] = useState('')
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string>('')
  const requestControllerRef = useRef<AbortController | null>(null)
  const redirectTimerRef = useRef<number | null>(null)
  const idempotencyKeyRef = useRef('')
  const submitLockedRef = useRef(false)
  const mountedRef = useRef(true)
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

  useEffect(() => {
  mountedRef.current = true

  return () => {
    mountedRef.current = false
    requestControllerRef.current?.abort()

    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current)
    }
  }
}, [])

  function updateField(field: 'phone' | 'email' | 'password' | 'confirmPassword' | 'nickname' | 'acceptedAgreement', value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updateSecurityQuestion(index: number, field: 'question' | 'answer', value: string) {
    setForm((current) => ({
      ...current,
      securityQuestions: current.securityQuestions.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }))
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

  function focusFirstError(nextErrors: RegisterErrors) {
    const field = errorFieldOrder.find((key) => nextErrors[key])
    if (!field) return
    const element = document.querySelector<HTMLElement>(`[data-register-field="${field}"]`)
    element?.focus()
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function validateClientForm() {
    const nextErrors: RegisterErrors = {}
    const nickname = form.nickname.trim()
    const phone = form.phone.trim().replace(/\s+/g, '')
    const email = form.email.trim().toLowerCase()
    const password = form.password.trim()
    const confirmPassword = form.confirmPassword.trim()

    if (registrationType === 'PHONE' && !policy.allowPhoneRegistration) {
      nextErrors.registrationType = '当前未开放手机号注册'
    }
    if (registrationType === 'EMAIL' && !policy.allowEmailRegistration) {
      nextErrors.registrationType = '当前未开放邮箱注册'
    }
    if (!nickname) {
      nextErrors.nickname = '请填写用户名/昵称'
    } else if (unicodeLength(nickname) < 2 || unicodeLength(nickname) > 16) {
      nextErrors.nickname = '用户名长度需要 2-16 个字符'
    }
    if (registrationType === 'PHONE') {
      if (!phone) nextErrors.phone = '请填写手机号'
      if (phone && !/^1\d{10}$/.test(phone)) nextErrors.phone = '请输入 11 位中国大陆手机号'
    }
    if (registrationType === 'EMAIL') {
      if (!email) nextErrors.email = '请填写邮箱'
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = '请输入有效邮箱'
    }
    if (!password || password.length < 8) nextErrors.password = '密码至少需要 8 位'
    if (confirmPassword !== password) nextErrors.confirmPassword = '两次输入的密码不一致'
    if (!form.acceptedAgreement) nextErrors.acceptedAgreement = '请先勾选用户协议'
   if (policy.requireSecurityQuestionsForNewUsers) {
  const firstQuestion = form.securityQuestions[0]

  if (
    !firstQuestion ||
    !firstQuestion.question.trim() ||
    !firstQuestion.answer.trim()
  ) {
    nextErrors.securityQuestions = '请完整填写密保问题和答案'
  }
  }
    if (shouldRenderTurnstile && !turnstileToken) nextErrors.turnstileToken = '请先完成人机验证'

    return nextErrors
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting || submitLockedRef.current) return
    setErrors({})
    setMessage('')
    setDevVerificationUrl('')

    const clientErrors = validateClientForm()
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors)
      focusFirstError(clientErrors)
      return
    }

    setIsSubmitting(true)
    submitLockedRef.current = true
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = window.crypto.randomUUID()
    const account = registrationType === 'PHONE'
      ? form.phone.trim().replace(/\s+/g, '')
      : form.email.trim().toLowerCase()
    const payload = {
      registrationType,
      nickname: form.nickname,
      password: form.password,
      confirmPassword: form.confirmPassword,
      acceptedAgreement: form.acceptedAgreement,
      turnstileToken,
      securityQuestions: form.securityQuestions,
      ...(registrationType === 'PHONE' ? { phone: form.phone } : { email: form.email }),
    }
    const controller = new AbortController()
requestControllerRef.current = controller

const timeoutId = window.setTimeout(() => {
  controller.abort()
}, 30000)

try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKeyRef.current },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!mountedRef.current) return
      window.turnstile?.reset(widgetIdRef.current)
      setTurnstileToken('')

      if (!response.ok) {
        const retryAfter = typeof data.retryAfter === 'number' && data.retryAfter > 0 ? Math.ceil(data.retryAfter) : null
        const formMessage = retryAfter
          ? `${data.message || '请求失败'} 请在 ${retryAfter} 秒后重试。`
          : data.message
        const serverErrors = { form: formMessage, ...data.errors }
        setErrors(serverErrors)
        focusFirstError(serverErrors)
        submitLockedRef.current = false
        idempotencyKeyRef.current = ''
        return
      }

      const nextLoginUrl = `/login?account=${encodeURIComponent(account)}`
      setMessage('注册成功，请登录您的账号。')
      setDevVerificationUrl('')
      setLoginUrl(nextLoginUrl)
      setForm({ phone: '', email: '', password: '', confirmPassword: '', nickname: '', acceptedAgreement: false, securityQuestions: Array.from({ length: 1 }, () => ({ question: '', answer: '' })) })
      redirectTimerRef.current = window.setTimeout(() => window.location.assign(nextLoginUrl), 1000)
    } catch (requestError) {
  if (!mountedRef.current) return

  if (requestError instanceof Error && requestError.name === 'AbortError') {
    setErrors({
      form: '注册请求超时，请检查数据库连接后重试',
    })
  } else {
    setErrors({
      form: '网络连接失败，请稍后重试',
    })
  }

  submitLockedRef.current = false
  idempotencyKeyRef.current = ''
} finally {
  window.clearTimeout(timeoutId)
  requestControllerRef.current = null

  if (mountedRef.current) {
    setIsSubmitting(false)
  }
  }
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
      <div data-register-field="form" tabIndex={-1}>
        <FormError message={errors.form} />
      </div>

      {showTabs ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-sky-50 p-1">
          <button
            type="button"
            onClick={() => switchType('EMAIL')}
            data-register-field="registrationType"
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
          data-register-field="nickname"
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="2-16 个字符"
        />
        <FormError message={errors.nickname} />
      </label>

      {policy.requireSecurityQuestionsForNewUsers ? (
        <fieldset data-register-field="securityQuestions" tabIndex={-1} className="space-y-4 rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
          <legend className="px-2 text-sm font-black text-brand-950">设置密保问题</legend>
          <p className="text-xs font-bold leading-6 text-amber-800">密保问题设置后不可修改，请妥善保存答案。</p>
          {form.securityQuestions.map((item, index) => (
            <div key={index} className="space-y-2 rounded-xl bg-white p-3">
              <input value={item.question} onChange={(event) => updateSecurityQuestion(index, 'question', event.target.value)} maxLength={120} className="w-full rounded-lg border border-sky-100 px-3 py-2 text-sm font-bold outline-none focus:border-brand-500" placeholder={`密保问题 ${index + 1}`} />
              <input value={item.answer} onChange={(event) => updateSecurityQuestion(index, 'answer', event.target.value)} maxLength={200} autoComplete="off" className="w-full rounded-lg border border-sky-100 px-3 py-2 text-sm font-bold outline-none focus:border-brand-500" placeholder="答案" />
            </div>
          ))}
          <FormError message={errors.securityQuestions} />
        </fieldset>
      ) : null}

      {registrationType === 'PHONE' ? (
        <label className="block">
          <span className="text-sm font-bold text-slate-700">手机号</span>
          <input
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
            type="tel"
            autoComplete="tel"
            data-register-field="phone"
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
            data-register-field="email"
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
          data-register-field="password"
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
          data-register-field="confirmPassword"
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="再次输入密码"
        />
        <FormError message={errors.confirmPassword} />
      </label>

      {shouldRenderTurnstile ? <div ref={turnstileRef} data-register-field="turnstileToken" tabIndex={-1} className="min-h-[65px]" /> : null}
      <FormError message={errors.turnstileToken} />

      <label className="flex items-start gap-3 rounded-xl bg-sky-50/70 p-4 text-sm font-bold text-slate-600">
        <input
          type="checkbox"
          checked={form.acceptedAgreement}
          onChange={(event) => updateField('acceptedAgreement', event.target.checked)}
          data-register-field="acceptedAgreement"
          className="mt-1"
        />
        <span>我已阅读并同意《私家E院用户协议》和社区管理规范。</span>
      </label>
      <FormError message={errors.acceptedAgreement} />

      {message ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 shadow-sm">{message}</p> : null}
      {loginUrl ? <Link href={loginUrl} className="block rounded-xl border border-emerald-100 bg-white px-4 py-3 text-center text-sm font-black text-emerald-700">前往登录</Link> : null}
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
