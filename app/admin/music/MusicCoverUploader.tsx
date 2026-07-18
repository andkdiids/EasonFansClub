'use client'

import Image from 'next/image'
import { useState } from 'react'

export function MusicCoverUploader({ entityType, entityId, currentUrl, onUploaded }: Readonly<{ entityType: 'album' | 'song'; entityId: string; currentUrl?: string | null; onUploaded?: (url: string) => void }>) {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState(currentUrl || '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  async function upload() {
    if (!file || uploading) return
    setUploading(true); setError(''); setMessage('')
    const form = new FormData(); form.set('file', file); form.set('entityType', entityType); form.set('entityId', entityId)
    try {
      const response = await fetch('/api/admin/music/covers', { method: 'POST', body: form })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '封面上传失败')
      setUrl(data.url); setFile(null); setMessage('封面已转换为 WebP 并保存'); onUploaded?.(data.url)
    } catch (err) { setError(err instanceof Error ? err.message : '封面上传失败') } finally { setUploading(false) }
  }

  return <section className="rounded-[24px] border border-sky-100 bg-sky-50/55 p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center">
    <div className="relative aspect-square w-36 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm">{url ? <Image src={url} alt="音乐封面" fill sizes="144px" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-brand-500">♪</div>}</div>
    <div className="min-w-0 flex-1"><h3 className="font-black text-brand-950">上传{entityType === 'album' ? '专辑' : '歌曲'}封面</h3><p className="mt-1 text-xs font-bold leading-5 text-slate-500">JPG、JPEG、PNG、WEBP，最大 10MB；自动压缩为质量 82 的 WebP，最大宽度 2000px。</p>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} className="mt-3 block w-full text-xs font-bold text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-2 file:font-black file:text-brand-700" />
      <button type="button" onClick={() => void upload()} disabled={!file || uploading} className="mt-3 rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{uploading ? '处理中...' : '转换并上传 WebP'}</button>
    </div>
  </div>{message ? <p className="mt-3 text-xs font-black text-emerald-700">{message}</p> : null}{error ? <p className="mt-3 text-xs font-black text-red-600">{error}</p> : null}</section>
}
