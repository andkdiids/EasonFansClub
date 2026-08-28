'use client'

import Link from 'next/link'
import { useState } from 'react'
import { activityRegistrationStateValues, getActivityRegistrationState, type ActivityRegistrationState } from '@/lib/activity-registration'
import type { ActivityView } from '@/lib/activity'

function isActivityRegistrationState(value: unknown): value is ActivityRegistrationState {
  return typeof value === 'string' && activityRegistrationStateValues.includes(value as ActivityRegistrationState)
}

export function ActivityRegistrationButton({ activity, isAuthenticated, initialIsRegistered, initialRegistrationCount, initialRegistrationState, initialCanRegister }: Readonly<{
  activity: ActivityView
  isAuthenticated: boolean
  initialIsRegistered: boolean
  initialRegistrationCount: number
  initialRegistrationState?: ActivityRegistrationState
  initialCanRegister?: boolean
}>) {
  const initialAvailability = getActivityRegistrationState(activity, initialRegistrationCount)
  const [isRegistered, setIsRegistered] = useState(initialIsRegistered)
  const [registrationCount, setRegistrationCount] = useState(initialRegistrationCount)
  const [registrationState, setRegistrationState] = useState<ActivityRegistrationState>(initialRegistrationState || initialAvailability.state)
  const [canRegister, setCanRegister] = useState(initialCanRegister ?? initialAvailability.canRegister)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const loginHref = `/login?redirect=${encodeURIComponent(`/activities/${activity.id}`)}`

  async function register() {
    if (submitting || isRegistered || !canRegister || !isAuthenticated) return
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch(`/api/activities/${encodeURIComponent(activity.id)}/register`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await response.json().catch(() => null) as {
        message?: string
        alreadyRegistered?: boolean
        isRegistered?: boolean
        registrationCount?: number
        registrationState?: unknown
        canRegister?: boolean
      } | null
      if (!response.ok) {
        if (isActivityRegistrationState(data?.registrationState)) {
          setRegistrationState(data.registrationState)
          setCanRegister(false)
        }
        setMessage(data?.message || '报名失败，请稍后重试')
        return
      }
      setIsRegistered(data?.isRegistered !== false)
      if (typeof data?.registrationCount === 'number') setRegistrationCount(data.registrationCount)
      if (isActivityRegistrationState(data?.registrationState)) setRegistrationState(data.registrationState)
      setCanRegister(data?.canRegister === true)
      setMessage(data?.alreadyRegistered ? '你已经报名过了' : '报名成功')
    } catch {
      setMessage('网络连接失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const label = isRegistered
    ? '已报名'
    : registrationState === 'NOT_STARTED'
      ? '报名未开始'
      : registrationState === 'CLOSED'
        ? '报名已结束'
        : registrationState === 'FULL'
          ? '报名已满'
          : registrationState === 'ENDED'
            ? '活动已结束'
            : registrationState === 'CANCELLED'
              ? '活动已取消'
              : !isAuthenticated
                ? '登录后报名'
                : submitting
                  ? '报名中…'
                  : '立即报名'

  const disabled = submitting || isRegistered || !canRegister || !isAuthenticated
  const className = 'inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-black text-[var(--primary-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55'

  return (
    <div className="mt-7 flex flex-wrap items-center gap-3">
      {isAuthenticated ? (
        <button type="button" onClick={() => void register()} disabled={disabled} className={className} aria-live="polite">{label}</button>
      ) : registrationState === 'AVAILABLE' ? (
        <Link href={loginHref} className={className}>{label}</Link>
      ) : (
        <button type="button" disabled className={className}>{label}</button>
      )}
      {message ? <span role="status" className="text-sm font-bold text-[var(--foreground-muted)]">{message}</span> : null}
      <span className="text-sm font-bold text-[var(--foreground-muted)]">{activity.signupLimit !== null && activity.signupLimit > 0 ? `报名名额：${registrationCount}/${activity.signupLimit}` : `已报名：${registrationCount} 人`}</span>
    </div>
  )
}
