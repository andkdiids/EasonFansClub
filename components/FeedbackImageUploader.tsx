'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { FEEDBACK_ALLOWED_IMAGE_TYPES, FEEDBACK_MAX_ATTACHMENTS, FEEDBACK_MAX_FILE_SIZE } from '@/lib/feedback'

export type UploadedFeedbackAttachment = { url: string; mimeType?: string | null }
type UploadItem = {
  id: string
  file: File
  previewUrl: string
  status: 'waiting' | 'uploading' | 'success' | 'failed'
  uploaded?: UploadedFeedbackAttachment
  error?: string
}

export function FeedbackImageUploader({ onChange, onBusyChange }: {
  onChange: (attachments: UploadedFeedbackAttachment[]) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [items, setItems] = useState<UploadItem[]>([])
  const itemsRef = useRef(items)
  const onChangeRef = useRef(onChange)
  const onBusyChangeRef = useRef(onBusyChange)
  itemsRef.current = items
  onChangeRef.current = onChange
  onBusyChangeRef.current = onBusyChange

  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), [])
  useEffect(() => {
    onChangeRef.current(items.flatMap((item) => item.status === 'success' && item.uploaded ? [item.uploaded] : []))
    onBusyChangeRef.current(items.some((item) => item.status !== 'success'))
  }, [items])

  async function uploadItem(item: UploadItem) {
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: 'uploading', error: undefined } : row))
    try {
      const body = new FormData()
      body.append('file', item.file)
      const response = await fetch('/api/uploads/feedback-image', { method: 'POST', body, cache: 'no-store' })
      const data = await response.json().catch(() => null) as { url?: string; mimeType?: string; message?: string; detail?: string } | null
      const fallbackMessage = process.env.NODE_ENV === 'development'
        ? `图片上传失败（HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}）`
        : '图片上传失败'
      if (!response.ok || !data?.url) throw new Error(data?.message || (process.env.NODE_ENV === 'development' ? data?.detail : '') || fallbackMessage)
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: 'success', uploaded: { url: data.url!, mimeType: data.mimeType || item.file.type } } : row))
    } catch (reason) {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: 'failed', error: reason instanceof Error ? reason.message : '图片上传失败' } : row))
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const remaining = FEEDBACK_MAX_ATTACHMENTS - items.length
    const accepted = files.slice(0, Math.max(0, remaining)).map((file) => {
      const error = !FEEDBACK_ALLOWED_IMAGE_TYPES.includes(file.type as typeof FEEDBACK_ALLOWED_IMAGE_TYPES[number])
        ? '仅支持 JPG、PNG、WEBP 或 GIF 图片'
        : file.size > FEEDBACK_MAX_FILE_SIZE ? '单张图片不能超过 10MB' : undefined
      return {
        id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file),
        status: error ? 'failed' as const : 'waiting' as const, error,
      }
    })
    setItems((current) => [...current, ...accepted])
    accepted.filter((item) => item.status === 'waiting').forEach((item) => void uploadItem(item))
  }

  function remove(id: string) {
    setItems((current) => {
      const target = current.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.id !== id)
    })
  }

  return <div className="space-y-3">
    <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
      选择图片
      <input type="file" accept={FEEDBACK_ALLOWED_IMAGE_TYPES.join(',')} multiple onChange={selectFiles} className="sr-only" />
    </label>
    <span className="ml-3 text-xs font-bold text-slate-500">已选择 {items.length} / {FEEDBACK_MAX_ATTACHMENTS}</span>
    {items.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-sky-100 bg-white">
        <img src={item.previewUrl} alt={item.file.name} className="h-24 w-full object-cover" />
        <div className="space-y-2 p-2 text-xs font-bold">
          <p className={item.status === 'failed' ? 'text-red-600' : item.status === 'success' ? 'text-emerald-600' : 'text-sky-700'}>
            {item.status === 'waiting' ? '等待上传' : item.status === 'uploading' ? '上传中…' : item.status === 'success' ? '上传成功' : item.error || '上传失败'}
          </p>
          <div className="flex gap-2">
            {item.status === 'failed' && !item.error?.startsWith('仅支持') && !item.error?.includes('10MB') ? <button type="button" onClick={() => void uploadItem(item)} className="text-brand-700">重试</button> : null}
            <button type="button" onClick={() => remove(item.id)} className="text-red-600">删除</button>
          </div>
        </div>
      </article>)}
    </div> : null}
  </div>
}
