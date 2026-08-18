'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { BirthdayCardImageData } from '@/lib/birthday-card-image'
import { generateBirthdayCardImage } from '@/lib/birthday-card-image'

export function SaveBirthdayCardButton({ data }: { data: BirthdayCardImageData }) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<{ previewSrc: string; previewSrcIsObjectUrl: boolean } | null>(null)

  useEffect(() => {
    if (!preview) return undefined

    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousBodyOverflow
      if (preview.previewSrcIsObjectUrl) URL.revokeObjectURL(preview.previewSrc)
    }
  }, [preview])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setMessage('正在生成图片…')
    try {
      // 让 loading 态先绘制，再开始同步的画布工作。
      await new Promise<void>((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
        else window.setTimeout(resolve, 0)
      })
      const image = await generateBirthdayCardImage(data)
      setPreview(image)
      // 不调用微信分享 API，仅给出保存/分享到朋友圈的引导文案。
      setMessage('生日祝福卡片已保存，可以分享到朋友圈啦 ❤️')
    } catch (error) {
      console.error('[birthday-card-save]', error)
      setMessage('生成失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  function closePreview() {
    setPreview(null)
  }

  const previewPortal = preview && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="prescription-preview-backdrop"
        role="presentation"
        onClick={(event) => { if (event.target === event.currentTarget) closePreview() }}
      >
        <section className="prescription-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="birthday-card-preview-title">
          <header className="prescription-preview-header">
            <div>
              <h2 id="birthday-card-preview-title">生日祝福卡片</h2>
            </div>
            <button type="button" className="prescription-preview-close" onClick={closePreview} aria-label="关闭预览">×</button>
          </header>
          <p className="prescription-preview-hint prescription-preview-hint-desktop">右键点击图片，可复制或保存图片</p>
          <p className="prescription-preview-hint prescription-preview-hint-mobile">长按图片可保存或转发到朋友圈</p>
          <div className="prescription-preview-image-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.previewSrc} alt="生日祝福卡片" className="prescription-preview-image" />
          </div>
        </section>
      </div>,
      document.body,
    )
    : null

  return (
    <>
      <span className="birthday-card-save-action">
        <button
          type="button"
          className="birthday-card-save-button"
          onClick={() => void handleSave()}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? '正在生成图片…' : '保存生日卡片'}
        </button>
        {message ? <span className="birthday-card-save-message" role="status">{message}</span> : null}
      </span>
      {previewPortal}
    </>
  )
}
