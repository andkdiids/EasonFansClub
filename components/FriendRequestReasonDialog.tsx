'use client'

import { useEffect, useRef, useState } from 'react'
import {
  FRIEND_REQUEST_REASON_MAX_LENGTH,
  validateFriendRequestReason,
  type FriendRequestReasonErrorCode,
} from '@/lib/friend-request-validation'

export type FriendRequestSubmitResult =
  | { ok: true }
  | { ok: false; message?: string; code?: FriendRequestReasonErrorCode | string }

const FRIEND_REQUEST_REASON_HISTORY_KEY = '__easonFriendRequestReasonDialog'
const FRIEND_REQUEST_REASON_OPEN_KEY = '__easonFriendRequestReasonDialogOpen'

export function FriendRequestReasonDialog({
  open,
  targetName,
  onClose,
  onSubmit,
}: Readonly<{
  open: boolean
  targetName: string
  onClose: () => void
  onSubmit: (reason: string) => Promise<FriendRequestSubmitResult>
}>) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const submittingRef = useRef(false)
  const previousHistoryStateRef = useRef<unknown>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setReason('')
    setError('')
    submittingRef.current = false
    setSubmitting(false)
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus())
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previousState = window.history.state
    previousHistoryStateRef.current = previousState
    window.history.pushState({
      ...(previousState && typeof previousState === 'object' ? previousState : {}),
      [FRIEND_REQUEST_REASON_HISTORY_KEY]: true,
    }, '')
    const windowState = window as Window & { [FRIEND_REQUEST_REASON_OPEN_KEY]?: boolean }
    windowState[FRIEND_REQUEST_REASON_OPEN_KEY] = true

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) onCloseRef.current()
    }
    const handlePopState = () => {
      if (!submittingRef.current) onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('popstate', handlePopState)
      document.body.style.overflow = previousOverflow
      windowState[FRIEND_REQUEST_REASON_OPEN_KEY] = false
      if (window.history.state?.[FRIEND_REQUEST_REASON_HISTORY_KEY]) {
        window.history.replaceState(previousHistoryStateRef.current, '')
      }
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  if (!open) return null

  async function submit() {
    if (submitting) return
    const validation = validateFriendRequestReason(reason)
    if (!validation.ok) {
      setError(validation.message)
      return
    }

    setError('')
    submittingRef.current = true
    setSubmitting(true)
    try {
      const result = await onSubmit(validation.reason)
      if (!result.ok) setError(result.message || '发送失败，请稍后重试')
      else onClose()
    } catch {
      setError('发送失败，请稍后重试')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="friend-request-reason-title"
        className="w-full max-w-md rounded-t-2xl border border-sky-100 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-brand-700">好友申请</p>
            <h2 id="friend-request-reason-title" className="mt-1 text-lg font-black text-brand-950">发送好友申请</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">向 {targetName} 说明你想认识对方的理由</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="关闭好友申请理由弹窗"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-transparent text-xl font-bold leading-none text-slate-500 hover:border-sky-100 hover:bg-sky-50 disabled:opacity-50"
          >
            ×
          </button>
        </div>
        <label className="mt-5 block text-sm font-black text-brand-950">
          申请理由 <span className="text-red-600">*</span>
          <textarea
            value={reason}
            maxLength={FRIEND_REQUEST_REASON_MAX_LENGTH}
            rows={4}
            autoFocus
            onChange={(event) => {
              setReason(event.target.value)
              if (error) setError('')
            }}
            placeholder="输入至少 2 个字的申请理由"
            aria-invalid={Boolean(error)}
            className="mt-2 block min-h-24 w-full resize-y rounded-lg border border-sky-100 bg-slate-50 px-3 py-2.5 text-sm font-bold leading-6 text-slate-700 outline-none placeholder:text-slate-400 focus:border-brand-400 focus:bg-white"
          />
        </label>
        <div className="mt-1 flex items-start justify-between gap-3 text-xs font-bold text-slate-400">
          <span role="alert" className={error ? 'text-red-600' : 'invisible'}>{error || '占位提示'}</span>
          <span className="shrink-0">{reason.length} / {FRIEND_REQUEST_REASON_MAX_LENGTH}</span>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-10 rounded-lg border border-sky-100 bg-white px-4 text-sm font-black text-slate-600 hover:bg-sky-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="min-h-10 rounded-lg bg-brand-950 px-4 text-sm font-black text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '发送中…' : '发送申请'}
          </button>
        </div>
      </section>
    </div>
  )
}
