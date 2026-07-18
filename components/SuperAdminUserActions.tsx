'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

type SuperAdminUserActionsProps = { targetUserId: string; initialUid: number; initialAccount: string; nickname: string }

function formatUid(value: number | string) {
  return String(Number(value)).padStart(5, '0')
}

export function SuperAdminUserActions({ targetUserId, initialUid, initialAccount, nickname }: Readonly<SuperAdminUserActionsProps>) {
  const router = useRouter()
  const [currentUid, setCurrentUid] = useState(initialUid)
  const [uidInput, setUidInput] = useState(formatUid(initialUid))
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [account, setAccount] = useState('')
  const [confirmAccount, setConfirmAccount] = useState('')
  const [accountReason, setAccountReason] = useState('')
  const [busy, setBusy] = useState<'uid' | 'account' | 'password' | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function updateUid(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy('uid'); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/uid`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ uid: uidInput }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || 'UID 修改失败')
      setCurrentUid(data.user.uid)
      setUidInput(data.user.formattedUid)
      setMessage(data.message || 'UID 修改成功')
      router.refresh()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'UID 修改失败')
    } finally { setBusy(null) }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!window.confirm(`确认重置 ${nickname} 的登录密码吗？`)) return
    setBusy('password'); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/password`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ password, confirmPassword }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '密码重置失败')
      setPassword(''); setConfirmPassword('')
      setMessage(data.message || '密码重置成功')
      router.refresh()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : '密码重置失败')
    } finally { setBusy(null) }
  }

  async function updateAccount(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!window.confirm('修改后，用户下次登录必须使用新账号。是否继续？')) return
    setBusy('account'); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/account`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ account, confirmAccount, reason: accountReason }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '登录账号修改失败')
      setAccount(''); setConfirmAccount(''); setAccountReason('')
      setMessage(data.message || '登录账号修改成功')
      router.refresh()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '登录账号修改失败')
    } finally { setBusy(null) }
  }

  return <section className="rounded-[28px] border border-amber-200 bg-amber-50/80 p-5 shadow-sm sm:p-7">
    <p className="text-xs font-black tracking-[0.18em] text-amber-700">SUPER ADMIN ONLY</p>
    <h2 className="mt-2 text-2xl font-black text-slate-950">高级操作</h2>
    <p className="mt-2 text-sm font-bold leading-7 text-amber-900/70">这些操作仅限超级管理员，并会写入管理员操作日志。当前 UID：{formatUid(currentUid)}</p>
    {message ? <p className="mt-4 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-black text-emerald-800">{message}</p> : null}
    {error ? <p className="mt-4 rounded-2xl bg-red-100 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <form onSubmit={updateUid} className="rounded-2xl bg-white p-5 ring-1 ring-amber-200">
        <h3 className="text-lg font-black text-slate-950">修改 UID</h3>
        <p className="mt-2 text-xs font-bold leading-6 text-slate-500">输入 1 至 5 位数字，系统自动补足为五位，并检查是否重复。</p>
        <label className="mt-4 block text-sm font-black text-slate-700">新 UID</label>
        <input value={uidInput} onChange={(event) => setUidInput(event.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={() => { if (uidInput) setUidInput(uidInput.padStart(5, '0')) }} inputMode="numeric" pattern="\d{1,5}" required className="mt-2 min-h-12 w-full rounded-2xl border border-amber-200 px-4 font-black tracking-[0.16em] outline-none focus:border-amber-500" />
        <button disabled={Boolean(busy)} className="mt-4 min-h-11 rounded-full bg-amber-600 px-5 text-sm font-black text-white disabled:opacity-50">{busy === 'uid' ? '修改中...' : '修改 UID'}</button>
      </form>
      <form onSubmit={updateAccount} className="rounded-2xl bg-white p-5 ring-1 ring-amber-200">
        <h3 className="text-lg font-black text-slate-950">修改登录账号</h3>
        <p className="mt-2 text-xs font-bold leading-6 text-slate-500">这是用户登录时使用的账号，不是 UID，也不是昵称。</p>
        <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm font-black text-brand-950">当前登录账号：{initialAccount}</p>
        <label className="mt-4 block text-sm font-black text-slate-700">新登录账号</label>
        <input value={account} onChange={(event) => setAccount(event.target.value)} minLength={2} maxLength={16} required autoComplete="off" className="mt-2 min-h-12 w-full rounded-2xl border border-amber-200 px-4 font-bold outline-none focus:border-amber-500" />
        <label className="mt-4 block text-sm font-black text-slate-700">再次输入新登录账号</label>
        <input value={confirmAccount} onChange={(event) => setConfirmAccount(event.target.value)} minLength={2} maxLength={16} required autoComplete="off" className="mt-2 min-h-12 w-full rounded-2xl border border-amber-200 px-4 font-bold outline-none focus:border-amber-500" />
        <label className="mt-4 block text-sm font-black text-slate-700">操作原因</label>
        <textarea value={accountReason} onChange={(event) => setAccountReason(event.target.value.slice(0, 300))} maxLength={300} required rows={3} className="mt-2 w-full resize-none rounded-2xl border border-amber-200 px-4 py-3 font-bold outline-none focus:border-amber-500" />
        <button disabled={Boolean(busy)} className="mt-4 min-h-11 rounded-full bg-amber-700 px-5 text-sm font-black text-white disabled:opacity-50">{busy === 'account' ? '修改中...' : '确认修改登录账号'}</button>
      </form>
      <form onSubmit={resetPassword} className="rounded-2xl bg-white p-5 ring-1 ring-red-200">
        <h3 className="text-lg font-black text-slate-950">重置用户密码</h3>
        <p className="mt-2 text-xs font-bold leading-6 text-slate-500">密码使用 bcrypt 加密。重置后用户会收到重新确认密保设置的提醒。</p>
        <label className="mt-4 block text-sm font-black text-slate-700">新密码</label>
        <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-red-200 px-4 font-bold outline-none focus:border-red-400" />
        <label className="mt-4 block text-sm font-black text-slate-700">确认密码</label>
        <input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-red-200 px-4 font-bold outline-none focus:border-red-400" />
        <button disabled={Boolean(busy)} className="mt-4 min-h-11 rounded-full bg-red-600 px-5 text-sm font-black text-white disabled:opacity-50">{busy === 'password' ? '重置中...' : '重置密码'}</button>
      </form>
    </div>
  </section>
}
