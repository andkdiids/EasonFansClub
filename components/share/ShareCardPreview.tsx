'use client'

import { createPortal } from 'react-dom'
import { useEffect, type MouseEvent } from 'react'
import type { GeneratedShareCardImage } from '@/lib/share-card-image'
import type { ShareCardData } from '@/lib/share-card'
import { useIsDesktopMediaQuery } from '@/lib/use-desktop-media-query'

async function downloadShareCard(event: MouseEvent<HTMLAnchorElement>, image: GeneratedShareCardImage) {
  if (image.source !== 'remote' || !image.previewSrc.startsWith('https://')) return
  event.preventDefault()
  try {
    const response = await fetch(image.previewSrc, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
    if (!response.ok) throw new Error('SHARE_CARD_DOWNLOAD_FAILED')
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = image.fileName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  } catch {
    // A CDN without CORS can still be opened from the user's explicit click;
    // the preview itself remains the original HTTPS image throughout.
    window.open(image.previewSrc, '_blank', 'noopener,noreferrer')
  }
}

export function ShareCardPreview({ data, status, image, error, onClose, onRetry }: Readonly<{
  data: ShareCardData
  status: 'generating' | 'ready' | 'error'
  image: GeneratedShareCardImage | null
  error: string
  onClose: () => void
  onRetry: () => void
}>) {
  const isDesktop = useIsDesktopMediaQuery()

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
          <h2 id="share-card-preview-title">分享卡片预览</h2>
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
            <p className="share-card-preview-hint">{isDesktop ? '点击保存图片下载 PNG' : '长按分享卡片，可保存图片或转发给好友'}</p>
            <div className="share-card-preview-image-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.previewSrc} width={image.width} height={image.height} alt={`${data.title}分享卡片`} className="share-card-preview-image" data-share-card-image data-share-card-source={image.source} data-share-card-qr-url={image.qrUrl} data-allow-native-image-drag="true" />
            </div>
            {isDesktop ? (
              <div className="share-card-preview-actions">
                <a href={image.previewSrc} download={image.fileName} onClick={(event) => { void downloadShareCard(event, image) }} className="share-card-preview-primary" data-share-card-save>保存图片</a>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
