'use client'

import { useState } from 'react'

const genericMessage = '如果该邮箱已注册，我们会发送密码重置链接。'

export function EmailPasswordLinkForm() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/auth/password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '发送失败，请稍后再试')
        return
      }
      setMessage(data.message ? `${data.message}。` : genericMessage)
    } catch {
      setError('网络连接失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <label className="block" htmlFor="password-reset-email">
        <span className="text-sm font-black text-brand-950">注册邮箱</span>
        <input
          id="password-reset-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-2 font-bold outline-none focus:border-brand-500"
          placeholder="请输入注册邮箱"
        />
      </label>
      <button type="submit" disabled={busy || !email.trim()} className="w-full rounded-xl bg-brand-700 px-4 py-2 font-black text-white disabled:opacity-50">
        {busy ? '发送中...' : '发送重置链接'}
      </button>
      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-black leading-6 text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-black leading-6 text-red-700">{error}</p> : null}
    </form>
  )
}
