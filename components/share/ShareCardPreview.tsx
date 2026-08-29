'use client'

import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import type { GeneratedShareCardImage } from '@/lib/share-card-image'
import type { ShareCardData } from '@/lib/share-card'

export function ShareCardPreview({ data, status, image, error, onClose, onRetry }: Readonly<{
  data: ShareCardData
  status: 'generating' | 'ready' | 'error'
  image: GeneratedShareCardImage | null
  error: string
  onClose: () => void
  onRetry: () => void
}>) {
  useEffect(() => {
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
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="share-card-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section className="share-card-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="share-card-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="share-card-preview-header">
          <div>
            <p className="share-card-preview-eyebrow">高清 PNG · 1080 × 1440</p>
            <h2 id="share-card-preview-title">分享卡片预览</h2>
          </div>
          <button type="button" className="share-card-preview-close" onClick={onClose} aria-label="关闭分享卡片预览">×</button>
        </header>
        {status === 'generating' ? (
          <div className="share-card-preview-loading" role="status" aria-live="polite">
            <span className="share-card-preview-spinner" aria-hidden="true" />
            <strong>正在生成分享卡片…</strong>
            <p>正在整理图片、内容和二维码，请稍候。</p>
          </div>
        ) : status === 'error' ? (
          <div className="share-card-preview-error" role="alert">
            <strong>分享卡片生成失败</strong>
            <p>{error || '请稍后重试。'}</p>
            <button type="button" onClick={onRetry} className="share-card-preview-primary">重新生成</button>
          </div>
        ) : image ? (
          <>
            <p className="share-card-preview-hint">手机可长按图片保存；电脑可点击“保存图片”下载 PNG。</p>
            <div className="share-card-preview-image-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.previewSrc} alt={`${data.title}分享卡片`} className="share-card-preview-image" data-share-card-image data-share-card-qr-url={image.qrUrl} />
            </div>
            <div className="share-card-preview-actions">
              <a href={image.previewSrc} download={image.fileName} className="share-card-preview-primary" data-share-card-save>保存图片</a>
              <button type="button" onClick={onClose} className="share-card-preview-secondary">完成</button>
            </div>
          </>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
