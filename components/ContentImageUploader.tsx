'use client'

import { useState } from 'react'
import { MAX_CONTENT_IMAGES } from '@/lib/content-images'

async function compressToWebp(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
  if (!blob) throw new Error('图片压缩失败')
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' })
}

export function ContentImageUploader({ value, onChange }: Readonly<{ value: string[]; onChange: (urls: string[]) => void }>) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setError('')
    try {
      const next = [...value]
      for (const file of Array.from(files).slice(0, MAX_CONTENT_IMAGES - value.length)) {
        const compressed = await compressToWebp(file)
        const form = new FormData(); form.set('file', compressed)
        const response = await fetch('/api/uploads/content-image', { method: 'POST', body: form })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || typeof data.url !== 'string') throw new Error(data.message || '图片上传失败')
        next.push(data.url)
      }
      onChange(next)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '图片上传失败') } finally { setUploading(false) }
  }

  return <div className="space-y-2">
    <label className="inline-flex cursor-pointer items-center rounded-lg border border-sky-100 bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
      {uploading ? '压缩并上传中…' : `添加图片（${value.length}/${MAX_CONTENT_IMAGES}）`}
      <input type="file" accept="image/*" multiple disabled={uploading || value.length >= MAX_CONTENT_IMAGES} onChange={(event) => void upload(event.target.files)} className="sr-only" />
    </label>
    {value.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{value.map((url) => <div key={url} className="relative"><img src={url} alt="已上传内容" className="h-24 w-full rounded-xl object-cover" /><button type="button" onClick={() => onChange(value.filter((item) => item !== url))} className="absolute right-1 top-1 rounded-full bg-slate-950/80 px-2 py-1 text-xs text-white">删除</button></div>)}</div> : null}
    {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
  </div>
}
