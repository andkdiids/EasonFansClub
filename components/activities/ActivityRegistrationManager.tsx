'use client'

import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ActivityRegistrationScanner } from '@/components/activities/ActivityRegistrationScanner'
import { ActivityLotteryManager } from '@/components/activities/ActivityLotteryManager'
import type { ActivityLotteryWinnerRedemptionState } from '@/lib/activity-lottery'

type RegistrationRow = {
  id: string
  status: 'ACTIVE' | 'CANCELLED'
  displayStatus?: 'ACTIVE' | 'VERIFIED' | 'CANCELLED'
  registeredAt: string
  cancelledAt: string | null
  verifiedAt: string | null
  verificationMethod: 'MANUAL' | 'QR' | null
  checkedInAt: string | null
  checkInSource: 'MANUAL' | 'QR' | 'AUTO_AFTER_ACTIVITY_END' | null
  paidRegistrationFee: number
  linkedMaterialRedemption: { id: string; title: string; status: string; redeemCode: string; redeemedAt: string | null } | null
  User: { id: string; uid: number; username: string; nickname: string; avatarUrl: string | null }
  answers: Array<{ questionId: string; questionTitle: string; value: string | string[] }>
}

type ActivityMeta = {
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'
  startsAt: string | null
  endsAt: string | null
  registrationStartAt: string | null
  registrationEndAt: string | null
  signupLimit: number | null
  registrationFee: number
  feeDescription: string | null
  verificationMode: 'NONE' | 'MANUAL' | 'QR'
  reward: { id: string; name: string; code: string } | null
}

type RedemptionEntitlement = {
  type: 'ACTIVITY_REGISTRATION' | 'MATERIAL' | 'LOTTERY_PRIZE'
  id: string
  title: string
  subtitle: string | null
  quantity: number
  status: 'PENDING' | 'REDEEMED' | 'UNAVAILABLE'
  redeemable: boolean
  selectable: boolean
  defaultSelected: boolean
  requires: RedemptionEntitlement['type'][]
  blockedReason: string | null
  redeemedAt: string | null
  redemptionState?: ActivityLotteryWinnerRedemptionState
}

type RedemptionPreview = {
  token: string
  activity: { id: string; title: string }
  user: { uid: number; nickname: string; avatarUrl: string | null }
  entitlements: RedemptionEntitlement[]
}

