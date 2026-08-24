'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { publicImageVariantUrl } from '@/lib/image-variants'

export type ActivityImageSelection = { file: File | null; removed: boolean }
export type ActivityImageUploadStatus = 'idle' | 'uploading' | 'success' | 'error'

export async function uploadActivityImage(file: File) {
  const body = new FormData()
  body.append('file', file, file.name)
  const response = await fetch('/api/uploads/activity-image', { method: 'POST', body, credentials: 'same-origin', cache: 'no-store' })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || '图片上传失败，请稍后重试')
  if (typeof data?.url !== 'string' || !data.url) throw new Error('图片上传结果无效，请重试')
  return data.url as string
}

function fileError(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) return '仅支持 JPG、PNG 或 WebP 图片'
  if (file.size > 5 * 1024 * 1024) return '图片不能超过 5MB'
  if (file.size < 1) return '图片内容为空'
  return ''
}

export function ActivityImageUploader({ label, initialUrl, disabled = false, status = 'idle', onSelectionChange }: Readonly<{
  label: string
  initialUrl?: string | null
  disabled?: boolean
  status?: ActivityImageUploadStatus
  onSelectionChange: (selection: ActivityImageSelection) => void
}>) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const originalUrl = initialUrl?.trim() || null

  useEffect(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setPreviewUrl(originalUrl ? publicImageVariantUrl(originalUrl, 'card') || originalUrl : null)
    setSelectionError('')
  }, [originalUrl])

  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current) }, [])

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const error = fileError(file)
    if (error) { setSelectionError(error); return }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = URL.createObjectURL(file)
    setPreviewUrl(objectUrlRef.current)
    setSelectionError('')
    onSelectionChange({ file, removed: false })
  }

  function remove() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setPreviewUrl(null)
    setSelectionError('')
    onSelectionChange({ file: null, removed: true })
  }

  const statusLabel = status === 'uploading' ? '上传中…' : status === 'success' ? '上传成功' : status === 'error' ? '上传失败' : ''
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-sky-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-black text-slate-700 dark:text-slate-200">{label}</span>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700 disabled:opacity-50 dark:bg-slate-800 dark:text-sky-200">{previewUrl ? '重新选择' : '上传图片'}</button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={selectFile} disabled={disabled} className="sr-only" />
        {previewUrl ? <button type="button" onClick={remove} disabled={disabled} className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50 dark:bg-red-950/40 dark:text-red-200">移除</button> : null}
        {statusLabel ? <span role="status" className={`text-xs font-black ${status === 'error' ? 'text-red-600' : status === 'success' ? 'text-emerald-600' : 'text-sky-700'}`}>{statusLabel}</span> : null}
      </div>
      {previewUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={previewUrl} alt={`${label}预览`} className="max-h-44 w-full rounded-lg object-cover" />
      ) : <p className="text-xs font-bold text-slate-400">尚未上传。支持 JPG、PNG、WebP，单张不超过 5MB。</p>}
      {selectionError ? <p role="alert" className="text-xs font-bold text-red-600">{selectionError}</p> : null}
    </div>
  )
}
