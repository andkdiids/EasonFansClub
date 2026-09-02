'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ActivityRegistrationQr } from '@/components/activities/ActivityRegistrationQr'
import { ACTIVITY_REGISTRATION_CANCEL_CLOSED, activityRegistrationCancelClosedMessage, getActivityRegistrationState, isActivityRegistrationCancellationOpen, type ActivityRegistrationQuestionView, type ActivityRegistrationState, type ActivityRegistrationView } from '@/lib/activity-registration-shared'
import type { ActivityView } from '@/lib/activity'

function questionValue(registration: ActivityRegistrationView | null, questionId: string) {
  return registration?.answers.find((answer) => answer.questionId === questionId)?.value
}

function emptyAnswers(questions: ActivityRegistrationQuestionView[]) {
  return Object.fromEntries(questions.map((question) => [question.id, question.type === 'MULTI_SELECT' ? [] : ''])) as Record<string, string | string[]>
}

function stateLabel(state: ActivityRegistrationState) {
  switch (state) {
    case 'NOT_STARTED': return '报名未开始'
    case 'CLOSED': return '报名已结束'
    case 'FULL': return '报名已满'
    case 'CANCELLED': return '活动已取消'
    default: return '立即报名'
  }
}

function feeLabel(amount: number) {
  return amount > 0 ? `${amount} 挂号费` : '免费'
}

function linkedMaterialStatusLabel(status: string) {
  if (status === 'REDEEMED') return '已核销'
  if (status === 'CANCELLED' || status === 'REFUNDED') return '兑换已取消'
  return '待核销'
}

function linkedMaterialAvailabilityLabel(activity: ActivityView) {
  if (!activity.linkedMaterial) return ''
  return activity.linkedMaterial.stockRemaining < 1 ? '活动物料已兑换完' : activity.linkedMaterial.status !== 'PUBLISHED' ? '活动物料暂不可用' : ''
}

