'use client'

import { useState } from 'react'

type ApiData = Record<string, unknown> & { message?: unknown; errors?: unknown }

function readFieldErrors(value: unknown) {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

export function ForgotPasswordForm({ securityEnabled }: { securityEnabled: boolean }) {
  const [identifier, setIdentifier] = useState('')
  const [challenge, setChallenge] = useState('')
  const [answer, setAnswer] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function call(path: string, payload: Record<string, unknown>) {
    setBusy(true)
    setError('')
    setMessage('')
    setFieldErrors({})
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(payload) })
      const data = await response.json().catch(() => ({})) as ApiData
      if (!response.ok) {
        const nextFieldErrors = readFieldErrors(data.errors)
        setFieldErrors(nextFieldErrors)
        if (Object.keys(nextFieldErrors).length === 0) setError(typeof data.message === 'string' ? data.message : '操作失败，请稍后再试')
        return null
      }
      setMessage(typeof data.message === 'string' ? data.message : '操作成功')
      return data
    } catch {
      setError('网络连接失败，请稍后再试')
      return null
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (field: string) => fieldErrors[field] ? <p className="mt-1 text-sm font-bold text-red-600">{fieldErrors[field]}</p> : null

  async function loadChallenge() {
    const data = await call('/api/auth/forgot-password/security/questions', { identifier })
    if (data && typeof data.challenge === 'string') setChallenge(data.challenge)
  }

  async function verifyAnswer() {
    const data = await call('/api/auth/forgot-password/security/verify', { challenge, answers: [{ answer }] })
    if (data && typeof data.resetToken === 'string') setResetToken(data.resetToken)
  }

  async function resetPassword() {
    const data = await call('/api/auth/forgot-password/reset', { resetToken, password, confirmPassword })
    if (data) {
      setResetToken('')
      setPassword('')
      setConfirmPassword('')
    }
  }

  if (!securityEnabled) return <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800" role="status">当前暂时无法使用自助密保找回。请联系管理员协助恢复账号。</p>

  return <div className="space-y-5">
    {!resetToken ? <div>
      <label className="block text-sm font-black text-brand-950">账号<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-3 font-bold outline-none focus:border-brand-500" placeholder="手机号、登录账号或邮箱" /></label>
      {fieldError('identifier')}
    </div> : null}
    {!challenge && !resetToken ? <button type="button" disabled={busy || !identifier.trim()} onClick={() => void loadChallenge()} className="w-full rounded-xl bg-brand-700 px-4 py-3 font-black text-white disabled:opacity-50">{busy ? '正在验证账号…' : '下一步'}</button> : null}
    {challenge && !resetToken ? <div className="space-y-3">
      <label className="block text-sm font-black text-brand-950">密保答案<input value={answer} onChange={(event) => setAnswer(event.target.value)} autoComplete="off" maxLength={200} className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-3 font-bold outline-none focus:border-brand-500" placeholder="请输入设置密保时保存的答案" /></label>
      {fieldError('answer')}
      <p className="text-xs font-bold leading-5 text-slate-500">为防止账号信息被枚举，页面不会显示具体密保问题；请输入你设置时保存的答案。</p>
      <button type="button" disabled={busy || !answer.trim()} onClick={() => void verifyAnswer()} className="w-full rounded-xl bg-brand-700 px-4 py-3 font-black text-white disabled:opacity-50">{busy ? '验证中…' : '验证密保答案'}</button>
    </div> : null}
    {resetToken ? <div className="space-y-3">
      {fieldError('resetToken')}
      <label className="block text-sm font-black text-brand-950">新密码<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-3 font-bold" placeholder="至少 8 位" /></label>
      {fieldError('password')}
      <label className="block text-sm font-black text-brand-950">确认新密码<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-3 font-bold" /></label>
      {fieldError('confirmPassword')}
      <button type="button" disabled={busy || password.length < 8 || password !== confirmPassword} onClick={() => void resetPassword()} className="w-full rounded-xl bg-brand-950 px-4 py-3 font-black text-white disabled:opacity-50">{busy ? '重置中…' : '重置密码'}</button>
    </div> : null}
    {message ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700" role="status">{message}</p> : null}
    {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700" role="alert">{error}</p> : null}
  </div>
}
