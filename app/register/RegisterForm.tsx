'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FormError } from '@/components/FormError'

type RegisterErrors = Partial<{
  phone: string
  password: string
  nickname: string
  email: string
  acceptedAgreement: string
  form: string
}>

export function RegisterForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    phone: '',
    email: '',
    password: '',
    nickname: '',
    acceptedAgreement: false,
  })
  const [errors, setErrors] = useState<RegisterErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField(field: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrors({})
    setIsSubmitting(true)

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      setErrors({ form: data.message, ...data.errors })
      return
    }

    router.push('/')
    router.refresh()
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
          placeholder="2-16 个字符，可使用中文、英文、数字、符号和 Emoji"
        />
        <FormError message={errors.nickname} />
      </label>

      <label className="block">
        <span className="text-sm font-bold text-slate-700">手机号</span>
        <input
          value={form.phone}
          onChange={(event) => updateField('phone', event.target.value)}
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="中国大陆 11 位手机号"
        />
        <FormError message={errors.phone} />
      </label>

      <label className="block">
        <span className="text-sm font-bold text-slate-700">邮箱</span>
        <input
          value={form.email}
          onChange={(event) => updateField('email', event.target.value)}
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="可选，用于找回账号"
        />
        <FormError message={errors.email} />
      </label>

      <label className="block">
        <span className="text-sm font-bold text-slate-700">密码</span>
        <input
          value={form.password}
          onChange={(event) => updateField('password', event.target.value)}
          type="password"
          className="mt-2 w-full rounded-lg border border-sky-100 bg-white px-4 py-3 outline-none ring-brand-500/20 focus:ring-4"
          placeholder="至少 8 位"
        />
        <FormError message={errors.password} />
      </label>

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

      <button
        disabled={isSubmitting}
        className="w-full rounded-lg bg-brand-700 px-4 py-3 font-black text-white shadow-lg shadow-sky-900/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? '注册中...' : '注册并进入首页'}
      </button>
    </form>
  )
}
