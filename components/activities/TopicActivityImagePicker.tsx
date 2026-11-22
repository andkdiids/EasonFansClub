'use client'

import { useRef, useState } from 'react'
import { TopicActivityAssetImage } from '@/components/activities/TopicActivityAssetImage'
import { uploadTopicActivityImage, type TopicActivityUploadedAsset, type ContentImageUploadPhase } from '@/lib/content-image-browser'

const TOPIC_ACTIVITY_IMAGE_ACCEPT = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  ...['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].map((extension) => `.${extension}`),
].join(',')

type LocalFileDetails = { name: string; size: number }

type TopicActivityAssetWithAccessUrls = TopicActivityUploadedAsset & { previewAccessUrl?: string; thumbnailAccessUrl?: string }

function assetUrl(asset: TopicActivityUploadedAsset) {
  const withAccessUrls = asset as TopicActivityAssetWithAccessUrls
  return withAccessUrls.thumbnailAccessUrl || withAccessUrls.previewAccessUrl || asset.thumbnailUrl || asset.url
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function TopicActivityImagePicker({ activityId, purpose, rewardEntryId, assets, onChange, onUploadingChange, maxImages = 9, disabled = false, allowPaste = false }: {
  activityId: string
  purpose: 'FORM_ANSWER' | 'ADMIN_REPLY'
  rewardEntryId?: string
  assets: TopicActivityUploadedAsset[]
  onChange: (assets: TopicActivityUploadedAsset[]) => void
  onUploadingChange?: (uploading: boolean) => void
  maxImages?: number
  disabled?: boolean
  allowPaste?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadingRef = useRef(false)
  const [uploading, setUploading] = useState(0)
  const [phase, setPhase] = useState<ContentImageUploadPhase | null>(null)
  const [error, setError] = useState('')
  const [fileDetails, setFileDetails] = useState<Record<string, LocalFileDetails>>({})
  async function selectFiles(files: FileList | File[] | null) {
    if (!files?.length || disabled || uploadingRef.current) return
    const remaining = Math.max(0, maxImages - assets.length)
    if (!remaining) { setError(`最多选择 ${maxImages} 张图片`); return }
    if (files.length > remaining) { setError(`最多选择 ${maxImages} 张图片`); if (inputRef.current) inputRef.current.value = ''; return }
    const selected = Array.from(files)
    setError('')
    uploadingRef.current = true
    onUploadingChange?.(true)
    setUploading(selected.length)
    const uploaded: TopicActivityUploadedAsset[] = []
    try {
      for (const file of selected) {
        const asset = await uploadTopicActivityImage(file, { activityId, purpose, rewardEntryId }, setPhase)
        uploaded.push(asset)
        setFileDetails((current) => ({ ...current, [asset.assetId]: { name: file.name || '未命名图片', size: file.size } }))
        onChange([...assets, ...uploaded])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片上传失败，请重试')
    } finally {
      setUploading(0)
      setPhase(null)
      uploadingRef.current = false
      onUploadingChange?.(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }
  async function pasteImage() {
    try {
      if (!navigator.clipboard?.read) throw new Error()
      const images = (await navigator.clipboard.read()).flatMap((item) => {
        const format = item.types.find((type) => /^image\/(png|jpeg|webp)$/.test(type))
        return format ? [item.getType(format)] : []
      })
      const files = await Promise.all(images)
      if (!files.length) { setError('剪贴板里没有图片，请先复制截图。'); return }
      await selectFiles(files.map((file) => new File([file], '分享截图.' + file.type.split('/')[1], { type: file.type })))
    } catch {
      setError('无法读取剪贴板，请选择上传图片。')
    }
  }
  return <div className="min-w-0 max-w-full space-y-2">
    {assets.length ? <div className="flex flex-wrap gap-2">{assets.map((asset) => { const details = fileDetails[asset.assetId]; return <div key={asset.assetId} className="relative w-28 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"><TopicActivityAssetImage src={assetUrl(asset)} alt="已选择的图片附件" className="h-20 w-full object-cover" /><div className="space-y-0.5 p-1 text-[10px] leading-4 text-slate-600 dark:text-slate-300"><p className="truncate" title={details?.name}>{details?.name || '原图附件'}</p><p>{asset.width} × {asset.height} · {formatFileSize(details?.size || asset.size)}</p></div><button type="button" onClick={() => { setFileDetails((current) => { const next = { ...current }; delete next[asset.assetId]; return next }); onChange(assets.filter((item) => item.assetId !== asset.assetId)) }} disabled={disabled || uploading > 0} aria-label="移除图片" className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white">×</button></div> })}</div> : null}
    <input ref={inputRef} type="file" accept={TOPIC_ACTIVITY_IMAGE_ACCEPT} multiple={maxImages > 1} disabled={disabled || uploading > 0 || uploadingRef.current || assets.length >= maxImages} onChange={(event) => { const files = event.currentTarget.files; if (files) void selectFiles(files) }} className="sr-only" />
    <p className="text-xs leading-5 text-[var(--foreground-muted)]">将按原图上传，不压缩。</p>
    <div className="flex flex-wrap gap-2">
    <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading > 0 || uploadingRef.current || assets.length >= maxImages} className="min-h-9 rounded-lg border border-dashed border-slate-400 px-3 text-sm font-bold text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">{uploading ? `图片上传中（${phase === 'uploading' ? '上传' : '读取'}）…` : '上传图片'}</button>
    {allowPaste && <button type="button" className="min-h-9 rounded-lg border border-slate-400 px-3 text-sm font-bold disabled:opacity-40"
      disabled={disabled || uploading > 0 || assets.length >= maxImages} onClick={() => void pasteImage()}>粘贴图片</button>}
    </div>
    {error ? <p role="alert" className="text-xs font-bold text-red-600">{error}</p> : null}
  </div>
}