export function ActivityRegistrationButton({ activity, isAuthenticated, initialRegistration, questions, initialRegistrationCount, initialRegistrationState, initialCanRegister }: Readonly<{
  activity: ActivityView
  isAuthenticated: boolean
  initialRegistration: ActivityRegistrationView | null
  questions: ActivityRegistrationQuestionView[]
  initialRegistrationCount: number
  initialRegistrationState?: ActivityRegistrationState
  initialCanRegister?: boolean
}>) {
  const initialAvailability = getActivityRegistrationState(activity, initialRegistrationCount)
  const activityMaterialUnavailableLabel = linkedMaterialAvailabilityLabel(activity)
  const activityMaterialUnavailable = Boolean(activityMaterialUnavailableLabel)
  const [registration, setRegistration] = useState<ActivityRegistrationView | null>(initialRegistration)
  const [registrationCount, setRegistrationCount] = useState(initialRegistrationCount)
  const [registrationState, setRegistrationState] = useState<ActivityRegistrationState>(initialRegistrationState || initialAvailability.state)
  const [canRegister, setCanRegister] = useState((initialCanRegister ?? initialAvailability.canRegister) && activity.status !== 'CANCELLED' && !activityMaterialUnavailable && initialRegistration?.status !== 'CANCELLED')
  const [submitting, setSubmitting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() => initialRegistration?.status === 'ACTIVE'
    ? Object.fromEntries(questions.map((question) => {
        const value = questionValue(initialRegistration, question.id)
        return [question.id, value ?? (question.type === 'MULTI_SELECT' ? [] : '')]
      }))
    : emptyAnswers(questions))
  const [message, setMessage] = useState('')
  const loginHref = `/login?redirect=${encodeURIComponent(`/activities/${activity.id}`)}`
  const isRegistered = registration?.status === 'ACTIVE'
  const isCancelled = registration?.status === 'CANCELLED'
  const isActivityCancelled = activity.status === 'CANCELLED'
  useEffect(() => {
    if (!isActivityCancelled) return
    setCanRegister(false)
    setDialogOpen(false)
    setCancelDialogOpen(false)
  }, [isActivityCancelled])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const registrationEnd = activity.registrationEndAt ? new Date(activity.registrationEndAt).getTime() : null
    if (registrationEnd === null || !Number.isFinite(registrationEnd)) return
    const delay = registrationEnd - Date.now()
    if (delay <= 0) {
      setNow(Date.now())
      setCancelDialogOpen(false)
      setMessage(activityRegistrationCancelClosedMessage)
      return
    }
    const timer = window.setTimeout(() => {
      setNow(Date.now())
      setCancelDialogOpen(false)
      setMessage(activityRegistrationCancelClosedMessage)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [activity.registrationEndAt])
  const canCancelByTime = isActivityRegistrationCancellationOpen(activity, new Date(now))
  const linkedMaterialRedeemed = registration?.linkedMaterialRedemption?.status === 'REDEEMED'
  const canCancelByVerification = Boolean(!isActivityCancelled && isRegistered && !registration?.verifiedAt && !linkedMaterialRedeemed)
  const hasQuestions = questions.length > 0
  const currentLabel = isRegistered && registration?.verifiedAt
    ? '已核销'
    : isCancelled
      ? '已取消报名'
      : isRegistered
        ? '已报名'
    : isActivityCancelled
      ? '活动取消'
      : activityMaterialUnavailable
        ? activityMaterialUnavailableLabel
      : registrationState === 'AVAILABLE'
        ? (registration ? '报名已记录' : '立即报名')
        : stateLabel(registrationState)

  const answerSummary = useMemo(() => questions.map((question) => ({ question, value: questionValue(registration, question.id) })).filter((item) => item.value !== undefined), [questions, registration])

  function openDialog() {
    if (!isAuthenticated) return
    if (isActivityCancelled || !canRegister || submitting || isRegistered || isCancelled || activityMaterialUnavailable) return
    setMessage('')
    setDialogOpen(true)
  }

  async function submitRegistration() {
    if (isActivityCancelled || submitting || !canRegister || isRegistered || activityMaterialUnavailable) return
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/register`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, answers }),
      })
      const data = await response.json().catch(() => null) as { message?: string; code?: string; registration?: ActivityRegistrationView; registrationCount?: number; registrationState?: ActivityRegistrationState; canRegister?: boolean } | null
      if (!data) {
        setMessage('服务器响应无效，请稍后重试')
        return
      }
      if (!response.ok) {
        if (data?.registrationState && ['AVAILABLE', 'NOT_STARTED', 'CLOSED', 'FULL', 'ENDED', 'CANCELLED'].includes(data.registrationState)) setRegistrationState(data.registrationState)
        setMessage(data?.message || '报名失败，请稍后重试')
        if (data.code === 'ACTIVITY_MATERIAL_UNAVAILABLE') setCanRegister(false)
        return
      }
      if (data.registration) setRegistration(data.registration)
      if (typeof data.registrationCount === 'number') setRegistrationCount(data.registrationCount)
      if (data.registrationState) setRegistrationState(data.registrationState)
      setCanRegister(false)
      setDialogOpen(false)
      setMessage('报名成功')
    } catch {
      setMessage('网络连接失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  function cancelRegistration() {
    if (isActivityCancelled || submitting || !canCancelByVerification || !canCancelByTime) return
    setMessage('')
    setCancelDialogOpen(true)
  }

  async function confirmCancelRegistration() {
    if (isActivityCancelled || submitting || !canCancelByVerification || !canCancelByTime) return
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/register/cancel`, { method: 'POST', credentials: 'same-origin' })
      const data = await response.json().catch(() => null) as { code?: string; message?: string; registrationCount?: number } | null
      if (!response.ok) {
        if (data?.code === ACTIVITY_REGISTRATION_CANCEL_CLOSED) {
          setCancelDialogOpen(false)
          setNow(Date.now())
          setMessage(activityRegistrationCancelClosedMessage)
          return
        }
        setMessage(data?.message || '取消报名失败，请稍后重试')
        return
      }
      setRegistration((current) => current ? { ...current, status: 'CANCELLED', cancelledAt: new Date().toISOString() } : null)
      setAnswers(emptyAnswers(questions))
      if (typeof data?.registrationCount === 'number') setRegistrationCount(data.registrationCount)
      setCanRegister(false)
      setCancelDialogOpen(false)
      setMessage(registration?.paidRegistrationFee ? `${registration.paidRegistrationFee} 挂号费已退回；你已取消过本活动，无法再次报名` : '本次免费报名已取消；你已取消过本活动，无法再次报名')
    } catch {
      setMessage('网络连接失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-black text-[var(--primary-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55'
  const registrationText = activity.signupLimit !== null && activity.signupLimit > 0 ? `报名人数：${registrationCount}/${activity.signupLimit}` : `已报名：${registrationCount} 人`

  return (
    <section className="mt-7 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 sm:p-5" aria-labelledby={`activity-registration-${activity.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id={`activity-registration-${activity.id}`} className="text-lg font-black text-[var(--foreground)]">我的报名</h2><p className="mt-1 text-sm font-bold text-[var(--foreground-muted)]">{registrationText}</p></div>
        {isRegistered && registration?.verifiedAt ? <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-[var(--success)]">{registration.checkInSource === 'AUTO_AFTER_ACTIVITY_END' ? '活动结束自动核销' : '已核销'}</span> : isCancelled ? <span className="rounded-full bg-slate-500/15 px-3 py-1 text-xs font-black text-[var(--foreground-muted)]">已取消报名</span> : isActivityCancelled ? <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-black text-[var(--danger)]">活动取消</span> : null}
      </div>
      {!isActivityCancelled && !isRegistered && !isCancelled ? <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-4 text-sm font-bold text-[var(--foreground-muted)]"><span>报名费用</span><strong className="text-[var(--foreground)]">{feeLabel(activity.registrationFee)}</strong></div> : null}
      {!isRegistered && !isCancelled && canRegister && activity.linkedMaterial ? <p className="mt-2 text-xs font-bold leading-5 text-[var(--foreground-muted)]">报名即代表兑换本活动物料 ×1</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!isAuthenticated ? (
          !isActivityCancelled && !isCancelled && !activityMaterialUnavailable && registrationState === 'AVAILABLE' ? <Link href={loginHref} className={buttonClass}>登录后报名</Link> : <button type="button" disabled className={buttonClass}>{currentLabel}</button>
        ) : (
          <button type="button" onClick={openDialog} disabled={submitting || isActivityCancelled || isRegistered || isCancelled || !canRegister} className={buttonClass}>{submitting ? '处理中…' : currentLabel}</button>
        )}
        {canCancelByVerification && canCancelByTime ? <button type="button" onClick={() => void cancelRegistration()} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-black text-[var(--foreground-muted)] disabled:opacity-50">取消报名</button> : null}
        {isRegistered && canCancelByVerification && !canCancelByTime ? <span className="text-xs font-bold text-[var(--foreground-muted)]">{activityRegistrationCancelClosedMessage}</span> : null}
        {isRegistered && !registration?.verifiedAt && linkedMaterialRedeemed ? <span className="text-xs font-bold text-[var(--foreground-muted)]">绑定活动物料已核销，无法取消报名。</span> : null}
        {message ? <span role="status" className="text-sm font-bold text-[var(--foreground-muted)]">{message}</span> : null}
      </div>
      {isRegistered ? <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 text-sm font-bold text-[var(--foreground-muted)] sm:grid-cols-2"><p>已支付：<span className="font-black text-[var(--foreground)]">{feeLabel(registration.paidRegistrationFee)}</span></p>{registration.linkedMaterialRedemption ? <p>活动物料：<span className="font-black text-[var(--foreground)]">{registration.linkedMaterialRedemption.title} ×1</span><br /><span className="text-xs">{linkedMaterialStatusLabel(registration.linkedMaterialRedemption.status)} · {registration.linkedMaterialRedemption.redeemCode}</span></p> : null}</div> : null}
      {isActivityCancelled ? isRegistered && registration?.verifiedAt ? <p className="mt-4 border-t-[color-mix(in_srgb,var(--danger)_40%,var(--border))] pt-4 text-sm font-bold text-[var(--danger)]">本活动已取消；您的报名已核销，核销记录与已发生的物料历史保留，本次不退款。</p> : isCancelled ? <p className="mt-4 border-t-[color-mix(in_srgb,var(--danger)_40%,var(--border))] pt-4 text-sm font-bold text-[var(--danger)]">本活动已取消；报名已取消，{registration?.paidRegistrationFee ? `${registration.paidRegistrationFee} 挂号费已按本次实际支付金额退回` : '本次免费报名无需退款'}。</p> : <p className="mt-4 border-t-[color-mix(in_srgb,var(--danger)_40%,var(--border))] pt-4 text-sm font-bold text-[var(--danger)]">本活动已取消，无法继续报名、核销或兑奖。</p> : isCancelled ? <p className="mt-4 border-t-[color-mix(in_srgb,var(--warning)_40%,var(--border))] pt-4 text-sm font-bold text-[var(--warning)]">报名已取消，{registration?.paidRegistrationFee ? `${registration.paidRegistrationFee} 挂号费已退回` : '本次免费报名已取消'}。根据活动规则，你已取消过本活动，无法再次报名。</p> : null}
      {isRegistered && answerSummary.length ? <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">{answerSummary.map(({ question, value }) => <div key={question.id} className="text-sm"><span className="font-black text-[var(--foreground-muted)]">{question.title}</span><p className="mt-1 whitespace-pre-wrap break-words font-bold text-[var(--foreground)]">{Array.isArray(value) ? value.join('、') : value}</p></div>)}</div> : null}
      {isRegistered && !isActivityCancelled && activity.verificationMode === 'QR' && registration?.verificationToken ? <div className="mt-4 border-t border-[var(--border)] pt-4"><ActivityRegistrationQr activityId={activity.id} token={registration.verificationToken} verifiedAt={registration.verifiedAt} /></div> : null}
      {cancelDialogOpen ? <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby={`activity-cancel-dialog-${activity.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setCancelDialogOpen(false) }}><div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 text-[var(--foreground)] shadow-2xl sm:p-7"><h2 id={`activity-cancel-dialog-${activity.id}`} className="text-xl font-black">确认取消报名？</h2><p className="mt-3 text-sm font-bold leading-6 text-[var(--foreground-muted)]">取消后：<br />1. 本次报名实际扣除的挂号费将原路退回；<br />2. 自动兑换的活动物料将同步取消；<br />3. 物料库存将恢复；<br />4. 取消后将不能再次报名本活动。</p><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setCancelDialogOpen(false)} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-5 py-2 text-sm font-black text-[var(--foreground-muted)]">暂不取消</button><button type="button" onClick={() => void confirmCancelRegistration()} disabled={submitting} className="min-h-11 rounded-full bg-rose-700 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{submitting ? '处理中…' : '确认取消报名'}</button></div></div></div> : null}
      {dialogOpen ? <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby={`activity-registration-dialog-${activity.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false) }}><div className="max-h-[min(90dvh,48rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 text-[var(--foreground)] shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-3"><div><h2 id={`activity-registration-dialog-${activity.id}`} className="text-xl font-black">确认报名</h2><p className="mt-1 text-sm font-bold text-[var(--foreground-muted)]">{activity.title}</p></div><button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} className="text-2xl leading-none text-[var(--foreground-muted)]" aria-label="关闭">×</button></div><div className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--success)_40%,var(--border))] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] p-4 text-sm font-bold leading-6 text-[var(--foreground)]"><p>报名费用：<span className="font-black">{feeLabel(activity.registrationFee)}</span></p><p>{activity.registrationFee > 0 ? `确认后将立即扣除 ${activity.registrationFee} 挂号费。` : '确认后不会扣除挂号费。'}</p><p>{activity.registrationFee > 0 ? '在报名结束前取消报名可退回本次实际支付费用。' : '免费报名也会保留报名记录。'}取消报名后不可再次报名本活动。</p>{activity.feeDescription ? <p className="mt-2 whitespace-pre-wrap break-words">{activity.feeDescription}</p> : null}{activity.linkedMaterial ? <p className="mt-2 border-t-[color-mix(in_srgb,var(--success)_40%,var(--border))] pt-2">报名福利：{activity.linkedMaterial.title} ×1，报名成功后自动兑换，无需另外消耗挂号费。</p> : null}</div>{hasQuestions ? <div className="mt-5 space-y-4">{questions.map((question) => <label key={question.id} className="block text-sm font-black">{question.title}{question.required ? <span className="ml-1 text-rose-600">*</span> : null}{question.type === 'TEXTAREA' ? <textarea value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.placeholder || ''} className="mt-1 min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--foreground)]" /> : question.type === 'SINGLE_SELECT' || question.type === 'SELECT' ? <select value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)]"><option value="">请选择</option>{question.options.map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select> : question.type === 'MULTI_SELECT' ? <span className="mt-2 grid gap-2 sm:grid-cols-2">{question.options.map((option) => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []; return <label key={option.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold"><input type="checkbox" checked={current.includes(option.value)} onChange={(event) => setAnswers((all) => ({ ...all, [question.id]: event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value) }))} />{option.label}</label> })}</span> : <input type={question.type === 'NUMBER' ? 'number' : question.type === 'PHONE' ? 'tel' : 'text'} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.placeholder || ''} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)]" />}</label>)}</div> : <p className="mt-5 rounded-xl bg-[var(--surface-subtle)] px-4 py-3 text-sm font-bold text-[var(--foreground-muted)]">当前没有额外问题，确认后即可完成站内报名。</p>}<div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-5 py-2 text-sm font-black text-[var(--foreground-muted)]">取消</button><button type="button" onClick={() => void submitRegistration()} disabled={submitting} className={buttonClass}>{submitting ? '提交中…' : '确认报名'}</button></div></div></div> : null}
    </section>
  )
}
