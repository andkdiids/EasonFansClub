'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { ActivityRedemptionLookupView } from '@/lib/activity-redemption'

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function selectionKey(item: Pick<ActivityRedemptionLookupView['entitlements'][number], 'type' | 'id'>) {
  return `${item.type}:${item.id}`
}

function defaultSelections(lookup: ActivityRedemptionLookupView) {
  return lookup.entitlements.filter((item) => item.defaultSelected).map(selectionKey)
}

export function ActivityRegistrationCheckinPage({ token, initialLookup, onContinueScan }: Readonly<{ token: string; initialLookup: ActivityRedemptionLookupView; onContinueScan?: () => void }>) {
  const router = useRouter()
  const [lookup, setLookup] = useState(initialLookup)
  const [selected, setSelected] = useState(() => defaultSelections(initialLookup))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)
  const registrationEntitlement = lookup.entitlements.find((item) => item.type === 'ACTIVITY_REGISTRATION')
  const selectedItems = lookup.entitlements.filter((item) => item.selectable && selected.includes(selectionKey(item)))
  const hasSelectableItems = lookup.entitlements.some((item) => item.selectable)
  const isCheckedIn = Boolean(lookup.registration.verifiedAt)

  function toggleSelection(item: ActivityRedemptionLookupView['entitlements'][number]) {
    if (!item.selectable || busy) return
    const key = selectionKey(item)
    setSelected((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key])
    setError('')
  }

  async function confirmRedemption() {
    if (!selectedItems.length || busy) return
    setBusy(true)
    setError('')
    setCompleted(false)
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(lookup.activity.id)}/redemption-confirm`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          entitlements: selectedItems.map((item) => ({ type: item.type, id: item.id })),
        }),
      })
      const data = await response.json().catch(() => null) as { message?: string; activity?: unknown; registration?: unknown; entitlements?: unknown } | null
      if (!response.ok) throw new Error(data?.message || '核销失败，请稍后重试')
      if (!data?.activity || !data.registration || !Array.isArray(data.entitlements)) throw new Error('核销结果格式不正确，请刷新后重试')
      const nextLookup = data as unknown as ActivityRedemptionLookupView
      setLookup(nextLookup)
      setSelected(defaultSelections(nextLookup))
      setConfirmOpen(false)
      setMessage(nextLookup.registration.verifiedAt ? '✓ 核销完成' : '核销完成')
      setCompleted(true)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : '核销失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  function continueScanning() {
    if (busy) return
    if (onContinueScan) {
      onContinueScan()
      return
    }
    router.push('/activities/checkin?scan=1')
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-5 sm:py-10">
      <section className="border border-[var(--border)] bg-[var(--surface-elevated)] p-5 text-[var(--foreground)] shadow-sm sm:p-7" aria-labelledby="activity-checkin-title">
        <p className="text-xs font-black tracking-[0.18em] text-[var(--primary)]">活动现场入口</p>
        <h1 id="activity-checkin-title" className="mt-2 text-2xl font-black sm:text-3xl">活动核销</h1>
        <p className="mt-2 text-sm font-bold leading-6 text-[var(--foreground-muted)]">二维码只用于核验报名，不会直接完成其他操作。</p>

        <dl className="mt-6 grid gap-3 border-y border-[var(--border)] py-4 text-sm sm:grid-cols-2">
          <div className="min-w-0"><dt className="font-bold text-[var(--foreground-muted)]">活动</dt><dd className="mt-1 break-words font-black">{lookup.activity.title}</dd></div>
          <div className="min-w-0"><dt className="font-bold text-[var(--foreground-muted)]">报名用户</dt><dd className="mt-1 break-words font-black">{lookup.user.nickname} · E院ID {lookup.user.uid}</dd></div>
          <div className="min-w-0"><dt className="font-bold text-[var(--foreground-muted)]">报名编号</dt><dd className="mt-1 break-all font-mono text-xs font-black">{lookup.registration.id}</dd></div>
          <div><dt className="font-bold text-[var(--foreground-muted)]">报名时间</dt><dd className="mt-1 font-black">{formatDate(lookup.registration.registeredAt)}</dd></div>
          <div><dt className="font-bold text-[var(--foreground-muted)]">报名状态</dt><dd className="mt-1 font-black">报名成功</dd></div>
          <div><dt className="font-bold text-[var(--foreground-muted)]">核销状态</dt><dd className={`mt-1 font-black ${isCheckedIn ? 'text-emerald-700 dark:text-emerald-300' : 'text-sky-700 dark:text-sky-300'}`}>{isCheckedIn ? '已核销' : '未核销'}</dd></div>
        </dl>

        {isCheckedIn ? <div className="mt-5 border border-emerald-300 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"><p className="text-lg font-black">✓ 已核销</p><p className="mt-2">核销时间：{formatDate(lookup.registration.checkedInAt || lookup.registration.verifiedAt)}</p><p className="mt-1">核销工作人员：{lookup.registration.verifiedBy ? `${lookup.registration.verifiedBy.nickname} · E院ID ${lookup.registration.verifiedBy.uid}` : '系统自动核销'}</p></div> : <div className="mt-5 border border-sky-300 bg-sky-50 p-4 text-sm font-bold text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200"><p className="font-black">待现场核销</p><p className="mt-1">请确认报名用户与活动信息无误后，再进行核销。</p></div>}

        <section className="mt-5" aria-labelledby="activity-checkin-items-title">
          <h2 id="activity-checkin-items-title" className="text-sm font-black">本次可处理项目</h2>
          <div className="mt-2 space-y-2">
            {lookup.entitlements.map((item) => {
              const key = selectionKey(item)
              return <label key={key} className={`flex items-start gap-3 border p-3 text-sm ${item.selectable ? 'border-[var(--border)]' : 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground-muted)]'}`}>
                <input type="checkbox" checked={selected.includes(key)} disabled={!item.selectable || busy} onChange={() => toggleSelection(item)} className="mt-1 size-4" />
                <span className="min-w-0"><span className="block font-black">{item.title} ×{item.quantity}</span><span className="mt-1 block text-xs font-bold">{item.subtitle || (item.selectable ? '待核销' : item.blockedReason || (item.status === 'REDEEMED' ? '已核销' : '当前不可处理'))}</span></span>
              </label>
            })}
          </div>
        </section>

        {lookup.risk && lookup.risk.level !== 'LOW' ? <p className="mt-4 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">⚠️ 该用户存在多账号报名风险，仅供人工核验，不自动阻止核销。</p> : null}
        {message ? <p role="status" className="mt-4 border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</p> : null}
        {!confirmOpen && error ? <p role="alert" className="mt-4 border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-black text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}

        {completed ? <div className="mt-5 grid gap-2 sm:grid-cols-2"><button type="button" onClick={continueScanning} className="min-h-12 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white">继续扫码</button><Link href="/activities" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-black text-[var(--primary)]">返回活动中心</Link></div> : null}

        <button type="button" onClick={() => { setError(''); setConfirmOpen(true) }} disabled={!hasSelectableItems || !selectedItems.length || busy} className="mt-6 min-h-12 w-full bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? '核销中…' : registrationEntitlement?.selectable ? '确认核销' : hasSelectableItems ? '确认核销所选项目' : '已完成核销'}</button>
        <Link href="/activities" className="mt-3 block text-center text-sm font-black text-[var(--primary)]">返回活动中心</Link>
      </section>
      <ConfirmDialog
        open={confirmOpen}
        title="确认核销该用户？"
        description={`活动：${lookup.activity.title}\n用户：${lookup.user.nickname} · E院ID ${lookup.user.uid}`}
        confirmLabel="确认核销"
        cancelLabel="取消"
        loading={busy}
        error={error}
        onConfirm={() => void confirmRedemption()}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setError('') } }}
      />
    </main>
  )
}
