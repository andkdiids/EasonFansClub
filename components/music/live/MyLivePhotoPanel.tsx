'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ImageViewer } from '@/components/ImageViewer'
import { MY_LIVE_PHOTO_LIMITS, type MyLivePhotoCategoryValue, type MyLivePhotoView } from '@/lib/my-live-photo-types'

const MAX_FILE_SIZE = 12 * 1024 * 1024
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const PHOTO_CATEGORIES: readonly MyLivePhotoCategoryValue[] = ['TICKET', 'LIVE']

type InputRefs = Record<MyLivePhotoCategoryValue, HTMLInputElement | null>

function categoryLabel(category: MyLivePhotoCategoryValue) {
  return category === 'TICKET' ? '票根' : '现场'
}

function emptyLabel(category: MyLivePhotoCategoryValue) {
  return category === 'TICKET' ? '还没有上传票根' : '还没有上传现场照片'
}

function addLabel(category: MyLivePhotoCategoryValue) {
  return category === 'TICKET' ? '添加票根' : '添加现场照片'
}

function categoryLimit(category: MyLivePhotoCategoryValue) {
  return MY_LIVE_PHOTO_LIMITS[category]
}

export function MyLivePhotoPanel({ attendanceId, photos = [], manage = false, watermarkPreview, onPhotosChange }: Readonly<{
  attendanceId?: string
  photos?: MyLivePhotoView[]
  manage?: boolean
  watermarkPreview?: string
  onPhotosChange?: (photos: MyLivePhotoView[]) => void
}>) {
  const [currentPhotos, setCurrentPhotos] = useState<MyLivePhotoView[]>(photos)
  const [manageCategory, setManageCategory] = useState<MyLivePhotoCategoryValue | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<MyLivePhotoCategoryValue | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [watermark, setWatermark] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const inputRefs = useRef<InputRefs>({ TICKET: null, LIVE: null })

  useEffect(() => setCurrentPhotos(photos), [photos])

  function updatePhotos(nextPhotos: MyLivePhotoView[]) {
    setCurrentPhotos(nextPhotos)
    onPhotosChange?.(nextPhotos)
  }

  function clearSelection(category: MyLivePhotoCategoryValue) {
    setSelectedFiles([])
    setSelectedCategory(null)
    setWatermark(false)
    if (inputRefs.current[category]) inputRefs.current[category]!.value = ''
  }

  function handleFileChange(category: MyLivePhotoCategoryValue, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    setMessage('')
    if (!files.length) return
    const categoryPhotos = currentPhotos.filter((photo) => photo.category === category)
    const remaining = Math.max(0, Math.min(categoryLimit(category) - categoryPhotos.length, MY_LIVE_PHOTO_LIMITS.TOTAL - currentPhotos.length))
    if (files.length > remaining) {
      setSelectedFiles([])
      setSelectedCategory(null)
      setMessage(`${categoryLabel(category)}还可上传 ${remaining} 张，本批次不能超过上限`)
      event.target.value = ''
      return
    }
    const invalid = files.find((file) => !ACCEPTED_MIME_TYPES.has(file.type) || file.size < 1 || file.size > MAX_FILE_SIZE)
    if (invalid) {
      setSelectedFiles([])
      setSelectedCategory(null)
      setMessage('仅支持不超过 12MB 的 JPG、PNG、WebP 或 AVIF 静态图片')
      event.target.value = ''
      return
    }
    setSelectedCategory(category)
    setSelectedFiles(files)
  }

  async function uploadSelected(category: MyLivePhotoCategoryValue) {
    if (!attendanceId || selectedCategory !== category || !selectedFiles.length || busy) return
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('category', category)
      form.append('watermark', String(watermark))
      selectedFiles.forEach((file) => form.append('files', file, file.name))
      const response = await fetch(`/api/music/live/attendance/${encodeURIComponent(attendanceId)}/photos`, { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '照片上传失败，请稍后重试')
      if (Array.isArray(body?.photos)) updatePhotos(body.photos as MyLivePhotoView[])
      const addedCount = typeof body?.addedCount === 'number' ? body.addedCount : selectedFiles.length
      clearSelection(category)
      setMessage(`已上传 ${addedCount} 张照片`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '照片上传失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function deletePhoto(photo: MyLivePhotoView) {
    if (!attendanceId || busy) return
    if (!window.confirm('删除这张照片？删除后如需恢复，只能重新上传。')) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/music/live/attendance/${encodeURIComponent(attendanceId)}/photos/${encodeURIComponent(photo.id)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '删除失败，请稍后重试')
      updatePhotos(currentPhotos.filter((item) => item.id !== photo.id))
      setMessage('照片已删除')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function reorderPhoto(photo: MyLivePhotoView, direction: 'previous' | 'next') {
    if (!attendanceId || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/music/live/attendance/${encodeURIComponent(attendanceId)}/photos/${encodeURIComponent(photo.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }), credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.message || '排序失败，请稍后重试')
      if (Array.isArray(body?.photos)) {
        const reordered = body.photos as MyLivePhotoView[]
        updatePhotos([...currentPhotos.filter((item) => item.category !== photo.category), ...reordered])
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '排序失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="my-live-photo-panel" aria-label="场次照片">
      {PHOTO_CATEGORIES.map((category) => {
        const categoryPhotos = currentPhotos.filter((photo) => photo.category === category)
        const remaining = Math.max(0, Math.min(categoryLimit(category) - categoryPhotos.length, MY_LIVE_PHOTO_LIMITS.TOTAL - currentPhotos.length))
        const isManaging = manageCategory === category

        return (
          <section key={category} className="my-live-photo-section" aria-labelledby={`my-live-photo-${category.toLowerCase()}-title`}>
            <h2 id={`my-live-photo-${category.toLowerCase()}-title`} className="my-live-photo-section-title">{categoryLabel(category)}</h2>
            <div className="my-live-photo-divider" aria-hidden="true" />
            {categoryPhotos.length ? (
              <div className="my-live-photo-grid">
                {categoryPhotos.map((photo, index) => (
                  <div key={photo.id} className="my-live-photo-item">
                    <ImageViewer
                      src={photo.imageUrl}
                      alt={`${categoryLabel(category)}照片 ${index + 1}`}
                      imageClassName="h-full w-full object-contain"
                      buttonClassName="my-live-photo-thumbnail"
                      fetchPriority={manage ? 'high' : 'low'}
                    />
                    {manage && isManaging ? <div className="my-live-photo-item-actions">
                      <button type="button" onClick={() => void reorderPhoto(photo, 'previous')} disabled={busy || index === 0}>前移</button>
                      <button type="button" onClick={() => void reorderPhoto(photo, 'next')} disabled={busy || index === categoryPhotos.length - 1}>后移</button>
                      <button type="button" onClick={() => void deletePhoto(photo)} disabled={busy}>删除</button>
                    </div> : null}
                  </div>
                ))}
              </div>
            ) : <p className="my-live-photo-empty">{emptyLabel(category)}</p>}
            {manage ? <div className="my-live-photo-actions">
              {remaining > 0 ? <label className="my-live-photo-file-picker">{addLabel(category)}
                <input ref={(element) => { inputRefs.current[category] = element }} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={(event) => handleFileChange(category, event)} disabled={busy} />
              </label> : <span className="my-live-photo-limit">已达到{categoryLabel(category)}数量上限</span>}
              {categoryPhotos.length ? <button type="button" className="my-live-photo-manage-button" onClick={() => { setManageCategory(isManaging ? null : category); setMessage('') }}>{isManaging ? '完成管理' : `管理${categoryLabel(category)}`}</button> : null}
            </div> : null}
            {manage && selectedCategory === category && selectedFiles.length ? <div className="my-live-photo-confirmation">
              <p>已选择 {selectedFiles.length} 张照片</p>
              <ul>{selectedFiles.map((file) => <li key={`${file.name}-${file.size}-${file.lastModified}`}>{file.name}</li>)}</ul>
              <label className="my-live-photo-watermark-option"><input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} disabled={busy} /><span>添加我的水印<small>图片右下角将显示：{watermarkPreview || '你的昵称  UID:当前账号'}</small></span></label>
              {category === 'TICKET' ? <p className="my-live-photo-note">票根上传前请留意票面中的个人信息。</p> : null}
              <div className="my-live-photo-confirm-actions"><button type="button" onClick={() => clearSelection(category)} disabled={busy}>取消</button><button type="button" onClick={() => void uploadSelected(category)} disabled={busy}>{busy ? '上传中…' : '保存上传'}</button></div>
            </div> : null}
          </section>
        )
      })}
      {message ? <p className="my-live-photo-message" role="status">{message}</p> : null}
    </div>
  )
}
