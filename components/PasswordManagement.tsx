'use client'

import { useState, type FormEvent } from 'react'

type PasswordMethod = 'current' | 'security' | 'email'

export function PasswordManagement({ question, securityResetAvailable, emailResetConfigured }: Readonly<{ question: string | null; securityResetAvailable: boolean; emailResetConfigured: boolean }>) {
  const [method, setMethod] = useState<PasswordMethod>('current')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>, endpoint: string) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMessage(''); setError('')
    const form = event.currentTarget
    const body = Object.fromEntries(new FormData(form).entries())
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '操作失败，请稍后重试')
      form.reset()
      setMessage(data.message || '操作成功')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试')
    } finally { setBusy(false) }
  }

  const inputClass = 'mt-2 min-h-12 w-full rounded-2xl border border-sky-100 bg-white px-4 font-bold outline-none focus:border-brand-300'
  return <section className="mt-7 rounded-[28px] border border-sky-100 bg-sky-50/40 p-5 sm:p-6">
    <h2 className="text-2xl font-black text-brand-950">密码管理</h2>
    <div className="mt-4 grid grid-cols-1 gap-2 rounded-2xl bg-white/80 p-1 sm:grid-cols-3" role="tablist" aria-label="密码管理方式">
      {([['current', '使用原密码修改'], ['security', '使用密保问题重置'], ['email', '邮箱验证码重置']] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={method === key} onClick={() => { setMethod(key); setMessage(''); setError('') }} className={`min-h-11 rounded-xl px-3 text-sm font-black ${method === key ? 'bg-brand-950 text-white shadow-sm' : 'text-slate-500 hover:bg-sky-50'}`}>{label}</button>)}
    </div>
    {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700" role="status">{message}</p> : null}
    {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700" role="alert">{error}</p> : null}

    {method === 'current' ? <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event, '/api/account/security/password/change')}>
      <label className="block text-sm font-black text-slate-700">当前密码<input name="currentPassword" type="password" autoComplete="current-password" required minLength={8} maxLength={128} className={inputClass} /></label>
      <label className="block text-sm font-black text-slate-700">新密码<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={inputClass} /></label>
      <label className="block text-sm font-black text-slate-700">确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={inputClass} /></label>
      <button disabled={busy} className="min-h-11 rounded-full bg-brand-700 px-5 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中...' : '确认修改密码'}</button>
    </form> : null}

    {method === 'security' ? securityResetAvailable && question ? <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event, '/api/account/security/password/security-question-reset')}>
      <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs font-black text-brand-700">密保问题</p><p className="mt-1 font-black text-brand-950">{question}</p></div>
      <label className="block text-sm font-black text-slate-700">密保答案<input name="answer" type="password" autoComplete="off" required maxLength={200} className={inputClass} /></label>
      <label className="block text-sm font-black text-slate-700">新密码<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={inputClass} /></label>
      <label className="block text-sm font-black text-slate-700">确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={inputClass} /></label>
      <button disabled={busy} className="min-h-11 rounded-full bg-amber-600 px-5 text-sm font-black text-white disabled:opacity-50">{busy ? '重置中...' : '确认重置密码'}</button>
    </form> : <div className="mt-5 rounded-2xl bg-amber-50 px-4 py-4 text-sm font-bold leading-7 text-amber-800">当前账号不能使用密保重置，请先完成密保设置。</div> : null}

    {method === 'email' ? <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-5 py-5">
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-brand-950">通过邮箱验证码重置</h3><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">暂未开放</span></div>
      <p className="mt-3 text-sm font-bold leading-7 text-slate-500">邮箱验证码服务暂未开放，开放后可通过绑定邮箱接收验证码并重置密码。</p>
      <button type="button" disabled aria-disabled="true" title={emailResetConfigured ? '邮件服务已配置，重置流程尚未开放' : '功能开关、邮件服务或邮箱验证条件尚未满足'} className="mt-4 min-h-11 rounded-full bg-slate-200 px-5 text-sm font-black text-slate-500 disabled:cursor-not-allowed">暂未开放</button>
    </div> : null}
  </section>
}
