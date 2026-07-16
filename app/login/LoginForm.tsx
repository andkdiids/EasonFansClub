'use client'

import { useEffect, useState } from 'react'
import { FormError } from '@/components/FormError'
import Link from 'next/link'

type LoginErrors = Partial<{
  identifier: string
  password: string
  form: string
}>

type IdentifierType = 'phone' | 'email'

function safeRedirectPath(path?: string) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/'
  if (path === '/login' || path.startsWith('/login?') || path === '/register' || path.startsWith('/register?')) return '/'
  return path
}

export function LoginForm({ redirectTo, initialAccount = '' }: Readonly<{ redirectTo?: string; initialAccount?: string }>) {
  const normalizedInitialAccount = initialAccount.trim().slice(0, 254)
  const [identifierType, setIdentifierType] = useState<IdentifierType>(normalizedInitialAccount.includes('@') ? 'email' : 'phone')
  const [errors, setErrors] = useState<LoginErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (normalizedInitialAccount) {
      const initialType = normalizedInitialAccount.includes('@') ? 'email' : 'phone'
      setIdentifierType(initialType)
      window.localStorage.setItem('ecfc-login-type', initialType)
      return
    }
    const saved = window.localStorage.getItem('ecfc-login-type')
    if (saved === 'phone' || saved === 'email') setIdentifierType(saved)
  }, [normalizedInitialAccount])

  function chooseType(type: IdentifierType) {
    setIdentifierType(type)
    window.localStorage.setItem('ecfc-login-type', type)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    const form = event.currentTarget
    const formData = new FormData(form)
    const identifier = String(formData.get('identifier') || '').trim()
    const password = String(formData.get('password') || '')

    if (!identifier || !password) {
      setErrors({
        form: '请填写账号和密码',
        ...(!identifier ? { identifier: identifierType === 'email' ? '请输入邮箱' : '请输入手机号' } : {}),
        ...(!password ? { password: '请输入密码' } : {}),
      })
      return
    }

    setErrors({})
    setIsSubmitting(true)
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ identifierType, identifier, password }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setErrors({ form: data.message || '登录服务暂时不可用', ...data.errors })
        return
      }

      window.location.replace(safeRedirectPath(redirectTo))
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError'
      setErrors({ form: isTimeout ? '登录请求超时，请检查网络后重试' : '网络连接失败，请稍后重试' })
    } finally {
      window.clearTimeout(timeoutId)
      setIsSubmitting(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} autoComplete="on" noValidate>
      <FormError message={errors.form} />

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-sky-50 p-1">
        {[
          ['phone', '手机号登录'],
          ['email', '邮箱登录'],
        ].map(([type, label]) => (
          <button
            key={type}
            type="button"
            onClick={() => chooseType(type as IdentifierType)}
            className={`rounded-lg px-3 py-2 text-sm font-black transition ${
              identifierType === type ? 'bg-white text-brand-950 shadow-sm' : 'text-slate-500 hover:text-brand-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="block" htmlFor="login-identifier">
        <span className="text-sm font-bold text-slate-700">{identifierType === 'email' ? '邮箱' : '手机号'}</span>
        <input
          id="login-identifier"
          name="identifier"
          type={identifierType === 'email' ? 'email' : 'tel'}
          autoComplete={identifierType === 'email' ? 'email' : 'tel'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          defaultValue={normalizedInitialAccount}
          className="mt-2 min-h-12 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder={identifierType === 'email' ? '请输入已验证邮箱' : '请输入已绑定手机号'}
        />
        <FormError message={errors.identifier} />
      </label>

      <div className="text-right"><Link href="/forgot-password" className="text-sm font-black text-brand-700 hover:underline">忘记密码？</Link></div>

      <label className="block" htmlFor="login-password">
        <span className="text-sm font-bold text-slate-700">密码</span>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          required
          className="mt-2 min-h-12 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="请输入密码"
        />
        <FormError message={errors.password} />
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="relative z-10 min-h-12 w-full touch-manipulation rounded-lg bg-brand-700 px-4 py-3 font-black text-white shadow-lg shadow-sky-900/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? '登录中...' : '登录'}
      </button>
    </form>
  )
}
