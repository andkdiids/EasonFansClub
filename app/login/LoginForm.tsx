'use client'

import { useState } from 'react'
import { FormError } from '@/components/FormError'

type LoginErrors = Partial<{
  identifier: string
  password: string
  form: string
}>

function safeRedirectPath(path?: string) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/'
  if (path === '/login' || path.startsWith('/login?') || path === '/register' || path.startsWith('/register?')) return '/'
  return path
}

export function LoginForm({ redirectTo }: Readonly<{ redirectTo?: string }>) {
  const [errors, setErrors] = useState<LoginErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

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
        ...(!identifier ? { identifier: '请输入手机号、邮箱或昵称' } : {}),
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
        body: JSON.stringify({ identifier, password }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setErrors({ form: data.message || '登录服务暂不可用', ...data.errors })
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

      <label className="block" htmlFor="login-identifier">
        <span className="text-sm font-bold text-slate-700">手机号 / 邮箱 / 昵称</span>
        <input
          id="login-identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          className="mt-2 min-h-12 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="请输入已注册账号"
        />
        <FormError message={errors.identifier} />
      </label>

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
