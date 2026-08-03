'use client'

import Link from 'next/link'
import { useState } from 'react'

export function ResetPasswordForm({ token }: Readonly<{ token: string }>) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(token ? '' : '重置链接缺失，请重新申请密码重置链接')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !token) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token, newPassword, confirmPassword }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.message || '密码修改失败，请重新申请重置链接')
        return
      }
      setNewPassword('')
      setConfirmPassword('')
      setMessage(data.message || '密码修改成功，请重新登录')
    } catch {
      setError('网络连接失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  if (message) {
    return <div className="space-y-4"><p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black leading-6 text-emerald-700">{message}</p><Link href="/login" className="block w-full rounded-xl bg-brand-950 px-4 py-2 text-center font-black text-white">返回登录</Link></div>
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <label className="block" htmlFor="reset-new-password">
        <span className="text-sm font-black text-brand-950">新密码</span>
        <input id="reset-new-password" type="password" autoComplete="new-password" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-2 font-bold outline-none focus:border-brand-500" placeholder="至少 8 位，最多 128 位" />
      </label>
      <label className="block" htmlFor="reset-confirm-password">
        <span className="text-sm font-black text-brand-950">确认密码</span>
        <input id="reset-confirm-password" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-2 font-bold outline-none focus:border-brand-500" placeholder="再次输入新密码" />
      </label>
      <button type="submit" disabled={busy || !token || newPassword.length < 8 || newPassword !== confirmPassword} className="w-full rounded-xl bg-brand-950 px-4 py-2 font-black text-white disabled:opacity-50">
        {busy ? '提交中...' : '修改密码'}
      </button>
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-black leading-6 text-red-700">{error}</p> : null}
      <p className="text-center text-sm font-bold text-slate-500"><Link href="/forgot-password" className="text-brand-700 hover:underline">重新申请重置链接</Link></p>
    </form>
  )
}