export function ActivityRegistrationManager({ activityId, activityTitle, verificationMode, refreshSignal = 0, onClose }: Readonly<{ activityId: string; activityTitle: string; verificationMode: 'NONE' | 'MANUAL' | 'QR'; refreshSignal?: number; onClose: () => void }>) {
  const [rows, setRows] = useState<RegistrationRow[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [token, setToken] = useState('')
  const [summary, setSummary] = useState({ activeCount: 0, verifiedCount: 0, unverifiedActiveCount: 0, cancelledCount: 0, activePaidFeeTotal: 0, unverifiedActivePaidFeeTotal: 0 })
  const [activityMeta, setActivityMeta] = useState<ActivityMeta | null>(null)
  const [cancelTarget, setCancelTarget] = useState<RegistrationRow | null>(null)
  const [cancelAllOpen, setCancelAllOpen] = useState(false)
  const [redemptionPreview, setRedemptionPreview] = useState<RedemptionPreview | null>(null)
  const [selectedEntitlements, setSelectedEntitlements] = useState<string[]>([])
  const [lotteryRefreshSignal, setLotteryRefreshSignal] = useState(0)

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

  useEffect(() => { void load() }, [load, refreshSignal])

  useEffect(() => {
    if (activityMeta?.status !== 'CANCELLED') return
    setScannerOpen(false)
    setRedemptionPreview(null)
    setSelectedEntitlements([])
  }, [activityMeta?.status])

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

  async function cancelRegistration(registrationId: string) {
    setBusyId(`cancel:${registrationId}`); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/registrations/${encodeURIComponent(registrationId)}/cancel`, { method: 'POST', credentials: 'same-origin' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '取消报名失败')
      setCancelTarget(null)
      setLotteryRefreshSignal((value) => value + 1)
      setMessage(data?.alreadyCancelled ? '该报名已经是已取消，本次操作未重复退款' : data?.refundedAmount ? `报名已取消，已退回 ${data.refundedAmount} 挂号费` : '报名已取消（免费报名，未产生退款流水）')
      await load()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : '取消报名失败')
    } finally { setBusyId('') }
  }

  async function cancelAllRegistrations() {
    setBusyId('cancel-all'); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/registrations/cancel-all`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '批量取消报名失败')
      setCancelAllOpen(false)
      setLotteryRefreshSignal((value) => value + 1)
      setMessage(`批量取消完成：取消 ${data?.cancelled || 0} 人，退款 ${data?.refundedCount || 0} 笔，共 ${data?.refundedAmount || 0} 挂号费`)
      await load()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : '批量取消报名失败')
    } finally { setBusyId('') }
  }

  const verifyToken = useCallback(async (rawToken: string) => {
    const nextToken = rawToken.trim()
    if (!nextToken) return
    setScannerOpen(false); setBusyId('qr'); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/verify`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: nextToken }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '扫码查询失败')
      const preview = data?.activity && data?.user && Array.isArray(data?.entitlements)
        ? { token: nextToken, activity: data.activity, user: data.user, entitlements: data.entitlements as RedemptionEntitlement[] }
        : null
      if (!preview) throw new Error('扫码结果格式不正确')
      setToken('')
      setRedemptionPreview(preview)
      setSelectedEntitlements(preview.entitlements.filter((item) => item.defaultSelected).map((item) => `${item.type}:${item.id}`))
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '扫码查询失败')
    } finally { setBusyId('') }
  }, [activityId])

  async function confirmRedemption() {
    if (!redemptionPreview) return
    const entitlements = redemptionPreview.entitlements
      .filter((item) => selectedEntitlements.includes(`${item.type}:${item.id}`) && item.selectable)
      .map((item) => ({ type: item.type, id: item.id }))
    if (!entitlements.length) {
      setError('请至少选择一项待核销权益')
      return
    }
    setBusyId('qr-confirm'); setMessage(''); setError('')
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activityId)}/redemption-confirm`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: redemptionPreview.token, entitlements }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '核销失败')
      const redeemed = Array.isArray(data?.results) ? data.results.filter((item: { status?: string }) => item.status === 'REDEEMED').length : 0
      const already = Array.isArray(data?.results) ? data.results.filter((item: { status?: string }) => item.status === 'ALREADY_REDEEMED').length : 0
      setMessage(already && !redeemed ? '所选权益已经核销，本次操作幂等完成' : `核销成功${redeemed ? `，完成 ${redeemed} 项` : ''}`)
      setRedemptionPreview(null)
      setSelectedEntitlements([])
      await load()
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : '核销失败')
    } finally { setBusyId('') }
  }

  const formatDate = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
  const verificationLabel = activityMeta?.verificationMode === 'QR' ? '扫码核销' : activityMeta?.verificationMode === 'MANUAL' ? '手动核销' : '不需要核销'
  const checkInSourceLabel = (source: RegistrationRow['checkInSource']) => source === 'AUTO_AFTER_ACTIVITY_END' ? '活动结束自动核销' : source === 'QR' ? '现场扫码' : source === 'MANUAL' ? '手动核销' : '—'
  const registrationWindow = activityMeta?.registrationStartAt || activityMeta?.registrationEndAt
    ? `${formatDate(activityMeta.registrationStartAt) || '不限开始时间'} — ${formatDate(activityMeta.registrationEndAt) || '不限截止时间'}`
    : '不限开始时间，不限截止时间'
  const hasSelectableEntitlements = redemptionPreview?.entitlements.some((item) => item.selectable) ?? false

  return <section className="rounded-[28px] border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black tracking-[0.18em] text-emerald-700 dark:text-emerald-300">报名管理</p><h2 className="mt-1 break-words text-2xl font-black text-brand-950 dark:text-slate-100">{activityTitle}</h2><p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300">未核销 {summary.unverifiedActiveCount} · 已核销 {summary.verifiedCount} · 已取消 {summary.cancelledCount}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setCancelAllOpen(true)} disabled={!summary.unverifiedActiveCount || Boolean(busyId)} className="min-h-10 rounded-full bg-rose-700 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">取消所有未核销报名</button><button type="button" onClick={onClose} className="min-h-10 rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">收起</button></div></div>
    {activityMeta ? <div className="mt-4 grid gap-2 rounded-xl border border-emerald-200 bg-white/70 p-3 text-xs font-bold leading-5 text-slate-600 dark:border-emerald-900 dark:bg-slate-900/70 dark:text-slate-300 sm:grid-cols-2"><p>活动时间：{formatDate(activityMeta.startsAt) || '未设置'}{activityMeta.endsAt ? ` — ${formatDate(activityMeta.endsAt)}` : ''}</p><p>报名时间：{registrationWindow}</p><p>报名名额：{activityMeta.signupLimit && activityMeta.signupLimit > 0 ? `${summary.activeCount}/${activityMeta.signupLimit}` : `${summary.activeCount} 人（不限人数）`}</p><p>报名费用：{activityMeta.registrationFee > 0 ? `${activityMeta.registrationFee} 挂号费` : '免费'}</p><p>核销方式：{verificationLabel}</p>{activityMeta.status === 'CANCELLED' ? <p className="font-black text-rose-700 dark:text-rose-300 sm:col-span-2">活动状态：活动取消；报名二维码不可核销。</p> : null}{activityMeta.reward ? <p className="sm:col-span-2">隐藏奖励：{activityMeta.reward.name} · {activityMeta.reward.code}</p> : null}</div> : null}
    <ActivityLotteryManager activityId={activityId} activityTitle={activityTitle} activityEndAt={activityMeta?.endsAt || null} refreshSignal={refreshSignal + lotteryRefreshSignal} />
    <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load() }} placeholder="搜索昵称、用户名或 E院ID" className="min-h-11 min-w-0 flex-1 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 rounded-xl border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="ALL">全部报名</option><option value="ACTIVE">有效报名</option><option value="VERIFIED">已核销</option><option value="CANCELLED">已取消</option></select><button type="button" onClick={() => void load()} className="min-h-11 rounded-xl bg-brand-950 px-4 text-sm font-black text-white">搜索</button></div>
    {verificationMode === 'QR' && activityMeta?.status !== 'CANCELLED' ? <div className="mt-4 flex flex-col gap-2 rounded-xl border border-emerald-200 bg-white/70 p-3 dark:border-emerald-900 dark:bg-slate-900/70 sm:flex-row"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="输入活动核销码，或粘贴/扫描二维码" className="min-h-10 min-w-0 flex-1 rounded-lg border border-sky-100 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /><button type="button" onClick={() => void verifyToken(token)} disabled={busyId === 'qr'} className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-50">{busyId === 'qr' ? '核验中…' : '核验令牌'}</button><button type="button" onClick={() => setScannerOpen(true)} className="min-h-10 rounded-lg border border-emerald-700 px-4 py-2 text-sm font-black text-emerald-700 dark:text-emerald-300">打开摄像头扫码</button></div> : null}
    {message ? <p role="status" className="mt-3 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{message}</p> : null}{error ? <p role="alert" className="mt-3 rounded-xl bg-rose-100 px-3 py-2 text-sm font-black text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{error}</p> : null}
    {redemptionPreview ? (
      <div role="dialog" aria-modal="true" className="mt-4 rounded-2xl border-2 border-emerald-300 bg-white p-4 shadow-lg dark:border-emerald-700 dark:bg-slate-950 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="size-12 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">{redemptionPreview.user.avatarUrl ? <img src={redemptionPreview.user.avatarUrl} alt="" className="size-full object-cover" /> : null}</div>
            <div><h3 className="font-black text-brand-950 dark:text-slate-100">核销确认</h3><p className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{redemptionPreview.user.nickname} · E院ID {redemptionPreview.user.uid}</p></div>
          </div>
          <button type="button" onClick={() => { setRedemptionPreview(null); setSelectedEntitlements([]) }} className="min-h-9 rounded-full border border-slate-200 px-3 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300">取消</button>
        </div>
        <p className="mt-4 text-sm font-black text-slate-700 dark:text-slate-200">活动：{redemptionPreview.activity.title}</p>
        <div className="mt-3 space-y-2">
          {redemptionPreview.entitlements.map((item) => {
            const key = `${item.type}:${item.id}`
            return <label key={key} className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${item.selectable ? 'border-sky-100 dark:border-slate-700' : 'border-slate-100 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-500'}`}>
              <input type="checkbox" checked={selectedEntitlements.includes(key)} disabled={!item.selectable || busyId === 'qr-confirm'} onChange={() => setSelectedEntitlements((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key])} className="mt-1 size-4" />
              <span className="min-w-0">
                <span className="block font-black">{item.title} ×{item.quantity}</span>
                {item.subtitle ? <span className="mt-1 block text-xs font-bold">{item.subtitle}</span> : null}
                {item.type === 'LOTTERY_PRIZE' && item.redemptionState === 'REDEEMED' ? <span className="mt-1 block text-xs font-black text-emerald-600">已兑奖{item.redeemedAt ? ` · ${formatDate(item.redeemedAt)}` : ''}</span> : item.type === 'LOTTERY_PRIZE' && item.redemptionState === 'EXPIRED' ? <span className="mt-1 block text-xs font-black text-rose-600">已失效，无法兑奖</span> : item.type === 'LOTTERY_PRIZE' && item.redemptionState === 'WAITING_FOR_CHECK_IN' ? <span className="mt-1 block text-xs font-black text-amber-600">需完成活动签到后兑奖，可与活动签到一并核销</span> : item.type === 'LOTTERY_PRIZE' && item.redemptionState === 'REDEEMABLE' ? <span className="mt-1 block text-xs font-black text-sky-600">可兑奖</span> : item.status === 'REDEEMED' ? <span className="mt-1 block text-xs font-black text-emerald-600">已核销{item.redeemedAt ? ` · ${formatDate(item.redeemedAt)}` : ''}</span> : item.selectable ? <span className="mt-1 block text-xs font-black text-sky-600">待核销</span> : <span className="mt-1 block text-xs font-black">{item.blockedReason || '当前不可核销'}</span>}
              </span>
            </label>
          })}
        </div>
        {!hasSelectableEntitlements ? <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-black text-slate-600 dark:bg-slate-900 dark:text-slate-300">当前没有待核销或可兑奖项目。</p> : null}
        <button type="button" onClick={() => void confirmRedemption()} disabled={!hasSelectableEntitlements || busyId === 'qr-confirm'} className="mt-4 min-h-11 w-full rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busyId === 'qr-confirm' ? '核销中…' : '确认核销所选项目'}</button>
      </div>
    ) : null}
    <div className="mt-4 space-y-3">{loading && !rows.length ? <p className="py-6 text-center text-sm font-bold text-slate-500">加载中…</p> : rows.map((registration) => <article key={registration.id} className="rounded-xl border border-sky-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-black text-brand-950 dark:text-slate-100">{registration.User.nickname} · E院ID {registration.User.uid}</h3><p className="mt-1 text-xs font-bold text-slate-500">报名于 {new Date(registration.registeredAt).toLocaleString('zh-CN', { hour12: false })}{registration.cancelledAt ? ` · 取消于 ${new Date(registration.cancelledAt).toLocaleString('zh-CN', { hour12: false })}` : ''}{registration.checkedInAt ? ` · 核销于 ${new Date(registration.checkedInAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</p></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${registration.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' : registration.verifiedAt && registration.checkInSource === 'AUTO_AFTER_ACTIVITY_END' ? 'bg-amber-100 text-amber-700' : registration.verifiedAt ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{registration.status === 'CANCELLED' ? '已取消' : registration.verifiedAt && registration.checkInSource === 'AUTO_AFTER_ACTIVITY_END' ? '活动结束自动核销' : registration.verifiedAt ? `已核销（${registration.verificationMethod || '—'}）` : '有效报名'}</span>{verificationMode === 'MANUAL' && activityMeta?.status !== 'CANCELLED' && registration.status === 'ACTIVE' && !registration.verifiedAt ? <button type="button" onClick={() => void verifyRegistration(registration.id)} disabled={Boolean(busyId)} className="min-h-9 rounded-full bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-50">{busyId === registration.id ? '核销中…' : '手动核销'}</button> : null}{activityMeta?.status !== 'CANCELLED' && registration.status === 'ACTIVE' && !registration.verifiedAt ? <button type="button" onClick={() => setCancelTarget(registration)} disabled={Boolean(busyId)} className="min-h-9 rounded-full border border-rose-700 px-3 text-xs font-black text-rose-700 disabled:opacity-50 dark:text-rose-300">取消报名</button> : null}</div></div><div className="mt-3 grid gap-2 border-t border-sky-100 pt-3 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:grid-cols-2"><p>报名费用：{registration.paidRegistrationFee} 挂号费</p>{registration.linkedMaterialRedemption ? <p>自动兑换物料：{registration.linkedMaterialRedemption.title} · {registration.linkedMaterialRedemption.status === 'REDEEMED' ? '已核销' : registration.linkedMaterialRedemption.status === 'CANCELLED' ? '兑换已取消' : '待核销'}<br />{registration.linkedMaterialRedemption.redeemCode} · {checkInSourceLabel(registration.checkInSource)}</p> : null}</div>{registration.answers.length ? <dl className="mt-3 grid gap-2 border-t border-sky-100 pt-3 sm:grid-cols-2 dark:border-slate-700">{registration.answers.map((answer) => <div key={answer.questionId} className="min-w-0 text-sm"><dt className="font-black text-slate-500">{answer.questionTitle}</dt><dd className="mt-1 break-words font-bold text-slate-800 dark:text-slate-200">{Array.isArray(answer.value) ? answer.value.join('、') : answer.value}</dd></div>)}</dl> : <p className="mt-3 border-t border-sky-100 pt-3 text-xs font-bold text-slate-500 dark:border-slate-700">轻量确认报名，无额外问题。</p>}</article>)}{!loading && !rows.length ? <p className="py-6 text-center text-sm font-bold text-slate-500">没有匹配的报名记录。</p> : null}</div>
    <ActivityRegistrationScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={(value) => void verifyToken(value)} />
    <ConfirmDialog open={Boolean(cancelTarget)} title="取消该用户的报名？" description={cancelTarget ? `仅待核销报名可取消。取消后该报名立即失效，活动二维码不可核销；将按本次实际支付金额退回挂号费（${cancelTarget.paidRegistrationFee} 挂号费）。报名历史会保留。` : ''} confirmLabel="确认取消报名" loading={busyId.startsWith('cancel:')} onConfirm={() => { if (cancelTarget) void cancelRegistration(cancelTarget.id) }} onCancel={() => { if (!busyId) setCancelTarget(null) }} />
    <ConfirmDialog open={cancelAllOpen} title="取消所有未核销报名？" description={`当前共有 ${summary.unverifiedActiveCount} 个未核销有效报名。确认后将取消这些报名、按每条报名实际支付金额自动退款，并使对应报名二维码立即失效。预计退款 ${summary.unverifiedActivePaidFeeTotal} 挂号费；已核销报名不会受到影响，历史记录不会删除。`} confirmLabel="确认取消所有未核销报名" loading={busyId === 'cancel-all'} onConfirm={() => void cancelAllRegistrations()} onCancel={() => { if (!busyId) setCancelAllOpen(false) }} />
  </section>
}
