'use client'

import { useCallback, useEffect, useState } from 'react'
import { ActivityRegistrationScanner } from '@/components/activities/ActivityRegistrationScanner'

type RegistrationRow = {
  id: string
  status: 'ACTIVE' | 'CANCELLED'
  registeredAt: string
  cancelledAt: string | null
  verifiedAt: string | null
  verificationMethod: 'MANUAL' | 'QR' | null
  User: { id: string; uid: number; username: string; nickname: string; avatarUrl: string | null }
  answers: Array<{ questionId: string; questionTitle: string; value: string | string[] }>
}

type ActivityMeta = {
  startsAt: string | null
  endsAt: string | null
  registrationStartAt: string | null
  registrationEndAt: string | null
  signupLimit: number | null
  verificationMode: 'NONE' | 'MANUAL' | 'QR'
  reward: { id: string; name: string; code: string } | null
}

export function ActivityRegistrationManager({ activityId, activityTitle, verificationMode, onClose }: Readonly<{ activityId: string; activityTitle: string; verificationMode: 'NONE' | 'MANUAL' | 'QR'; onClose: () => void }>) {
  const [rows, setRows] = useState<RegistrationRow[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [token, setToken] = useState('')
  const [summary, setSummary] = useState({ activeCount: 0, verifiedCount: 0, cancelledCount: 0 })
  const [activityMeta, setActivityMeta] = useState<ActivityMeta | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ status })
      if (query.trim()) params.set('q', query.trim())
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/registrations?${params.toString()}`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '报名记录加载失败')
      setRows(Array.isArray(data?.registrations) ? data.registrations : [])
      if (data?.summary) setSummary(data.summary)
      if (data?.activity) setActivityMeta(data.activity)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '报名记录加载失败')
    } finally {
      setLoading(false)
    }
  }, [activityId, query, status])

  useEffect(() => { void load() }, [load])

  async function verifyRegistration(registrationId: string) {
    if (!window.confirm('确认将这条报名记录标记为已核销吗？核销成功后不能取消报名。')) return
    setBusyId(registrationId); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/registrations/${encodeURIComponent(registrationId)}/verify`, { method: 'POST', credentials: 'same-origin' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '核销失败')
      setMessage(data?.alreadyVerified ? '该报名已核销，本次操作幂等完成' : data?.rewardGranted ? '核销成功，活动勋章已按规则发放' : '核销成功')
      await load()
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '核销失败')
    } finally { setBusyId('') }
  }

  const verifyToken = useCallback(async (rawToken: string) => {
    const nextToken = rawToken.trim()
    if (!nextToken) return
    setScannerOpen(false); setBusyId('qr'); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/verify`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: nextToken }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '扫码核销失败')
      setToken('')
      setMessage(data?.alreadyVerified ? '该报名已核销，本次扫码幂等完成' : data?.rewardGranted ? '扫码核销成功，活动勋章已按规则发放' : '扫码核销成功')
      await load()
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '扫码核销失败')
    } finally { setBusyId('') }
  }, [activityId, load])

  const formatDate = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
  const verificationLabel = activityMeta?.verificationMode === 'QR' ? '扫码核销' : activityMeta?.verificationMode === 'MANUAL' ? '手动核销' : '不需要核销'
  const registrationWindow = activityMeta?.registrationStartAt || activityMeta?.registrationEndAt
    ? `${formatDate(activityMeta.registrationStartAt) || '不限开始时间'} — ${formatDate(activityMeta.registrationEndAt) || '不限截止时间'}`
    : '不限开始时间，不限截止时间'

  return <section className="rounded-[28px] border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black tracking-[0.18em] text-emerald-700 dark:text-emerald-300">报名管理</p><h2 className="mt-1 break-words text-2xl font-black text-brand-950 dark:text-slate-100">{activityTitle}</h2><p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300">有效 {summary.activeCount} · 已核销 {summary.verifiedCount} · 已取消 {summary.cancelledCount}</p></div><button type="button" onClick={onClose} className="min-h-10 rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">收起</button></div>
    {activityMeta ? <div className="mt-4 grid gap-2 rounded-xl border border-emerald-200 bg-white/70 p-3 text-xs font-bold leading-5 text-slate-600 dark:border-emerald-900 dark:bg-slate-900/70 dark:text-slate-300 sm:grid-cols-2"><p>活动时间：{formatDate(activityMeta.startsAt) || '未设置'}{activityMeta.endsAt ? ` — ${formatDate(activityMeta.endsAt)}` : ''}</p><p>报名时间：{registrationWindow}</p><p>报名名额：{activityMeta.signupLimit && activityMeta.signupLimit > 0 ? `${summary.activeCount}/${activityMeta.signupLimit}` : `${summary.activeCount} 人（不限人数）`}</p><p>核销方式：{verificationLabel}</p>{activityMeta.reward ? <p className="sm:col-span-2">隐藏奖励：{activityMeta.reward.name} · {activityMeta.reward.code}</p> : null}</div> : null}
    <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }} placeholder="搜索昵称、用户名或 E院ID" className="min-h-11 min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="ALL">全部报名</option><option value="ACTIVE">有效报名</option><option value="VERIFIED">已核销</option><option value="CANCELLED">已取消</option></select><button type="button" onClick={() => void load()} className="min-h-11 rounded-xl bg-brand-950 px-4 text-sm font-black text-white">搜索</button></div>
    {verificationMode === 'QR' ? <div className="mt-4 flex flex-col gap-2 rounded-xl border border-emerald-200 bg-white/70 p-3 dark:border-emerald-900 dark:bg-slate-900/70 sm:flex-row"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="也可以粘贴二维码令牌或二维码链接" className="min-h-10 min-w-0 flex-1 rounded-lg border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /><button type="button" onClick={() => void verifyToken(token)} disabled={busyId === 'qr'} className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-50">{busyId === 'qr' ? '核验中…' : '核验令牌'}</button><button type="button" onClick={() => setScannerOpen(true)} className="min-h-10 rounded-lg border border-emerald-700 px-4 text-sm font-black text-emerald-700 dark:text-emerald-300">打开摄像头扫码</button></div> : null}
    {message ? <p role="status" className="mt-3 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{message}</p> : null}{error ? <p role="alert" className="mt-3 rounded-xl bg-rose-100 px-3 py-2 text-sm font-black text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{error}</p> : null}
    <div className="mt-4 space-y-3">{loading && !rows.length ? <p className="py-6 text-center text-sm font-bold text-slate-500">加载中…</p> : rows.map((registration) => <article key={registration.id} className="rounded-xl border border-sky-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-black text-brand-950 dark:text-slate-100">{registration.User.nickname} · E院ID {registration.User.uid}</h3><p className="mt-1 text-xs font-bold text-slate-500">报名于 {new Date(registration.registeredAt).toLocaleString('zh-CN', { hour12: false })}{registration.cancelledAt ? ` · 取消于 ${new Date(registration.cancelledAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</p></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${registration.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' : registration.verifiedAt ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{registration.status === 'CANCELLED' ? '已取消' : registration.verifiedAt ? `已核销（${registration.verificationMethod || '—'}）` : '有效报名'}</span>{verificationMode === 'MANUAL' && registration.status === 'ACTIVE' && !registration.verifiedAt ? <button type="button" onClick={() => void verifyRegistration(registration.id)} disabled={Boolean(busyId)} className="min-h-9 rounded-full bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-50">{busyId === registration.id ? '核销中…' : '手动核销'}</button> : null}</div></div>{registration.answers.length ? <dl className="mt-3 grid gap-2 border-t border-sky-100 pt-3 sm:grid-cols-2 dark:border-slate-700">{registration.answers.map((answer) => <div key={answer.questionId} className="min-w-0 text-sm"><dt className="font-black text-slate-500">{answer.questionTitle}</dt><dd className="mt-1 break-words font-bold text-slate-800 dark:text-slate-200">{Array.isArray(answer.value) ? answer.value.join('、') : answer.value}</dd></div>)}</dl> : <p className="mt-3 border-t border-sky-100 pt-3 text-xs font-bold text-slate-500 dark:border-slate-700">轻量确认报名，无额外问题。</p>}</article>)}{!loading && !rows.length ? <p className="py-6 text-center text-sm font-bold text-slate-500">没有匹配的报名记录。</p> : null}</div>
    <ActivityRegistrationScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={(value) => void verifyToken(value)} />
  </section>
}
