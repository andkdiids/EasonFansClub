'use client'

import Image from 'next/image'
import { useState } from 'react'
import { MusicUploadStatus } from '@/app/admin/music/MusicUploadStatus'
import { compressMusicCoverInBrowser } from '@/app/admin/music/music-cover-client'
import {
  MUSIC_UPLOAD_TIMEOUT_MS,
  musicUploadError,
  musicUploadNetworkError,
  readMusicUploadResponse,
  type MusicUploadStage,
} from '@/app/admin/music/music-upload-client'
import {
  isSupportedMusicCoverFile,
  MUSIC_COVER_MAX_FILE_SIZE,
} from '@/lib/music-upload-constraints'

export function MusicCoverUploader({ entityType, entityId, currentUrl, onUploaded }: Readonly<{
  entityType: 'album' | 'song' | 'tour' | 'concert'
  entityId: string
  currentUrl?: string | null
  onUploaded?: (url: string) => void
}>) {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState(currentUrl || '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [stage, setStage] = useState<MusicUploadStage>('idle')

  function chooseFile(nextFile: File | null) {
    setMessage('')
    setError('')
    if (!nextFile) {
      setFile(null)
      setStage('idle')
      return
    }
    if (!isSupportedMusicCoverFile(nextFile)) {
      setFile(null)
      setStage('error')
      setError('仅支持 JPG、JPEG、PNG、WebP')
      return
    }
    if (nextFile.size === 0 || nextFile.size > MUSIC_COVER_MAX_FILE_SIZE) {
      setFile(null)
      setStage('error')
      setError(nextFile.size === 0 ? '图片文件不能为空' : '封面图片不能超过 10MB')
      return
    }
    setFile(nextFile)
    setStage('selected')
    setMessage(`已选择 ${nextFile.name}`)
  }

  async function upload() {
    if (!file || uploading) return
    setUploading(true)
    setStage('processing')
    setError('')
    setMessage('正在校验图片并准备上传…')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), MUSIC_UPLOAD_TIMEOUT_MS)
    let conversionTimer: number | undefined
    try {
      setStage('converting')
      setMessage('正在压缩图片并转换为 WebP…')
      const compressedFile = await compressMusicCoverInBrowser(file)
      if (compressedFile.size > MUSIC_COVER_MAX_FILE_SIZE) {
        throw new Error('图片过大，请选择较小图片或等待压缩完成')
      }
      const form = new FormData()
      form.set('file', compressedFile)
      form.set('entityType', entityType)
      form.set('entityId', entityId)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      setStage('uploading')
      setMessage('正在上传图片…')
      conversionTimer = window.setTimeout(() => {
        setStage('converting')
        setMessage('服务器正在转换并压缩 WebP…')
      }, 500)
      const response = await fetch('/api/admin/music/covers', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      if (response.status === 413) {
        throw new Error('图片过大，请选择较小图片或等待压缩完成')
      }
      const data = await readMusicUploadResponse(response)
      if (!response.ok) throw new Error(musicUploadError(response, data))
      if (data.success !== true || typeof data.url !== 'string') {
        throw new Error('服务器未返回有效的封面地址')
      }
      setUrl(data.url)
      setFile(null)
      setStage('complete')
      setMessage('封面已转换为 WebP 并保存')
      onUploaded?.(data.url)
    } catch (uploadError) {
      console.error('[music-cover.upload-client]', uploadError)
      setStage('error')
      setMessage('')
      setError(musicUploadNetworkError(uploadError))
    } finally {
      window.clearTimeout(timeout)
      if (conversionTimer) window.clearTimeout(conversionTimer)
      setUploading(false)
    }
  }

  const label = entityType === 'tour' || entityType === 'concert'
    ? '现场海报'
    : entityType === 'album' ? '专辑封面' : '歌曲封面'

  return (
    <section className="rounded-[24px] border border-sky-100 bg-sky-50/55 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative aspect-square w-36 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm">
          {url
            ? <Image src={url} alt="音乐封面" fill sizes="144px" className="object-cover" />
            : <div className="grid h-full place-items-center text-4xl text-brand-500">♫</div>}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-black text-brand-950">上传{label}</h3>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">JPG、JPEG、PNG、WebP，最大 10MB；自动压缩为质量 82 的 WebP，最大宽度 2000px。</p>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(event) => chooseFile(event.target.files?.[0] || null)}
            className="mt-3 block w-full text-xs font-bold text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-2 file:font-black file:text-brand-700"
          />
          <button
            type="button"
            onClick={() => void upload()}
            disabled={!file || uploading}
            className="mt-3 rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
          >
            {uploading ? '处理中…' : '转换并上传 WebP'}
          </button>
        </div>
      </div>
      <MusicUploadStatus stage={stage} conversionLabel="转换 WebP" />
      {message ? <p className="mt-3 text-xs font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-xs font-black text-red-600" role="alert">{error}</p> : null}
    </section>
  )
}
