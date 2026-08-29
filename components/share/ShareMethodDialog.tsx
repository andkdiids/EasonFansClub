'use client'

import { createPortal } from 'react-dom'
import { useEffect } from 'react'

export function ShareMethodDialog({ open, canSaveCard = true, onClose, onSaveCard, onShareLink }: Readonly<{
  open: boolean
  canSaveCard?: boolean
  onClose: () => void
  onSaveCard: () => void
  onShareLink: () => void
}>) {
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="share-method-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section className="share-method-dialog" role="dialog" aria-modal="true" aria-labelledby="share-method-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="share-method-header">
          <h2 id="share-method-title">分享</h2>
          <button type="button" className="share-method-close" onClick={onClose} aria-label="关闭分享方式">×</button>
        </header>
        <div className="share-method-options">
          <button type="button" className="share-method-option" data-share-method="card" onClick={onSaveCard} disabled={!canSaveCard}>
            <span className="share-method-option-icon" aria-hidden="true">▧</span>
            <span className="share-method-option-copy"><strong>保存分享卡片</strong><small>{canSaveCard ? '生成高清海报图片' : '此内容不能生成公开卡片'}</small></span>
          </button>
          <button type="button" className="share-method-option" data-share-method="link" onClick={onShareLink}>
            <span className="share-method-option-icon" aria-hidden="true">↗</span>
            <span className="share-method-option-copy"><strong>分享链接</strong><small>使用系统分享或复制标题和链接</small></span>
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
