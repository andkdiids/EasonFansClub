'use client'

import { useEffect, useRef } from 'react'

export type ReviewConfirmAction = 'APPROVED' | 'REJECTED'

export function ReviewConfirmDialog({
  open,
  action,
  alreadyCounted = false,
  rejectReason,
  onRejectReasonChange,
  loading = false,
  error = '',
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean
  action: ReviewConfirmAction
  alreadyCounted?: boolean
  rejectReason: string
  onRejectReasonChange: (value: string) => void
  loading?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}>) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const loadingRef = useRef(loading)

  useEffect(() => {
    onCancelRef.current = onCancel
    loadingRef.current = loading
  })

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) onCancelRef.current()
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'))
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  if (!open) return null

  const isApprove = action === 'APPROVED'
  const title = isApprove ? '确认通过这条参与内容？' : '确认拒绝这条参与内容？'
  const description = isApprove
    ? alreadyCounted
      ? '该用户已计入本次活动。本次通过不会重复累计参与次数或重复获得活动奖励。仍要通过这条参与内容吗？'
      : '通过后，该用户将计入本次活动参与；如活动设置为立即发奖，奖励将按规则发放。'
    : '确认拒绝后，这条参与内容不会计入本次活动。拒绝原因可选。'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => { if (!loading) onCancel() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-sm border border-sky-100 bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-lg font-black text-brand-950">{title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-500">{description}</p>
        {!isApprove ? (
          <label className="mt-4 block text-sm font-black text-slate-700">
            拒绝原因（可选）
            <textarea value={rejectReason} onChange={(event) => onRejectReasonChange(event.target.value)} rows={3} maxLength={1000} disabled={loading} className="mt-2 block w-full rounded-sm border border-sky-100 bg-white p-3 text-sm font-bold text-slate-700 outline-none focus:border-sky-400 disabled:opacity-60" />
          </label>
        ) : null}
        {error ? <p role="alert" className="mt-3 text-sm font-bold leading-6 text-red-600">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={loading} className="min-h-10 rounded-sm border border-sky-100 bg-white px-4 text-sm font-black text-slate-600 hover:bg-sky-50 disabled:opacity-50">取消</button>
          <button type="button" onClick={onConfirm} disabled={loading} className={`min-h-10 rounded-sm px-4 text-sm font-black text-white disabled:opacity-50 ${isApprove ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>{loading ? '处理中…' : isApprove ? '确认通过' : '确认拒绝'}</button>
        </div>
      </div>
    </div>
  )
}
