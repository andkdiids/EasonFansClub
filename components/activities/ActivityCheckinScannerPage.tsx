'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ActivityRegistrationCheckinPage } from '@/components/activities/ActivityRegistrationCheckinPage'
import { ActivityRegistrationScanner } from '@/components/activities/ActivityRegistrationScanner'
import type { ActivityRedemptionLookupView } from '@/lib/activity-redemption'

type ActivityLookupResponse = ActivityRedemptionLookupView & { token: string }

type ApiErrorPayload = { code?: unknown; message?: unknown }

class ActivityLookupError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ActivityLookupError'
  }
}

function lookupErrorMessage(code: string, fallback = '查询失败，请检查核销码后重试') {
  if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') return '无核销权限'
  if (code === 'INVALID_TOKEN') return '二维码无效或已失效'
  if (code === 'REGISTRATION_NOT_FOUND') return '未找到报名记录'
  if (code === 'REGISTRATION_CANCELLED') return '报名已取消'
  if (code === 'ACTIVITY_CANCELLED') return '活动已取消'
  return fallback
}

function isLookupResponse(value: unknown): value is ActivityLookupResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<ActivityLookupResponse>
  return Boolean(response.activity && response.registration && response.user && typeof response.token === 'string' && Array.isArray(response.entitlements))
}

export function ActivityCheckinScannerPage({ autoStart = false }: Readonly<{ autoStart?: boolean }>) {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [lookup, setLookup] = useState<ActivityRedemptionLookupView | null>(null)
  const [token, setToken] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [error, setError] = useState('')
  const lookupBusyRef = useRef(false)
  const scanLockRef = useRef(false)
  const manualInputRef = useRef<HTMLInputElement | null>(null)

  const lookupToken = useCallback(async (rawInput: string) => {
    const input = rawInput.trim()
    if (!input || lookupBusyRef.current) return
    lookupBusyRef.current = true
    setLookupBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/activities/checkin', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: input }),
      })
      const data = await response.json().catch(() => null) as (ApiErrorPayload & Partial<ActivityLookupResponse>) | null
      if (!response.ok) {
        const code = typeof data?.code === 'string' ? data.code : response.status === 403 ? 'FORBIDDEN' : ''
        throw new ActivityLookupError(code, lookupErrorMessage(code, typeof data?.message === 'string' ? data.message : undefined))
      }
      if (!isLookupResponse(data)) throw new ActivityLookupError('REDEMPTION_LOOKUP_FAILED', '查询结果格式不正确，请稍后重试')
      setToken(data.token)
      setManualInput('')
      setLookup(data)
    } catch (lookupError) {
      scanLockRef.current = false
      setError(lookupError instanceof ActivityLookupError ? lookupErrorMessage(lookupError.code, lookupError.message) : lookupError instanceof Error ? lookupError.message : '查询失败，请稍后重试')
    } finally {
      lookupBusyRef.current = false
      setLookupBusy(false)
    }
  }, [])

  const submitLookup = useCallback((value: string) => {
    if (!value.trim()) {
      setError('请输入完整二维码 URL 或核销码')
      return
    }
    if (scanLockRef.current || lookupBusyRef.current) return
    scanLockRef.current = true
    setScannerOpen(false)
    void lookupToken(value)
  }, [lookupToken])

  const handleScan = useCallback((value: string) => {
    submitLookup(value)
  }, [submitLookup])

  const closeScanner = useCallback(() => {
    setScannerOpen(false)
    if (!lookupBusyRef.current) scanLockRef.current = false
  }, [])

  const openManualInput = useCallback(() => {
    closeScanner()
    window.setTimeout(() => manualInputRef.current?.focus(), 0)
  }, [closeScanner])

  const continueScanning = useCallback(() => {
    scanLockRef.current = false
    setLookup(null)
    setToken('')
    setManualInput('')
    setError('')
    setScannerOpen(true)
  }, [])

  useEffect(() => {
    if (autoStart) setScannerOpen(true)
  }, [autoStart])

  if (lookup) return <ActivityRegistrationCheckinPage token={token} initialLookup={lookup} onContinueScan={continueScanning} />

  return <main className="site-page-main flat-page mx-auto w-full max-w-2xl px-4 py-6 text-[var(--foreground)] sm:px-5 sm:py-10">
    <section className="border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-sm sm:p-8">
      <Link href="/activities" className="inline-flex min-h-10 items-center text-sm font-black text-[var(--primary)]">‹ 返回活动中心</Link>
      <p className="mt-6 text-xs font-black tracking-[0.18em] text-[var(--primary)]">管理员现场工具</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">活动核销</h1>
      <p className="mt-3 text-sm font-bold leading-7 text-[var(--foreground-muted)]">扫描用户报名二维码进行核销。扫码只会查询报名信息，确认后才会执行核销。</p>

      <button type="button" onClick={() => { setError(''); setScannerOpen(true) }} disabled={lookupBusy} className="mt-7 flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-base font-black text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900">打开摄像头扫码</button>
      <p className="mt-3 text-center text-xs font-bold text-[var(--foreground-muted)]">手机端优先使用后置摄像头；不支持时会自动切换兼容扫码模式。</p>

      <div className="my-7 flex items-center gap-3 text-xs font-black text-[var(--foreground-muted)]"><span className="h-px flex-1 bg-[var(--border)]" /><span>或</span><span className="h-px flex-1 bg-[var(--border)]" /></div>
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submitLookup(manualInput) }}>
        <label className="block text-sm font-black">手动输入核销码
          <input ref={manualInputRef} value={manualInput} onChange={(event) => setManualInput(event.target.value)} disabled={lookupBusy} autoComplete="off" inputMode="url" placeholder="粘贴完整二维码 URL 或 token" className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)] outline-none focus:border-emerald-500" />
        </label>
        <button type="submit" disabled={lookupBusy || !manualInput.trim()} className="mt-3 min-h-12 w-full rounded-xl border border-emerald-700 px-5 py-3 text-sm font-black text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-300">{lookupBusy ? '查询中…' : '查询'}</button>
      </form>
      <p className="mt-3 text-xs font-bold leading-5 text-[var(--foreground-muted)]">支持完整二维码 URL 和二维码中的 token。查询结果不会显示手机号、邮箱等非核销所需资料。</p>
      {error ? <p role="alert" className="mt-5 border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-black text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}
    </section>
    <ActivityRegistrationScanner open={scannerOpen} onClose={closeScanner} onScan={handleScan} onManualInput={openManualInput} />
  </main>
}
