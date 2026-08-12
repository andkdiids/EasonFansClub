'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MAX_CONTENT_IMAGES, reorderContentImageUrls } from '@/lib/content-images'
import { publicImageVariantUrl } from '@/lib/image-variants'

type PointerDragState = {
  pointerId: number
  url: string
  currentIndex: number
}

export function ContentImageUploader({ value, onChange }: Readonly<{ value: string[]; onChange: (urls: string[]) => void }>) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null)
  const valueRef = useRef(value)
  const draggingUrlRef = useRef<string | null>(null)
  const pointerDragRef = useRef<PointerDragState | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    valueRef.current = value
  }, [value])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    setError('')
    try {
      const next = [...value]
      const remaining = MAX_CONTENT_IMAGES - value.length
      if (remaining <= 0) {
        setError(`最多上传 ${MAX_CONTENT_IMAGES} 张图片`)
        return
      }
      for (const file of Array.from(files).slice(0, remaining)) {
        // 直接上传原图：格式校验与 WebP 转换统一在服务端用 sharp 完成，
        // 不依赖浏览器 MIME，也不在客户端做 createImageBitmap/canvas 转换（避免部分浏览器/图片误判）。
        const form = new FormData()
        form.set('file', file)
        const response = await fetch('/api/uploads/content-image', { method: 'POST', body: form })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || typeof data.url !== 'string') {
          throw new Error((data && data.message) || `图片「${file.name}」上传失败`)
        }
        next.push(data.url)
      }
      onChange(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片上传失败')
    } finally {
      setUploading(false)
    }
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
    onChange(next)
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

  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center rounded-lg border border-sky-100 bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
        {uploading ? '上传中…' : `添加图片（${value.length}/${MAX_CONTENT_IMAGES}）`}
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          multiple
          disabled={uploading || value.length >= MAX_CONTENT_IMAGES}
          onChange={(event) => void upload(event.target.files)}
          className="sr-only"
        />
      </label>
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
                onClick={() => onChange(value.filter((item) => item !== url))}
                className="absolute right-1 top-1 rounded-full bg-slate-950/80 px-2 py-1 text-xs text-white"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
