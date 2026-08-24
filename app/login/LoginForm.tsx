'use client'

import { useEffect, useState } from 'react'
import { FormError } from '@/components/FormError'
import { InternationalPhoneInput } from '@/components/InternationalPhoneInput'
import { getPhoneInputParts, getPhoneValidationMessage, isLikelyPhoneInput, normalizePhoneNumber, type PhoneCountryCode } from '@/lib/phone-number'
import { normalizeStoredInternalPath } from '@/lib/url-safety'
import Link from 'next/link'

type LoginErrors = Partial<{
  identifier: string
  password: string
  form: string
}>

type IdentifierType = 'phone' | 'email'

function inferIdentifierType(value: string): IdentifierType {
  if (value.includes('@')) return 'email'
  if (isLikelyPhoneInput(value)) return 'phone'
  return 'phone'
}

function safeRedirectPath(path?: string) {
  if (!path?.trim()) return '/welcome'
  return normalizeStoredInternalPath(path) || '/'
}

const legacyRedirectStorageKeys = [
  'ecfc-base-url',
  'ecfc-redirect-url',
  'ecfc-callback-url',
  'ecfc-login-redirect',
  'redirectUrl',
  'callbackUrl',
  'returnTo',
  'loginRedirect',
]

function clearLegacyRedirectStorage() {
  for (const key of legacyRedirectStorageKeys) {
    try {
      const value = window.localStorage.getItem(key) || window.sessionStorage.getItem(key)
      if (value && normalizeStoredInternalPath(value) && /^https?:\/\//i.test(value.trim())) {
        window.localStorage.removeItem(key)
        window.sessionStorage.removeItem(key)
      }
    } catch {
      // Storage is optional; navigation remains server-authoritative.
    }
  }
}

export function LoginForm({ redirectTo, initialAccount = '' }: Readonly<{ redirectTo?: string; initialAccount?: string }>) {
  const normalizedInitialAccount = initialAccount.trim().slice(0, 254)
  const [identifierType, setIdentifierType] = useState<IdentifierType>(inferIdentifierType(normalizedInitialAccount))
  const initialPhoneParts = getPhoneInputParts(normalizedInitialAccount)
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountryCode>(initialPhoneParts.country)
  const [phoneValue, setPhoneValue] = useState(inferIdentifierType(normalizedInitialAccount) === 'phone' ? initialPhoneParts.value : '')
  const [errors, setErrors] = useState<LoginErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    clearLegacyRedirectStorage()
    if (normalizedInitialAccount) {
      const initialType = inferIdentifierType(normalizedInitialAccount)
      setIdentifierType(initialType)
      if (initialType === 'phone') {
        const parts = getPhoneInputParts(normalizedInitialAccount)
        setPhoneCountry(parts.country)
        setPhoneValue(parts.value)
      }
      window.localStorage.setItem('ecfc-login-type', initialType)
      return
    }
    const saved = window.localStorage.getItem('ecfc-login-type')

    if (saved === 'phone' || saved === 'email') setIdentifierType(saved)
    else setIdentifierType('phone')
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
    const rawIdentifier = (identifierType === 'phone' ? phoneValue : String(formData.get('identifier') || '')).trim()
    const password = String(formData.get('password') || '')

    if (!rawIdentifier || !password) {
      setErrors({
        form: '请填写账号和密码',
        ...(!rawIdentifier ? { identifier: identifierType === 'email' ? '请输入邮箱' : '请输入手机号' } : {}),
        ...(!password ? { password: '请输入密码' } : {}),
      })
      return
    }

    let identifier = rawIdentifier
    let requestPhoneCountry: PhoneCountryCode | undefined
    if (identifierType === 'phone') {
      const phone = normalizePhoneNumber(rawIdentifier, phoneCountry)
      if (!phone) {
        setErrors({ identifier: getPhoneValidationMessage(phoneCountry) })
        return
      }
      identifier = phone.e164
      requestPhoneCountry = phone.country
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
        body: JSON.stringify({ identifierType, identifier, password, ...(requestPhoneCountry ? { phoneCountry: requestPhoneCountry } : {}) }),
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
    <form className="auth-form-stack" onSubmit={handleSubmit} autoComplete="on" noValidate>

      <div className="auth-method-tabs" role="tablist" aria-label="登录方式">
        {[
          ['phone', '手机号登录'],
          ['email', '邮箱登录'],
        ].map(([type, label]) => (
          <button
            key={type}
            type="button"
            role="tab"
            onClick={() => chooseType(type as IdentifierType)}
            aria-selected={identifierType === type}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="block">
        <label className="block" htmlFor="login-identifier">
          <span className="text-sm font-bold text-slate-700">{identifierType === 'email' ? '邮箱' : identifierType === 'phone' ? '手机号' : '登录账号'}</span>
        </label>
        {identifierType === 'phone' ? (
          <InternationalPhoneInput
            id="login-identifier"
            name="identifier"
            value={phoneValue}
            country={phoneCountry}
            onChange={setPhoneValue}
            onCountryChange={setPhoneCountry}
            required
            autoComplete="username"
            inputClassName="auth-input w-full"
            placeholder="请输入已绑定手机号"
          />
        ) : (
          <input
            key={identifierType}
            id="login-identifier"
            name="identifier"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            defaultValue={normalizedInitialAccount}
            className="auth-input mt-2 w-full"
            placeholder="请输入已验证邮箱"
          />
        )}
        <FormError message={errors.identifier} />
      </div>

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
          className="auth-input mt-2 w-full"
          placeholder="请输入密码"
        />
        <FormError message={errors.password} />
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className="auth-submit-button relative z-10 w-full disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? '登录中...' : '登录'}
      </button>
    </form>
  )
}
