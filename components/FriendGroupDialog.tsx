'use client'

import { useEffect, useRef, type ChangeEvent, type CompositionEvent, type FormEvent, type KeyboardEvent } from 'react'

export type FriendGroupDialogMode = 'create' | 'rename'

export function FriendGroupDialog({
  open,
  mode,
  name,
  error,
  busy,
  onNameChange,
  onSubmit,
  onCancel,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
}: Readonly<{
  open: boolean
  mode: FriendGroupDialogMode
  name: string
  error: string
  busy: boolean
  onNameChange: (event: ChangeEvent<HTMLInputElement>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onCompositionStart: (event: CompositionEvent<HTMLInputElement>) => void
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const busyRef = useRef(busy)
  const title = mode === 'create' ? '新建好友分组' : '重命名分组'
  const description = mode === 'create' ? '给好友分个组，之后会更容易找到他们。' : '修改这个好友分组的名称。'
  const submitLabel = mode === 'create' ? '创建分组' : '保存'
  const busyLabel = mode === 'create' ? '创建中…' : '保存中…'
  const inputId = mode === 'create' ? 'friend-group-create-name' : 'friend-group-rename-name'
  const errorId = `${inputId}-error`

  useEffect(() => {
    onCancelRef.current = onCancel
    busyRef.current = busy
  })

  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const body = document.body
    const rootOverflow = root.style.overflow
    const bodyOverflow = body.style.overflow
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      root.style.overflow = rootOverflow
      body.style.overflow = bodyOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      // Avoid opening the iOS keyboard immediately when the sheet appears.
      // The user can still tap the 16px input without Safari zooming the page.
      if (!window.matchMedia?.('(pointer: coarse)').matches) inputRef.current?.focus()
    })
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) onCancelRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const marker = `friend-group-dialog-${Date.now()}`
    const currentState = window.history.state
    const nextState = currentState && typeof currentState === 'object'
      ? { ...currentState, __friendGroupDialog: marker }
      : { __friendGroupDialog: marker }
    let active = true
    window.history.pushState(nextState, '')
    const handlePopState = () => {
      if (busyRef.current) {
        window.history.pushState(nextState, '')
        return
      }
      active = false
      onCancelRef.current()
    }
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (active && window.history.state?.__friendGroupDialog === marker) window.history.back()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="friend-group-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <section
        className="friend-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        aria-describedby={`${inputId}-description`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="friend-group-dialog-header">
          <div>
            <h2 id={`${inputId}-title`}>{title}</h2>
            <p id={`${inputId}-description`}>{description}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="关闭分组弹窗">×</button>
        </header>
        <form className="friend-group-dialog-form" onSubmit={onSubmit}>
          <label htmlFor={inputId}>分组名称</label>
          <input
            ref={inputRef}
            id={inputId}
            value={name}
            maxLength={30}
            autoComplete="off"
            placeholder="请输入分组名称"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : `${inputId}-hint`}
            onChange={onNameChange}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onKeyDown={onKeyDown}
          />
          <div className="friend-group-dialog-meta">
            <span id={error ? errorId : `${inputId}-hint`} className={error ? 'is-error' : undefined} role={error ? 'alert' : undefined}>
              {error || '最多 30 个字符'}
            </span>
            <span>{name.length} / 30</span>
          </div>
          <div className="friend-group-dialog-actions">
            <button type="button" onClick={onCancel} disabled={busy}>取消</button>
            <button type="submit" disabled={busy || !name.trim() || name.trim().length > 30}>
              {busy ? busyLabel : submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
