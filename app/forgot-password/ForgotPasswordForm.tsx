'use client'

import { useState } from 'react'

type Question = { question: string; sortOrder: number }
type Method = 'security' | 'email'

export function ForgotPasswordForm({ emailEnabled, securityEnabled }: { emailEnabled: boolean; securityEnabled: boolean }) {
  const [method, setMethod] = useState<Method>(securityEnabled ? 'security' : 'email')
  const [identifier, setIdentifier] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [challenge, setChallenge] = useState('')
  const [answers, setAnswers] = useState(['', '', ''])
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function call(path: string, payload: Record<string, unknown>) {
    setBusy(true); setError(''); setMessage('')
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) })
    const data = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) { setError(data.message || '操作失败'); return null }
    setMessage(data.message || '操作成功')
    return data as Record<string, unknown>
  }

  async function loadQuestions() {
    const data = await call('/api/auth/forgot-password/security/questions', { identifier })
    if (!data || !Array.isArray(data.questions) || typeof data.challenge !== 'string') return
    setQuestions(data.questions as Question[]); setChallenge(data.challenge)
  }
  async function verifyAnswers() {
    const data = await call('/api/auth/forgot-password/security/verify', { challenge, answers: answers.map((answer) => ({ answer })) })
    if (data && typeof data.resetToken === 'string') setResetToken(data.resetToken)
  }
  async function sendEmailCode() { await call('/api/auth/forgot-password/email/send', { identifier }) }
  async function verifyEmailCode() {
    const data = await call('/api/auth/forgot-password/email/verify', { identifier, code })
    if (data && typeof data.resetToken === 'string') setResetToken(data.resetToken)
  }
  async function resetPassword() {
    const data = await call('/api/auth/forgot-password/reset', { resetToken, password, confirmPassword })
    if (data) { setPassword(''); setConfirmPassword('') }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-sky-50 p-1">
        <button type="button" disabled={!securityEnabled} onClick={() => setMethod('security')} className={`rounded-lg px-3 py-2 text-sm font-black disabled:opacity-40 ${method === 'security' ? 'bg-white text-brand-950 shadow-sm' : 'text-slate-500'}`}>密保问题</button>
        <button type="button" disabled={!emailEnabled} onClick={() => setMethod('email')} className={`rounded-lg px-3 py-2 text-sm font-black disabled:opacity-40 ${method === 'email' ? 'bg-white text-brand-950 shadow-sm' : 'text-slate-500'}`}>邮箱验证码</button>
      </div>
      {!emailEnabled ? <p className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black text-amber-800">邮箱重置功能暂未开放</p> : null}
      {method === 'security' && message && questions.length === 0 ? (
        <p className="rounded-2xl bg-sky-50 px-4 py-2 text-sm font-bold leading-6 text-sky-700">
          {emailEnabled ? '如已绑定并验证邮箱，可以切换到邮箱验证码方式找回。' : '当前没有其他可用的自助恢复方式，请联系管理员。'}
        </p>
      ) : null}
      {!resetToken ? <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="w-full rounded-xl border border-sky-100 px-4 py-2 font-bold outline-none focus:border-brand-500" placeholder="手机号、用户名或邮箱" /> : null}
      {method === 'security' && !challenge ? <button disabled={busy || !identifier} onClick={loadQuestions} className="w-full rounded-xl bg-brand-700 px-4 py-2 font-black text-white disabled:opacity-50">下一步</button> : null}
      {method === 'security' && questions.length === 3 && !resetToken ? <div className="space-y-4">{questions.map((item, index) => <label key={item.sortOrder} className="block"><span className="text-sm font-black text-brand-950">{item.question}</span><input value={answers[index]} onChange={(event) => setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? event.target.value : answer))} className="mt-2 w-full rounded-xl border border-sky-100 px-4 py-2 font-bold" placeholder="答案" /></label>)}<button disabled={busy} onClick={verifyAnswers} className="w-full rounded-xl bg-brand-700 px-4 py-2 font-black text-white disabled:opacity-50">验证全部答案</button></div> : null}
      {method === 'email' && emailEnabled && !resetToken ? <div className="space-y-3"><button disabled={busy || !identifier} onClick={sendEmailCode} className="w-full rounded-xl bg-brand-700 px-4 py-2 font-black text-white disabled:opacity-50">发送验证码</button><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="w-full rounded-xl border border-sky-100 px-4 py-2 font-bold" placeholder="6 位验证码" /><button disabled={busy || code.length !== 6} onClick={verifyEmailCode} className="w-full rounded-xl bg-brand-950 px-4 py-2 font-black text-white disabled:opacity-50">验证邮箱</button></div> : null}
      {resetToken ? <div className="space-y-3"><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-sky-100 px-4 py-2 font-bold" placeholder="新密码（至少 8 位）" /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="w-full rounded-xl border border-sky-100 px-4 py-2 font-bold" placeholder="确认新密码" /><button disabled={busy || password.length < 8 || password !== confirmPassword} onClick={resetPassword} className="w-full rounded-xl bg-brand-950 px-4 py-2 font-black text-white disabled:opacity-50">重置密码</button></div> : null}
      {message ? <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-sm font-black text-red-700">{error}</p> : null}
    </div>
  )
}
