'use client'

import { useEffect, useRef } from 'react'

export function SingleCommentConfirmDialog({
  open,
  loading = false,
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean
  loading?: boolean
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

  return (
    <div className="fixed inset-0 z-[91] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => { if (!loading) onCancel() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="确认发送参与评论" className="w-full max-w-sm rounded-sm border border-sky-100 bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-lg font-black text-brand-950">确认发送参与评论？</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-500">本活动每位用户仅有一次参与评论机会。
发布后即视为已使用本次机会，即使删除该评论也不会恢复。

请确认文字和截图无误后再发送。</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={loading} className="min-h-10 rounded-sm border border-sky-100 bg-white px-4 text-sm font-black text-slate-600 hover:bg-sky-50 disabled:opacity-50">返回检查</button>
          <button type="button" onClick={onConfirm} disabled={loading} className="min-h-10 rounded-sm bg-brand-700 px-4 text-sm font-black text-white hover:bg-brand-800 disabled:opacity-50">{loading ? '处理中…' : '确认发送'}</button>
        </div>
      </div>
    </div>
  )
}
