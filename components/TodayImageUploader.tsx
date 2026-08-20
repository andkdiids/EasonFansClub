'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { todayImageFileError } from '@/lib/today-image'

export type TodayImageSelection = {
  file: File | null
  removed: boolean
}

export type TodayImageUploadStatus = 'idle' | 'uploading' | 'success' | 'error'

type TodayImageUploaderProps = {
  initialUrl?: string | null
  disabled?: boolean
  status?: TodayImageUploadStatus
  onSelectionChange: (selection: TodayImageSelection) => void
}

export async function uploadTodayImage(file: File, scope: 'user' | 'admin' = 'user') {
  const body = new FormData()
  body.append('file', file, file.name)
  const endpoint = scope === 'admin' ? '/api/uploads/today-image?scope=admin' : '/api/uploads/today-image'
  const response = await fetch(endpoint, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || '图片上传失败，请稍后重试')
  if (typeof data?.url !== 'string' || !data.url) throw new Error('图片上传结果无效，请重试')
  return data.url as string
}

export function TodayImageUploader({ initialUrl, disabled = false, status = 'idle', onSelectionChange }: TodayImageUploaderProps) {
  const originalUrl = initialUrl?.trim() || null
  const inputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [selectionError, setSelectionError] = useState('')

  useEffect(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setPreviewUrl(originalUrl ? publicImageVariantUrl(originalUrl, 'card') || originalUrl : null)
    setHasSelection(false)
    setSelectionError('')
  }, [originalUrl])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const validationError = todayImageFileError(file)
    if (validationError) {
      setSelectionError(validationError)
      return
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const nextPreviewUrl = URL.createObjectURL(file)
    objectUrlRef.current = nextPreviewUrl
    setPreviewUrl(nextPreviewUrl)
    setHasSelection(true)
    setSelectionError('')
    onSelectionChange({ file, removed: false })
  }

  function removeImage() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setPreviewUrl(null)
    setHasSelection(false)
    setSelectionError('')
    onSelectionChange({ file: null, removed: true })
  }

  const statusLabel = status === 'uploading'
    ? '上传中...'
    : status === 'success'
      ? '上传成功'
      : status === 'error'
        ? '上传失败'
        : ''

  return (
    <div className="space-y-3" aria-label="上传图片">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {previewUrl ? '重新选择' : '上传图片'}
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileChange} disabled={disabled} className="sr-only" />
        {previewUrl ? (
          <button type="button" onClick={removeImage} disabled={disabled} className="rounded-full border border-red-100 px-4 py-2 text-sm font-black text-red-600 disabled:cursor-not-allowed disabled:opacity-60">
            删除图片
          </button>
        ) : null}
        {statusLabel ? <span role="status" className={`text-sm font-black ${status === 'error' ? 'text-red-600' : status === 'success' ? 'text-emerald-600' : 'text-sky-700'}`}>{statusLabel}</span> : null}
      </div>
      {previewUrl ? (
        <div className="flex min-h-36 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50/40 p-3 sm:min-h-48">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="已选择的图片" className="max-h-64 max-w-full rounded-xl object-contain sm:max-h-80" />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/30 px-4 py-6 text-center text-sm font-bold text-slate-500">
          还没有选择图片
        </div>
      )}
      <p className="text-xs font-bold text-slate-400">支持常见图片格式，单张不超过 10MB</p>
      {selectionError ? <p role="alert" className="text-sm font-bold text-red-600">{selectionError}</p> : null}
      {hasSelection ? <span className="sr-only">已选择新图片</span> : null}
    </div>
  )
}
