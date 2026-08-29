'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ActivityRegistrationQr } from '@/components/activities/ActivityRegistrationQr'
import { getActivityRegistrationState, type ActivityRegistrationQuestionView, type ActivityRegistrationState, type ActivityRegistrationView } from '@/lib/activity-registration-shared'
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
  const [canRegister, setCanRegister] = useState((initialCanRegister ?? initialAvailability.canRegister) && !activityMaterialUnavailable && initialRegistration?.status !== 'CANCELLED')
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
  const now = Date.now()
  const canCancelByTime = (!activity.startsAt || new Date(activity.startsAt).getTime() > now) && (!activity.endsAt || new Date(activity.endsAt).getTime() > now)
  const hasQuestions = questions.length > 0
  const currentLabel = isRegistered && registration?.verifiedAt
    ? '已核销'
    : isRegistered
      ? '已报名'
    : isCancelled
      ? '已取消报名'
      : activityMaterialUnavailable
        ? activityMaterialUnavailableLabel
      : registrationState === 'AVAILABLE'
        ? (registration ? '报名已记录' : '立即报名')
        : stateLabel(registrationState)

  const answerSummary = useMemo(() => questions.map((question) => ({ question, value: questionValue(registration, question.id) })).filter((item) => item.value !== undefined), [questions, registration])

  function openDialog() {
    if (!isAuthenticated) return
    if (!canRegister || submitting || isRegistered || isCancelled || activityMaterialUnavailable) return
    setMessage('')
    setDialogOpen(true)
  }

  async function submitRegistration() {
    if (submitting || !canRegister || isRegistered || activityMaterialUnavailable) return
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
    if (submitting || !isRegistered || registration?.verifiedAt || !canCancelByTime) return
    setMessage('')
    setCancelDialogOpen(true)
  }

  async function confirmCancelRegistration() {
    if (submitting || !isRegistered || registration?.verifiedAt || !canCancelByTime) return
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/register/cancel`, { method: 'POST', credentials: 'same-origin' })
      const data = await response.json().catch(() => null) as { message?: string; registrationCount?: number } | null
      if (!response.ok) { setMessage(data?.message || '取消报名失败，请稍后重试'); return }
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
        {isRegistered && registration?.verifiedAt ? <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-[var(--success)]">{registration.checkInSource === 'AUTO_AFTER_ACTIVITY_END' ? '活动结束自动核销' : '已核销'}</span> : null}
      </div>
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm font-bold text-[var(--foreground-muted)]"><p>报名费用：<span className="font-black text-[var(--foreground)]">{feeLabel(activity.registrationFee)}</span></p><p className="mt-2">{activity.registrationFee > 0 ? `报名成功后将立即扣除 ${activity.registrationFee} 挂号费。` : '这是一次免费报名。'}</p><p className="mt-2">{activity.registrationFee > 0 ? '如在活动开始前取消报名，将退还本次实际支付的报名费用。' : '免费报名也会保留报名记录。'}取消报名后不可再次报名本活动。</p>{activity.feeDescription ? <p className="mt-2 whitespace-pre-wrap break-words leading-6">{activity.feeDescription}</p> : null}{activity.linkedMaterial ? <div className="mt-3 border-t border-[var(--border)] pt-3"><p className="font-black text-[var(--foreground)]">报名福利</p><p className="mt-1">报名成功后将自动兑换「{activity.linkedMaterial.title}」×1，无需另外消耗挂号费。</p>{activityMaterialUnavailable ? <p className="mt-2 font-black text-rose-700">{activityMaterialUnavailableLabel}，暂时无法报名。</p> : null}</div> : null}</div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!isAuthenticated ? (
          !isCancelled && !activityMaterialUnavailable && registrationState === 'AVAILABLE' ? <Link href={loginHref} className={buttonClass}>登录后报名</Link> : <button type="button" disabled className={buttonClass}>{currentLabel}</button>
        ) : (
          <button type="button" onClick={openDialog} disabled={submitting || isRegistered || isCancelled || !canRegister} className={buttonClass}>{submitting ? '处理中…' : currentLabel}</button>
        )}
        {isRegistered && !registration.verifiedAt && canCancelByTime ? <button type="button" onClick={() => void cancelRegistration()} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-black text-[var(--foreground-muted)] disabled:opacity-50">取消报名</button> : null}
        {isRegistered && !registration.verifiedAt && !canCancelByTime ? <span className="text-xs font-bold text-[var(--foreground-muted)]">活动即将开始，已不能取消报名</span> : null}
        {message ? <span role="status" className="text-sm font-bold text-[var(--foreground-muted)]">{message}</span> : null}
      </div>
      {isRegistered ? <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 text-sm font-bold text-[var(--foreground-muted)] sm:grid-cols-2"><p>已支付：<span className="font-black text-[var(--foreground)]">{feeLabel(registration.paidRegistrationFee)}</span></p>{registration.linkedMaterialRedemption ? <p>活动物料：<span className="font-black text-[var(--foreground)]">{registration.linkedMaterialRedemption.title} ×1</span><br /><span className="text-xs">{linkedMaterialStatusLabel(registration.linkedMaterialRedemption.status)} · {registration.linkedMaterialRedemption.redeemCode}</span></p> : null}</div> : null}
      {isCancelled ? <p className="mt-4 border-t border-amber-200 pt-4 text-sm font-bold text-amber-800">报名已取消，{registration?.paidRegistrationFee ? `${registration.paidRegistrationFee} 挂号费已退回` : '本次免费报名已取消'}。根据活动规则，你已取消过本活动，无法再次报名。</p> : null}
      {isRegistered && answerSummary.length ? <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">{answerSummary.map(({ question, value }) => <div key={question.id} className="text-sm"><span className="font-black text-[var(--foreground-muted)]">{question.title}</span><p className="mt-1 whitespace-pre-wrap break-words font-bold text-[var(--foreground)]">{Array.isArray(value) ? value.join('、') : value}</p></div>)}</div> : null}
      {isRegistered && activity.verificationMode === 'QR' && registration?.verificationToken ? <div className="mt-4 border-t border-[var(--border)] pt-4"><ActivityRegistrationQr activityId={activity.id} token={registration.verificationToken} verifiedAt={registration.verifiedAt} /></div> : null}
      {cancelDialogOpen ? <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby={`activity-cancel-dialog-${activity.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setCancelDialogOpen(false) }}><div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 text-[var(--foreground)] shadow-2xl sm:p-7"><h2 id={`activity-cancel-dialog-${activity.id}`} className="text-xl font-black">确认取消报名？</h2><p className="mt-3 text-sm font-bold leading-6 text-[var(--foreground-muted)]">取消后：<br />1. 本次报名实际扣除的挂号费将原路退回；<br />2. 自动兑换的活动物料将同步取消；<br />3. 物料库存将恢复；<br />4. 取消后将不能再次报名本活动。</p><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setCancelDialogOpen(false)} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-5 py-2 text-sm font-black text-[var(--foreground-muted)]">暂不取消</button><button type="button" onClick={() => void confirmCancelRegistration()} disabled={submitting} className="min-h-11 rounded-full bg-rose-700 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{submitting ? '处理中…' : '确认取消报名'}</button></div></div></div> : null}
      {dialogOpen ? <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby={`activity-registration-dialog-${activity.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false) }}><div className="max-h-[min(90dvh,48rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 text-[var(--foreground)] shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-3"><div><h2 id={`activity-registration-dialog-${activity.id}`} className="text-xl font-black">确认报名</h2><p className="mt-1 text-sm font-bold text-[var(--foreground-muted)]">{activity.title}</p></div><button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} className="text-2xl leading-none text-[var(--foreground-muted)]" aria-label="关闭">×</button></div><div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm font-bold leading-6 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-100"><p>报名费用：<span className="font-black">{feeLabel(activity.registrationFee)}</span></p><p>{activity.registrationFee > 0 ? `确认后将立即扣除 ${activity.registrationFee} 挂号费。` : '确认后不会扣除挂号费。'}</p><p>{activity.registrationFee > 0 ? '活动开始前取消报名可退回本次实际支付费用。' : '免费报名也会保留报名记录。'}取消报名后不可再次报名本活动。</p>{activity.feeDescription ? <p className="mt-2 whitespace-pre-wrap break-words">{activity.feeDescription}</p> : null}{activity.linkedMaterial ? <p className="mt-2 border-t border-emerald-200 pt-2 dark:border-emerald-900/70">报名福利：{activity.linkedMaterial.title} ×1，报名成功后自动兑换，无需另外消耗挂号费。</p> : null}</div>{hasQuestions ? <div className="mt-5 space-y-4">{questions.map((question) => <label key={question.id} className="block text-sm font-black">{question.title}{question.required ? <span className="ml-1 text-rose-600">*</span> : null}{question.type === 'TEXTAREA' ? <textarea value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.placeholder || ''} className="mt-1 min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--foreground)]" /> : question.type === 'SINGLE_SELECT' || question.type === 'SELECT' ? <select value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)]"><option value="">请选择</option>{question.options.map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select> : question.type === 'MULTI_SELECT' ? <span className="mt-2 grid gap-2 sm:grid-cols-2">{question.options.map((option) => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []; return <label key={option.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold"><input type="checkbox" checked={current.includes(option.value)} onChange={(event) => setAnswers((all) => ({ ...all, [question.id]: event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value) }))} />{option.label}</label> })}</span> : <input type={question.type === 'NUMBER' ? 'number' : question.type === 'PHONE' ? 'tel' : 'text'} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.placeholder || ''} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)]" />}</label>)}</div> : <p className="mt-5 rounded-xl bg-[var(--surface-subtle)] px-4 py-3 text-sm font-bold text-[var(--foreground-muted)]">当前没有额外问题，确认后即可完成站内报名。</p>}<div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-5 py-2 text-sm font-black text-[var(--foreground-muted)]">取消</button><button type="button" onClick={() => void submitRegistration()} disabled={submitting} className={buttonClass}>{submitting ? '提交中…' : '确认报名'}</button></div></div></div> : null}
    </section>
  )
}
