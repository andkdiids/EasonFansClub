'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { publicImageVariantUrl } from '@/lib/image-variants'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

function validateFile(file: File) {
  if (!ACCEPTED_TYPES.includes(file.type.trim().toLowerCase() as (typeof ACCEPTED_TYPES)[number])) return '仅支持 JPG、PNG、WebP 或 GIF 图片'
  if (file.size < 1) return '图片内容为空'
  if (file.size > MAX_FILE_SIZE) return '图片不能超过 10MB'
  return ''
}

export function AngelGiftImageUploader({ value, disabled = false, onChange, onUploadingChange }: Readonly<{
  value: string | null
  disabled?: boolean
  onChange: (value: string | null) => void
  onUploadingChange?: (uploading: boolean) => void
}>) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const previewUrl = value ? publicImageVariantUrl(value, 'large') || value : null

  function setUploadState(next: boolean) {
    setUploading(next)
    onUploadingChange?.(next)
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setUploadState(true)
    try {
      const body = new FormData()
      body.append('file', file, file.name)
      const response = await fetch('/api/admin/angel-gift/visual-image', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => null) as { url?: unknown; message?: unknown } | null
      if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : '图片上传失败，请稍后重试')
      if (typeof data?.url !== 'string' || !data.url.trim()) throw new Error('图片上传结果无效，请重试')
      onChange(data.url)
    } catch (caught) {
      // Keep the previous value untouched when a replacement upload fails.
      setError(caught instanceof Error ? caught.message : '图片上传失败，请稍后重试')
    } finally {
      setUploadState(false)
    }
  }

  function removeImage() {
    if (!value || !window.confirm('确认移除当前主题视觉图吗？')) return
    setError('')
    onChange(null)
  }

  return (
    <div className="space-y-3 border border-dashed border-amber-200 p-3 dark:border-slate-700" aria-label="主题视觉图上传">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-black text-slate-700 dark:text-slate-200">主题视觉图（可选）</span>
        <button type="button" className="admin-secondary-button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? '上传中…' : previewUrl ? '替换图片' : '上传图片'}
        </button>
        <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" disabled={disabled || uploading} onChange={selectFile} />
        {previewUrl ? <button type="button" className="admin-danger-button" disabled={disabled || uploading} onClick={removeImage}>移除</button> : null}
        {uploading ? <span role="status" className="text-xs font-black text-amber-700 dark:text-amber-300">图片处理中，请稍候…</span> : null}
      </div>
      {previewUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={previewUrl} alt="主题视觉图预览" className="max-h-56 w-full object-contain" />
      ) : <p className="text-xs font-bold text-slate-400">尚未上传。支持 JPG、PNG、WebP 或 GIF，单张不超过 10MB。</p>}
      {error ? <p role="alert" className="text-xs font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
