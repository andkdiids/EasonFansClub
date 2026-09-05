'use client'

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { prepareContentImageFile, ContentImageClientError, type ContentImageProcessingPhase } from '@/lib/content-image-browser'
import {
  CONTENT_IMAGE_ACCEPT,
  CONTENT_IMAGE_ERROR_MESSAGES,
  type ContentImageUploadErrorCode,
} from '@/lib/content-image-upload'
import { MAX_CONTENT_IMAGES, reorderContentImageUrls } from '@/lib/content-images'
import { publicImageVariantUrl } from '@/lib/image-variants'

type PointerDragState = {
  pointerId: number
  url: string
  currentIndex: number
}

type PendingUploadPhase = ContentImageProcessingPhase | 'uploading' | 'failed'

type PendingUpload = {
  id: string
  file: File
  previewUrl: string
  phase: PendingUploadPhase
  error?: string
  previewFailed?: boolean
}

const KNOWN_ERROR_CODES = new Set<ContentImageUploadErrorCode>([
  'FILE_REQUIRED',
  'EMPTY_FILE',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FORMAT',
  'INVALID_FILE',
  'HEIC_CONVERSION_FAILED',
  'IMAGE_PROCESSING_FAILED',
  'NETWORK_UPLOAD_FAILED',
  'UPLOAD_FAILED',
  'UPLOAD_RESPONSE_INVALID',
])

function createUploadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `content-image-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isKnownErrorCode(value: unknown): value is ContentImageUploadErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value as ContentImageUploadErrorCode)
}

function isBusyPhase(phase: PendingUploadPhase) {
  return phase !== 'failed'
}

function busyLabel(items: readonly PendingUpload[]) {
  if (items.some((item) => item.phase === 'uploading')) return '上传中…'
  if (items.some((item) => item.phase === 'compressing')) return '正在压缩…'
  return '处理中…'
}

function errorFromResponse(data: unknown, response: Response) {
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const code = isKnownErrorCode(payload.code)
    ? payload.code
    : response.status === 413
      ? 'FILE_TOO_LARGE'
      : 'UPLOAD_FAILED'
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : CONTENT_IMAGE_ERROR_MESSAGES[code]
  return new ContentImageClientError(code, message)
}

function failureMessage(reason: unknown) {
  if (reason instanceof ContentImageClientError) return reason.message
  if (reason instanceof Error && reason.message.trim()) return reason.message
  return CONTENT_IMAGE_ERROR_MESSAGES.UPLOAD_FAILED
}

export function ContentImageUploader({
  value,
  onChange,
  existingCount = 0,
  onBusyChange,
}: Readonly<{
  value: string[]
  onChange: (urls: string[]) => void
  existingCount?: number
  onBusyChange?: (busy: boolean) => void
}>) {
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [error, setError] = useState('')
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onBusyChangeRef = useRef(onBusyChange)
  const pendingUploadsRef = useRef(pendingUploads)
  const draggingUrlRef = useRef<string | null>(null)
  const pointerDragRef = useRef<PointerDragState | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    onChangeRef.current = onChange
    onBusyChangeRef.current = onBusyChange
  }, [onBusyChange, onChange])

  useEffect(() => {
    pendingUploadsRef.current = pendingUploads
    onBusyChangeRef.current?.(pendingUploads.some((item) => isBusyPhase(item.phase)))
  }, [pendingUploads])

  useEffect(() => () => {
    pendingUploadsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
  }, [])

  function updatePendingUpload(id: string, update: Partial<PendingUpload>) {
    const next = pendingUploadsRef.current.map((item) => item.id === id ? { ...item, ...update } : item)
    pendingUploadsRef.current = next
    setPendingUploads(next)
  }

  function removePendingUpload(id: string) {
    const target = pendingUploadsRef.current.find((item) => item.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    const next = pendingUploadsRef.current.filter((item) => item.id !== id)
    pendingUploadsRef.current = next
    setPendingUploads(next)
  }

  function appendUploadedUrl(url: string) {
    const current = valueRef.current
    if (current.includes(url)) return
    const next = [...current, url]
    valueRef.current = next
    onChangeRef.current(next)
  }

  function removeUploadedUrl(url: string) {
    const next = valueRef.current.filter((item) => item !== url)
    valueRef.current = next
    onChangeRef.current(next)
  }

  async function uploadItem(item: PendingUpload) {
    updatePendingUpload(item.id, { phase: 'processing', error: undefined })
    try {
      const preparedFile = await prepareContentImageFile(item.file, (phase) => {
        updatePendingUpload(item.id, { phase })
      })
      if (!pendingUploadsRef.current.some((current) => current.id === item.id)) return

      updatePendingUpload(item.id, { phase: 'uploading' })
      const form = new FormData()
      // The route reads formData.get('file'); keep this field contract exact.
      const file = preparedFile
      form.set('file', file)
      let response: Response
      try {
        // Do not set Content-Type manually: the browser must add the multipart
        // boundary, which is especially important in mobile WebViews.
        response = await fetch('/api/uploads/content-image', {
          method: 'POST',
          body: form,
          cache: 'no-store',
        })
      } catch {
        throw new ContentImageClientError('NETWORK_UPLOAD_FAILED', CONTENT_IMAGE_ERROR_MESSAGES.NETWORK_UPLOAD_FAILED)
      }
      const data = await response.json().catch(() => null) as { url?: unknown; code?: unknown; message?: unknown } | null
      if (!response.ok) throw errorFromResponse(data, response)
      if (!data || typeof data.url !== 'string' || !data.url.trim()) {
        throw new ContentImageClientError('UPLOAD_RESPONSE_INVALID', CONTENT_IMAGE_ERROR_MESSAGES.UPLOAD_RESPONSE_INVALID)
      }
      if (!pendingUploadsRef.current.some((current) => current.id === item.id)) return

      appendUploadedUrl(data.url)
      removePendingUpload(item.id)
    } catch (reason) {
      if (!pendingUploadsRef.current.some((current) => current.id === item.id)) return
      updatePendingUpload(item.id, { phase: 'failed', error: failureMessage(reason) })
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    // Reset immediately so selecting the same photo again is still observable
    // after a failed upload on iOS Safari/Android WebView.
    event.target.value = ''
    if (!files.length) return

    const currentCount = existingCount + valueRef.current.length + pendingUploadsRef.current.length
    const remaining = MAX_CONTENT_IMAGES - currentCount
    if (remaining <= 0) {
      setError(`最多上传 ${MAX_CONTENT_IMAGES} 张图片`)
      return
    }

    const acceptedFiles = files.slice(0, remaining)
    const skippedCount = files.length - acceptedFiles.length
    const newItems = acceptedFiles.map((file): PendingUpload => ({
      id: createUploadId(),
      file,
      // Local preview is created before any compression/network work starts.
      previewUrl: URL.createObjectURL(file),
      phase: 'processing',
    }))
    const nextPending = [...pendingUploadsRef.current, ...newItems]
    pendingUploadsRef.current = nextPending
    setPendingUploads(nextPending)
    setError(skippedCount > 0
      ? `每篇帖子最多上传 ${MAX_CONTENT_IMAGES} 张图片，已忽略超出的 ${skippedCount} 张`
      : '')

    // Each item owns its own status/error. A failed image never aborts the
    // remaining files, so successful uploads stay visible.
    void (async () => {
      for (const item of newItems) await uploadItem(item)
    })()
  }

  function markPreviewFailed(id: string) {
    updatePendingUpload(id, { previewFailed: true })
  }

  function setDragging(url: string | null) {
    draggingUrlRef.current = url
    setDraggingUrl(url)
  }

  function moveDraggedImage(targetIndex: number) {
    const dragged = draggingUrlRef.current
    if (!dragged) return
    const current = valueRef.current
    const fromIndex = current.indexOf(dragged)
    if (fromIndex < 0) return
    const next = reorderContentImageUrls(current, fromIndex, targetIndex)
    if (next.every((url, index) => url === current[index])) return
    valueRef.current = next
    onChangeRef.current(next)
    const nextIndex = next.indexOf(dragged)
    if (pointerDragRef.current) pointerDragRef.current.currentIndex = nextIndex
  }

  function getTargetIndex(clientX: number, clientY: number) {
    const current = valueRef.current
    for (let index = 0; index < current.length; index += 1) {
      const element = itemRefs.current.get(current[index])
      if (!element) continue
      const rect = element.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue
      return index + (clientY > rect.top + rect.height / 2 ? 1 : 0)
    }
    return null
  }

  function beginPointerDrag(url: string, event: ReactPointerEvent<HTMLDivElement>) {
    // Desktop mouse dragging uses the native HTML5 path below. Pointer capture
    // is reserved for touch/pen so the two drag implementations do not compete.
    if (event.pointerType === 'mouse') return
    const index = valueRef.current.indexOf(url)
    if (index < 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDragRef.current = { pointerId: event.pointerId, url, currentIndex: index }
    setDragging(url)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const targetIndex = getTargetIndex(event.clientX, event.clientY)
    if (targetIndex === null || targetIndex === drag.currentIndex || targetIndex === drag.currentIndex + 1) return
    event.preventDefault()
    moveDraggedImage(targetIndex)
  }

  function finishPointerDrag(event?: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag || (event && drag.pointerId !== event.pointerId)) return
    const element = itemRefs.current.get(drag.url)
    if (element?.hasPointerCapture(drag.pointerId)) element.releasePointerCapture(drag.pointerId)
    pointerDragRef.current = null
    setDragging(null)
  }

  function handleHtmlDragStart(url: string, event: React.DragEvent<HTMLDivElement>) {
    draggingUrlRef.current = url
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', url)
    setDragging(url)
  }

  function handleHtmlDragOver(url: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const element = itemRefs.current.get(url)
    if (!element) return
    const rect = element.getBoundingClientRect()
    moveDraggedImage(valueRef.current.indexOf(url) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0))
  }

  function finishHtmlDrag() {
    setDragging(null)
  }

  const busy = pendingUploads.some((item) => isBusyPhase(item.phase))

  return (
    <div className="post-content-image-uploader w-full min-w-0 max-w-full space-y-2">
      <label className="post-content-image-uploader-trigger flex w-full min-w-0 max-w-full cursor-pointer box-border items-center rounded-lg border border-sky-100 bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
        {busy ? busyLabel(pendingUploads) : `添加图片（${existingCount + value.length + pendingUploads.length}/${MAX_CONTENT_IMAGES}）`}
        <input
          type="file"
          accept={CONTENT_IMAGE_ACCEPT}
          multiple
          disabled={busy}
          onChange={selectFiles}
          className="sr-only"
        />
      </label>

      {pendingUploads.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
          {pendingUploads.map((item) => (
            <article key={item.id} className="overflow-hidden rounded-xl border border-sky-100 bg-white">
              <div className="relative">
                {item.previewFailed ? (
                  <div className="flex h-24 items-center justify-center bg-slate-100 px-2 text-center text-xs font-bold text-slate-500">
                    {item.file.name || '图片'}
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt={item.file.name || '待上传图片'}
                    className="pointer-events-none h-24 w-full bg-slate-50 object-cover"
                    onError={() => markPreviewFailed(item.id)}
                  />
                )}
                {isBusyPhase(item.phase) ? <span className="absolute inset-x-1 bottom-1 rounded bg-slate-950/70 px-1 py-0.5 text-center text-[11px] font-black text-white">{item.phase === 'compressing' ? '正在压缩…' : item.phase === 'uploading' ? '上传中…' : '处理中…'}</span> : null}
              </div>
              <div className="space-y-1 p-2 text-xs font-bold">
                <p className={item.phase === 'failed' ? 'text-red-600' : 'text-sky-700'} role="status">
                  {item.phase === 'failed' ? '上传失败' : item.phase === 'compressing' ? '正在压缩…' : item.phase === 'uploading' ? '上传中…' : '处理中…'}
                </p>
                {item.phase === 'failed' && item.error ? <p className="break-words text-red-600">{item.error}</p> : null}
                <div className="flex gap-2">
                  {item.phase === 'failed' ? <button type="button" onClick={() => void uploadItem(item)} className="text-brand-700">重试</button> : null}
                  <button type="button" onClick={() => removePendingUpload(item.id)} className="text-red-600">删除</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {value.length ? (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
        >
          {value.map((url) => (
            <div
              key={url}
              ref={(element) => {
                if (element) itemRefs.current.set(url, element)
                else itemRefs.current.delete(url)
              }}
              draggable
              aria-grabbed={draggingUrl === url}
              onPointerDown={(event) => beginPointerDrag(url, event)}
              onDragStart={(event) => handleHtmlDragStart(url, event)}
              onDragOver={(event) => handleHtmlDragOver(url, event)}
              onDrop={(event) => {
                event.preventDefault()
                finishHtmlDrag()
              }}
              onDragEnd={finishHtmlDrag}
              className={`relative cursor-grab select-none ${draggingUrl === url ? 'z-10 opacity-60' : ''}`}
              style={{ touchAction: 'none' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicImageVariantUrl(url, 'thumb-md') || url} alt="已上传内容，拖拽可调整顺序" className="pointer-events-none h-24 w-full rounded-xl object-cover" loading="lazy" />
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => removeUploadedUrl(url)}
                className="absolute right-1 top-1 rounded-full bg-slate-950/80 px-2 py-1 text-xs text-white"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-sm font-bold text-red-600" role="alert">{error}</p> : null}
      {busy ? <p className="text-xs font-bold text-slate-500" role="status">图片处理完成后才能发布帖子。</p> : null}
    </div>
  )
}
