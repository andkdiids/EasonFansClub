'use client'

import { useRef, useState } from 'react'
import { CONTENT_IMAGE_ACCEPT } from '@/lib/content-image-upload'
import { uploadTopicActivityImage, type TopicActivityUploadedAsset, type ContentImageUploadPhase } from '@/lib/content-image-browser'

export function TopicActivityImagePicker({ activityId, purpose, assets, onChange, maxImages = 9, disabled = false }: {
  activityId: string
  purpose: 'FORM_ANSWER' | 'ADMIN_REPLY'
  assets: TopicActivityUploadedAsset[]
  onChange: (assets: TopicActivityUploadedAsset[]) => void
  maxImages?: number
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [phase, setPhase] = useState<ContentImageUploadPhase | null>(null)
  const [error, setError] = useState('')
  async function selectFiles(files: FileList | null) {
    if (!files?.length) return
    const remaining = Math.max(0, maxImages - assets.length)
    if (!remaining) { setError(`最多选择 ${maxImages} 张图片`); return }
    const selected = Array.from(files).slice(0, remaining)
    setError('')
    setUploading(selected.length)
    const uploaded: TopicActivityUploadedAsset[] = []
    try {
      for (const file of selected) {
        uploaded.push(await uploadTopicActivityImage(file, { activityId, purpose }, setPhase))
        onChange([...assets, ...uploaded])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片上传失败，请重试')
    } finally {
      setUploading(0)
      setPhase(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  return <div className="space-y-2">
    {assets.length ? <div className="flex flex-wrap gap-2">{assets.map((asset) => <div key={asset.assetId} className="relative size-20 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"><img src={asset.thumbnailUrl} alt="已选择的图片附件" className="size-full object-cover" /><button type="button" onClick={() => onChange(assets.filter((item) => item.assetId !== asset.assetId))} disabled={disabled || uploading > 0} aria-label="移除图片" className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white">×</button></div>)}</div> : null}
    <input ref={inputRef} type="file" accept={CONTENT_IMAGE_ACCEPT} multiple={maxImages > 1} disabled={disabled || uploading > 0 || assets.length >= maxImages} onChange={(event) => { const files = event.currentTarget.files; if (files) void selectFiles(files) }} className="sr-only" />
    <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading > 0 || assets.length >= maxImages} className="min-h-9 rounded-lg border border-dashed border-slate-400 px-3 text-sm font-bold text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">{uploading ? `图片处理中（${phase === 'compressing' ? '压缩' : phase === 'uploading' ? '上传' : '读取'}）…` : '上传图片'}</button>
    {error ? <p role="alert" className="text-xs font-bold text-red-600">{error}</p> : null}
  </div>
}
