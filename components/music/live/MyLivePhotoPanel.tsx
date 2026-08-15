'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { MY_LIVE_PHOTO_LIMITS, type MyLivePhotoCategoryValue, type MyLivePhotoView } from '@/lib/my-live-photo-types'

const MAX_FILE_SIZE = 12 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])

type DragState = {
  pointerId: number
  startX: number
  startY: number
  horizontal: boolean
}

type MyLivePhotoPanelProps = {
  attendanceId?: string
  photos?: MyLivePhotoView[]
  manage?: boolean
  watermarkPreview?: string
  onPhotosChange?: (photos: MyLivePhotoView[]) => void
}

function categoryLabel(category: MyLivePhotoCategoryValue) {
  return category === 'TICKET' ? '票根' : '现场'
}

function categoryLimit(category: MyLivePhotoCategoryValue) {
  return MY_LIVE_PHOTO_LIMITS[category]
}

export function MyLivePhotoPanel({ attendanceId, photos = [], manage = false, watermarkPreview, onPhotosChange }: Readonly<MyLivePhotoPanelProps>) {
  const [category, setCategory] = useState<MyLivePhotoCategoryValue>(() => (
    photos.some((photo) => photo.category === 'LIVE') || !photos.some((photo) => photo.category === 'TICKET')
      ? 'LIVE'
      : 'TICKET'
  ))
  const [currentIndex, setCurrentIndex] = useState(0)
  const [manageOpen, setManageOpen] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [watermark, setWatermark] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const pointerRef = useRef<DragState | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const activeCategory = category
  const activePhotos = useMemo(() => photos.filter((photo) => photo.category === activeCategory), [activeCategory, photos])
  const activePhoto = activePhotos[currentIndex]
  const remaining = Math.max(0, Math.min(categoryLimit(activeCategory) - activePhotos.length, MY_LIVE_PHOTO_LIMITS.TOTAL - photos.length))

  useEffect(() => {
    if (activePhotos.length === 0) {
      setCurrentIndex(0)
      return
    }
    setCurrentIndex((index) => Math.min(index, activePhotos.length - 1))
  }, [activeCategory, activePhotos.length, photos])

  function selectCategory(nextCategory: MyLivePhotoCategoryValue) {
    setCategory(nextCategory)
    setCurrentIndex(0)
    setMessage('')
  }

  function goTo(nextIndex: number, event?: React.MouseEvent<HTMLButtonElement>) {
    event?.preventDefault()
    event?.stopPropagation()
    if (!activePhotos.length) return
    setCurrentIndex(Math.min(activePhotos.length - 1, Math.max(0, nextIndex)))
  }

  function beginSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePhotos.length < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return
    pointerRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, horizontal: false }
  }

  function moveSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.horizontal) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        pointerRef.current = null
        return
      }
      drag.horizontal = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
  }

  function finishSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    if (drag.horizontal && Math.abs(deltaX) >= 40) {
      setCurrentIndex((index) => Math.min(activePhotos.length - 1, Math.max(0, index + (deltaX < 0 ? 1 : -1))))
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    pointerRef.current = null
  }

  function cancelSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerRef.current?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    pointerRef.current = null
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    setMessage('')
    if (!files.length) return
    if (files.length > remaining) {
      setSelectedFiles([])
      setMessage(`${categoryLabel(activeCategory)}还可上传 ${remaining} 张，本批次不能超过上限`)
      event.target.value = ''
      return
    }
    const invalid = files.find((file) => !ACCEPTED_MIME_TYPES.has(file.type) || file.size < 1 || file.size > MAX_FILE_SIZE)
    if (invalid) {
      setSelectedFiles([])
      setMessage('仅支持不超过 12MB 的 JPG、PNG、WebP 或 AVIF 静态图片')
      event.target.value = ''
      return
    }
    setSelectedFiles(files)
  }

  async function uploadSelected() {
    if (!attendanceId || !selectedFiles.length || busy) return
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('category', activeCategory)
      form.append('watermark', String(watermark))
      selectedFiles.forEach((file) => form.append('files', file, file.name))
      const response = await fetch(`/api/music/live/attendance/${encodeURIComponent(attendanceId)}/photos`, { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '照片上传失败，请稍后重试')
      onPhotosChange?.(body?.photos || [])
      setSelectedFiles([])
      setWatermark(false)
      if (inputRef.current) inputRef.current.value = ''
      setMessage(`已上传 ${body?.addedCount || 0} 张照片`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '照片上传失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function deleteCurrent() {
    if (!attendanceId || !activePhoto || busy) return
    if (!window.confirm('删除这张照片？删除后如需恢复，只能重新上传。')) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/music/live/attendance/${encodeURIComponent(attendanceId)}/photos/${encodeURIComponent(activePhoto.id)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '删除失败，请稍后重试')
      const nextPhotos = photos.filter((photo) => photo.id !== activePhoto.id)
      onPhotosChange?.(nextPhotos)
      setCurrentIndex((index) => Math.min(index, Math.max(0, activePhotos.length - 2)))
      setMessage('照片已删除')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function reorderCurrent(direction: 'previous' | 'next') {
    if (!attendanceId || !activePhoto || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/music/live/attendance/${encodeURIComponent(attendanceId)}/photos/${encodeURIComponent(activePhoto.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }), credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '排序失败，请稍后重试')
      const reordered = Array.isArray(body?.photos) ? body.photos as MyLivePhotoView[] : []
      onPhotosChange?.([...photos.filter((photo) => photo.category !== activeCategory), ...reordered])
      const nextIndex = reordered.findIndex((photo) => photo.id === activePhoto.id)
      if (nextIndex >= 0) setCurrentIndex(nextIndex)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '排序失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="my-live-photo-panel" aria-label={`${categoryLabel(activeCategory)}照片`} onClick={(event) => event.stopPropagation()}>
      <div className="my-live-photo-toolbar">
        <div className="my-live-photo-category-tabs" role="tablist" aria-label="照片分类">
          {(['TICKET', 'LIVE'] as const).map((item) => {
            const count = photos.filter((photo) => photo.category === item).length
            return <button key={item} type="button" role="tab" aria-selected={activeCategory === item} className={activeCategory === item ? 'is-active' : ''} onClick={(event) => { event.preventDefault(); event.stopPropagation(); selectCategory(item) }}>{categoryLabel(item)} {count} / {categoryLimit(item)}</button>
          })}
        </div>
        {manage ? <button type="button" className="my-live-photo-manage-button" onClick={() => { setManageOpen((open) => !open); setMessage('') }}>{manageOpen ? '收起管理' : photos.length ? '管理照片' : '添加照片'}</button> : null}
      </div>

      {activePhoto ? <div className="my-live-photo-carousel" role="region" aria-roledescription="carousel" aria-label={`${categoryLabel(activeCategory)}照片，共 ${activePhotos.length} 张`}>
        <div className="my-live-photo-viewport" onPointerDown={beginSwipe} onPointerMove={moveSwipe} onPointerUp={finishSwipe} onPointerCancel={cancelSwipe}>
          {/* eslint-disable-next-line @next/next/no-img-element -- media gateway URLs are runtime-configured and use contain sizing. */}
          <img src={activePhoto.imageUrl} alt={`${categoryLabel(activeCategory)}照片 ${currentIndex + 1}`} width={activePhoto.width} height={activePhoto.height} loading="lazy" decoding="async" fetchPriority={manage ? 'high' : 'low'} className="my-live-photo-image" />
        </div>
        {activePhotos.length > 1 ? <>
          <button type="button" className="my-live-photo-arrow my-live-photo-arrow-previous" aria-label="上一张照片" onClick={(event) => goTo(currentIndex - 1, event)} disabled={currentIndex === 0}>‹</button>
          <button type="button" className="my-live-photo-arrow my-live-photo-arrow-next" aria-label="下一张照片" onClick={(event) => goTo(currentIndex + 1, event)} disabled={currentIndex === activePhotos.length - 1}>›</button>
        </> : null}
        <span className="my-live-photo-counter" aria-live="polite">{currentIndex + 1} / {activePhotos.length}</span>
      </div> : <div className="my-live-photo-empty">{manage ? `${categoryLabel(activeCategory)}还没有照片` : '暂无照片'}</div>}

      {manage && manageOpen ? <div className="my-live-photo-manager">
        <div className="my-live-photo-manager-heading"><strong>{categoryLabel(activeCategory)}照片</strong><span>{activePhotos.length} / {categoryLimit(activeCategory)}</span></div>
        <label className="my-live-photo-file-picker">选择图片
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={handleFileChange} disabled={busy || remaining === 0} />
        </label>
        {selectedFiles.length ? <div className="my-live-photo-confirmation"><p>已选择 {selectedFiles.length} 张照片</p><ul>{selectedFiles.map((file) => <li key={`${file.name}-${file.size}-${file.lastModified}`}>{file.name}</li>)}</ul><label className="my-live-photo-watermark-option"><input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} disabled={busy} /><span>添加我的水印<small>图片右下角将显示：{watermarkPreview || '你的用户名  UID:当前账号'}</small></span></label>{activeCategory === 'TICKET' ? <p className="my-live-photo-note">票根上传前请留意票面中的个人信息。</p> : null}<div className="my-live-photo-confirm-actions"><button type="button" onClick={() => { setSelectedFiles([]); setWatermark(false); if (inputRef.current) inputRef.current.value = '' }} disabled={busy}>取消</button><button type="button" onClick={() => void uploadSelected()} disabled={busy}>{busy ? '上传中…' : '保存上传'}</button></div></div> : null}
        {activePhoto ? <div className="my-live-photo-current-actions"><span>当前照片</span><button type="button" onClick={() => void reorderCurrent('previous')} disabled={busy || currentIndex === 0}>前移</button><button type="button" onClick={() => void reorderCurrent('next')} disabled={busy || currentIndex === activePhotos.length - 1}>后移</button><button type="button" onClick={() => void deleteCurrent()} disabled={busy}>删除照片</button></div> : null}
        {message ? <p className="my-live-photo-message" role="status">{message}</p> : null}
      </div> : null}
      {!manageOpen && message ? <p className="my-live-photo-message" role="status">{message}</p> : null}
    </section>
  )
}
