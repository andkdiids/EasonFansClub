'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { shareContent } from '@/lib/share'
import { createShareCardFilename, isTrustedShareCardHttpsUrl, shareCardApiPath, shareCardQrPayload, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import { generateShareCardImage, type GeneratedShareCardImage } from '@/lib/share-card-image'
import { ShareCardPreview } from './ShareCardPreview'
import { ShareMethodDialog } from './ShareMethodDialog'

type ShareCardApiResponse = Readonly<{
  url?: unknown
  width?: unknown
  height?: unknown
  mimeType?: unknown
}>

class ShareCardNotShareableError extends Error {}

async function requestServerShareCard(data: ShareCardData): Promise<GeneratedShareCardImage | null> {
  const endpoint = shareCardApiPath(data)
  if (!endpoint) return null
  const response = await fetch(endpoint, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
  if (response.status === 403 || response.status === 404) throw new ShareCardNotShareableError()
  if (!response.ok) throw new Error(`SHARE_CARD_API_${response.status}`)
  const result = await response.json() as ShareCardApiResponse
  if (typeof result.url !== 'string' || !isTrustedShareCardHttpsUrl(result.url)) throw new Error('SHARE_CARD_API_URL_INVALID')
  if (result.mimeType !== SHARE_CARD_MIME_TYPE || result.width !== SHARE_CARD_WIDTH || typeof result.height !== 'number' || !Number.isSafeInteger(result.height) || result.height <= 0) throw new Error('SHARE_CARD_API_DIMENSIONS_INVALID')
  return {
    source: 'remote',
    blob: null,
    previewSrc: result.url,
    fileName: createShareCardFilename(data.title),
    width: SHARE_CARD_WIDTH,
    height: result.height,
    qrUrl: shareCardQrPayload(data.url),
  }
}

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
  }, [clearMessageTimer])

  function closePreview() {
    generationId.current += 1
    setPreviewOpen(false)
    setCardStatus('generating')
    setCardError('')
    setCardImage(null)
  }

  async function generateCard() {
    const currentGeneration = ++generationId.current
    setMethodOpen(false)
    setPreviewOpen(true)
    setCardStatus('generating')
    setCardError('')
    setCardImage(null)
    await new Promise<void>((resolve) => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
      else window.setTimeout(resolve, 0)
    })
    try {
      let image: GeneratedShareCardImage | null = null
      try {
        image = await requestServerShareCard(data)
      } catch (error) {
        if (error instanceof ShareCardNotShareableError) {
          if (currentGeneration !== generationId.current) return
          setCardError('此内容暂不能生成公开分享卡片。')
          setCardStatus('error')
          return
        }
        // A temporary API/renderer/COS failure is intentionally handled by the
        // existing local renderer. The server remains the normal path.
      }
      if (!image) image = await generateShareCardImage(data)
      if (currentGeneration !== generationId.current) {
        return
      }
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
