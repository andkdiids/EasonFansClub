'use client'

import { useState } from 'react'
import { MAX_CONTENT_IMAGES } from '@/lib/content-images'

export function ContentImageUploader({ value, onChange }: Readonly<{ value: string[]; onChange: (urls: string[]) => void }>) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {value.map((url) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="已上传内容" className="h-24 w-full rounded-xl object-cover" />
              <button
                type="button"
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
