'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { shareContent } from '@/lib/share'
import { generateShareCardImage, type GeneratedShareCardImage } from '@/lib/share-card-image'
import type { ShareCardData } from '@/lib/share-card'
import { ShareCardPreview } from './ShareCardPreview'
import { ShareMethodDialog } from './ShareMethodDialog'

export function ShareButton({ data, linkTitle, linkText, label = '分享', triggerClassName = '', messageClassName = '', ariaLabel, canSaveCard = data.canGenerateCard !== false }: Readonly<{
  data: ShareCardData
  linkTitle?: string
  linkText?: string | null
  label?: string
  triggerClassName?: string
  messageClassName?: string
  ariaLabel?: string
  canSaveCard?: boolean
}>) {
  const [methodOpen, setMethodOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [cardStatus, setCardStatus] = useState<'generating' | 'ready' | 'error'>('generating')
  const [cardImage, setCardImage] = useState<GeneratedShareCardImage | null>(null)
  const [cardError, setCardError] = useState('')
  const [message, setMessage] = useState('')
  const generationId = useRef(0)
  const messageTimer = useRef<number | null>(null)
  const cardImageRef = useRef<GeneratedShareCardImage | null>(null)

  const clearMessageTimer = useCallback(() => {
    if (messageTimer.current !== null) window.clearTimeout(messageTimer.current)
    messageTimer.current = null
  }, [])

  const announce = useCallback((value: string) => {
    clearMessageTimer()
    setMessage(value)
    messageTimer.current = window.setTimeout(() => setMessage(''), 2400)
  }, [clearMessageTimer])

  useEffect(() => () => {
    generationId.current += 1
    clearMessageTimer()
    if (cardImageRef.current?.previewSrcIsObjectUrl) URL.revokeObjectURL(cardImageRef.current.previewSrc)
  }, [clearMessageTimer])

  function closePreview() {
    generationId.current += 1
    setPreviewOpen(false)
    setCardStatus('generating')
    setCardError('')
    setCardImage((current) => {
      if (current?.previewSrcIsObjectUrl) URL.revokeObjectURL(current.previewSrc)
      cardImageRef.current = null
      return null
    })
  }

  async function generateCard() {
    const currentGeneration = ++generationId.current
    setMethodOpen(false)
    setPreviewOpen(true)
    setCardStatus('generating')
    setCardError('')
    setCardImage((current) => {
      if (current?.previewSrcIsObjectUrl) URL.revokeObjectURL(current.previewSrc)
      cardImageRef.current = null
      return null
    })
    await new Promise<void>((resolve) => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
      else window.setTimeout(resolve, 0)
    })
    try {
      const image = await generateShareCardImage(data)
      if (currentGeneration !== generationId.current) {
        if (image.previewSrcIsObjectUrl) URL.revokeObjectURL(image.previewSrc)
        return
      }
      cardImageRef.current = image
      setCardImage(image)
      setCardStatus('ready')
    } catch (error) {
      if (currentGeneration !== generationId.current) return
      setCardError(error instanceof Error ? error.message : '请稍后重试。')
      setCardStatus('error')
    }
  }

  async function shareLink() {
    setMethodOpen(false)
    try {
      // Keep the existing link share contract: current page URL goes to the
      // existing helper; the card keeps its clean canonical URL separately.
      const result = await shareContent({
        title: (linkTitle || data.title).trim(),
        text: linkText ?? data.description,
        url: window.location.href,
      })
      announce(result === 'shared' ? '已打开分享面板' : '标题和链接已复制')
    } catch {
      announce('分享已取消')
    }
  }

  return (
    <span className="share-button-root">
      <button
        type="button"
        onClick={() => setMethodOpen(true)}
        className={triggerClassName}
        aria-label={ariaLabel || label}
        aria-haspopup="dialog"
        aria-expanded={methodOpen || previewOpen}
      >
        {label}
      </button>
      {message ? <span className={messageClassName || 'share-button-message'} role="status">{message}</span> : null}
      <ShareMethodDialog open={methodOpen} canSaveCard={canSaveCard} onClose={() => setMethodOpen(false)} onSaveCard={() => { void generateCard() }} onShareLink={() => { void shareLink() }} />
      {previewOpen ? <ShareCardPreview data={data} status={cardStatus} image={cardImage} error={cardError} onClose={closePreview} onRetry={() => { void generateCard() }} /> : null}
    </span>
  )
}
