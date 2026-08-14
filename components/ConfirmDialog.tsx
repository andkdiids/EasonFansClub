'use client'

import { useEffect, useRef } from 'react'

/**
 * 项目统一的轻量二次确认弹窗（直角、扁平化风格）。
 * - 默认焦点在「取消」，确认按钮使用危险操作样式；
 * - 点击遮罩或按 Esc 关闭（请求中不关闭）；
 * - 关闭后焦点回到触发按钮；
 * - 移动端 360px 下不超出屏幕。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  loading = false,
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}>) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // 通过 ref 读最新的 onCancel / loading，使下面的事件 effect 只在 open 变化时重装，
  // 避免父组件重渲染（如请求中切换 loading）时反复把焦点拉回「取消」按钮。
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
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loadingRef.current) onCancelRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4"
      onClick={() => {
        if (!loading) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-sm border border-sky-100 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-black text-brand-950">{title}</h2>
        {description ? <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-500">{description}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="min-h-10 rounded-sm border border-sky-100 bg-white px-4 text-sm font-black text-slate-600 hover:bg-sky-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="min-h-10 rounded-sm bg-red-600 px-4 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
