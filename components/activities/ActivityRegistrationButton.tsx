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
  const [registration, setRegistration] = useState<ActivityRegistrationView | null>(initialRegistration)
  const [registrationCount, setRegistrationCount] = useState(initialRegistrationCount)
  const [registrationState, setRegistrationState] = useState<ActivityRegistrationState>(initialRegistrationState || initialAvailability.state)
  const [canRegister, setCanRegister] = useState(initialCanRegister ?? initialAvailability.canRegister)
  const [submitting, setSubmitting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() => initialRegistration?.status === 'ACTIVE'
    ? Object.fromEntries(questions.map((question) => {
        const value = questionValue(initialRegistration, question.id)
        return [question.id, value ?? (question.type === 'MULTI_SELECT' ? [] : '')]
      }))
    : emptyAnswers(questions))
  const [message, setMessage] = useState('')
  const loginHref = `/login?redirect=${encodeURIComponent(`/activities/${activity.id}`)}`
  const isRegistered = registration?.status === 'ACTIVE'
  const hasQuestions = questions.length > 0
  const currentLabel = isRegistered && registration?.verifiedAt
    ? '已核销'
    : isRegistered
      ? '已报名'
      : registrationState === 'AVAILABLE'
        ? (registration ? '重新报名' : '立即报名')
        : stateLabel(registrationState)

  const answerSummary = useMemo(() => questions.map((question) => ({ question, value: questionValue(registration, question.id) })).filter((item) => item.value !== undefined), [questions, registration])

  function openDialog() {
    if (!isAuthenticated) return
    if (!canRegister || submitting || isRegistered) return
    if (registration?.status === 'CANCELLED') setAnswers(emptyAnswers(questions))
    setMessage('')
    setDialogOpen(true)
  }

  async function submitRegistration() {
    if (submitting || !canRegister || isRegistered) return
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/register`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, answers }),
      })
      const data = await response.json().catch(() => null) as { message?: string; registration?: ActivityRegistrationView; registrationCount?: number; registrationState?: ActivityRegistrationState; canRegister?: boolean } | null
      if (!data) {
        setMessage('服务器响应无效，请稍后重试')
        return
      }
      if (!response.ok) {
        if (data?.registrationState && ['AVAILABLE', 'NOT_STARTED', 'CLOSED', 'FULL', 'ENDED', 'CANCELLED'].includes(data.registrationState)) setRegistrationState(data.registrationState)
        setMessage(data?.message || '报名失败，请稍后重试')
        return
      }
      if (data.registration) setRegistration(data.registration)
      if (typeof data.registrationCount === 'number') setRegistrationCount(data.registrationCount)
      if (data.registrationState) setRegistrationState(data.registrationState)
      setCanRegister(data.canRegister === true)
      setDialogOpen(false)
      setMessage('报名成功')
    } catch {
      setMessage('网络连接失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelRegistration() {
    if (submitting || !isRegistered || registration?.verifiedAt) return
    if (!window.confirm('确定取消这场活动的报名吗？取消后仍可在报名时间内重新报名。')) return
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/register/cancel`, { method: 'POST', credentials: 'same-origin' })
      const data = await response.json().catch(() => null) as { message?: string; registrationCount?: number } | null
      if (!response.ok) { setMessage(data?.message || '取消报名失败，请稍后重试'); return }
      setRegistration((current) => current ? { ...current, status: 'CANCELLED', cancelledAt: new Date().toISOString() } : null)
      setAnswers(emptyAnswers(questions))
      if (typeof data?.registrationCount === 'number') setRegistrationCount(data.registrationCount)
      setCanRegister(true)
      setMessage('已取消报名')
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
        {isRegistered && registration?.verifiedAt ? <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-[var(--success)]">已核销</span> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!isAuthenticated ? (
          registrationState === 'AVAILABLE' ? <Link href={loginHref} className={buttonClass}>登录后报名</Link> : <button type="button" disabled className={buttonClass}>{stateLabel(registrationState)}</button>
        ) : (
          <button type="button" onClick={openDialog} disabled={submitting || isRegistered || !canRegister} className={buttonClass}>{submitting ? '处理中…' : currentLabel}</button>
        )}
        {isRegistered && !registration.verifiedAt ? <button type="button" onClick={() => void cancelRegistration()} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-black text-[var(--foreground-muted)] disabled:opacity-50">取消报名</button> : null}
        {message ? <span role="status" className="text-sm font-bold text-[var(--foreground-muted)]">{message}</span> : null}
      </div>
      {isRegistered && answerSummary.length ? <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">{answerSummary.map(({ question, value }) => <div key={question.id} className="text-sm"><span className="font-black text-[var(--foreground-muted)]">{question.title}</span><p className="mt-1 whitespace-pre-wrap break-words font-bold text-[var(--foreground)]">{Array.isArray(value) ? value.join('、') : value}</p></div>)}</div> : null}
      {isRegistered && activity.verificationMode === 'QR' && registration?.verificationToken ? <div className="mt-4 border-t border-[var(--border)] pt-4"><ActivityRegistrationQr activityId={activity.id} token={registration.verificationToken} verifiedAt={registration.verifiedAt} /></div> : null}
      {dialogOpen ? <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby={`activity-registration-dialog-${activity.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false) }}><div className="max-h-[min(90dvh,48rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 text-[var(--foreground)] shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-3"><div><h2 id={`activity-registration-dialog-${activity.id}`} className="text-xl font-black">确认报名</h2><p className="mt-1 text-sm font-bold text-[var(--foreground-muted)]">{activity.title}</p></div><button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} className="text-2xl leading-none text-[var(--foreground-muted)]" aria-label="关闭">×</button></div>{hasQuestions ? <div className="mt-5 space-y-4">{questions.map((question) => <label key={question.id} className="block text-sm font-black">{question.title}{question.required ? <span className="ml-1 text-rose-600">*</span> : null}{question.type === 'TEXTAREA' ? <textarea value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.placeholder || ''} className="mt-1 min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--foreground)]" /> : question.type === 'SINGLE_SELECT' || question.type === 'SELECT' ? <select value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)]"><option value="">请选择</option>{question.options.map((option) => <option key={option.id} value={option.value}>{option.label}</option>)}</select> : question.type === 'MULTI_SELECT' ? <span className="mt-2 grid gap-2 sm:grid-cols-2">{question.options.map((option) => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []; return <label key={option.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold"><input type="checkbox" checked={current.includes(option.value)} onChange={(event) => setAnswers((all) => ({ ...all, [question.id]: event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value) }))} />{option.label}</label> })}</span> : <input type={question.type === 'NUMBER' ? 'number' : question.type === 'PHONE' ? 'tel' : 'text'} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.placeholder || ''} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)]" />}</label>)}</div> : <p className="mt-5 rounded-xl bg-[var(--surface-subtle)] px-4 py-3 text-sm font-bold text-[var(--foreground-muted)]">当前没有额外问题，确认后即可完成站内报名。</p>}<div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setDialogOpen(false)} disabled={submitting} className="min-h-11 rounded-full border border-[var(--border)] px-5 py-2 text-sm font-black text-[var(--foreground-muted)]">取消</button><button type="button" onClick={() => void submitRegistration()} disabled={submitting} className={buttonClass}>{submitting ? '提交中…' : '确认报名'}</button></div></div></div> : null}
    </section>
  )
}
