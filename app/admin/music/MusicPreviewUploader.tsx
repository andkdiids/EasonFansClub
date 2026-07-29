'use client'

import { useState } from 'react'
import { MusicUploadStatus } from '@/app/admin/music/MusicUploadStatus'
import {
  MUSIC_UPLOAD_TIMEOUT_MS,
  musicUploadError,
  musicUploadNetworkError,
  readMusicUploadResponse,
  type MusicUploadStage,
} from '@/app/admin/music/music-upload-client'
import {
  isSupportedMusicAudioFile,
  MUSIC_AUDIO_MAX_FILE_SIZE,
} from '@/lib/music-upload-constraints'

export function MusicPreviewUploader({
  songId,
  currentUrl,
  currentDuration = 7,
  onUploaded,
}: Readonly<{
  songId: string
  currentUrl?: string | null
  currentDuration?: number | null
  onUploaded?: (previewUrl: string, previewDuration: number) => void
}>) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState(currentUrl || '')
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
    if (!isSupportedMusicAudioFile(nextFile)) {
      setFile(null)
      setStage('error')
      setError('仅支持 MP3、M4A、WAV、AAC')
      return
    }
    if (nextFile.size === 0 || nextFile.size > MUSIC_AUDIO_MAX_FILE_SIZE) {
      setFile(null)
      setStage('error')
      setError(nextFile.size === 0 ? '音频文件不能为空' : '音频文件不能超过 100MB')
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
    setMessage('正在校验音频并准备上传…')
    setError('')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), MUSIC_UPLOAD_TIMEOUT_MS)
    let conversionTimer: number | undefined
    const formData = new FormData()
    formData.set('file', file)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      setStage('uploading')
      setMessage('正在上传音频…')
      conversionTimer = window.setTimeout(() => {
        setStage('converting')
        setMessage('服务器正在生成 7 秒试听片段…')
      }, 800)
      const response = await fetch(`/api/admin/music/songs/${songId}/preview`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      const data = await readMusicUploadResponse(response)
      if (!response.ok) throw new Error(musicUploadError(response, data))
      if (data.success !== true || typeof data.previewUrl !== 'string' || typeof data.previewDuration !== 'number') {
        throw new Error('服务器未返回有效的试听片段信息')
      }
      setPreviewUrl(data.previewUrl)
      setFile(null)
      setStage('complete')
      setMessage('7 秒试听片段已生成并保存，完整音频未上传')
      onUploaded?.(data.previewUrl, data.previewDuration)
    } catch (uploadError) {
      console.error('[music-preview.upload-client]', uploadError)
      setStage('error')
      setMessage('')
      setError(musicUploadNetworkError(uploadError))
    } finally {
      window.clearTimeout(timeout)
      if (conversionTimer) window.clearTimeout(conversionTimer)
      setUploading(false)
    }
  }

  return (
    <div className="w-full border-t border-sky-100 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-black text-brand-950" htmlFor={`music-preview-${songId}`}>试听音频</label>
        <input
          id={`music-preview-${songId}`}
          type="file"
          accept=".mp3,.m4a,.wav,.aac,audio/mpeg,audio/mp4,audio/wav,audio/aac"
          disabled={uploading}
          onChange={(event) => chooseFile(event.target.files?.[0] || null)}
          className="min-w-0 max-w-full text-xs"
        />
        <button
          type="button"
          disabled={!file || uploading}
          onClick={() => void upload()}
          className="rounded-full bg-brand-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
        >
          {uploading ? '处理中…' : '生成 7 秒试听'}
        </button>
        {previewUrl ? (
          <audio controls preload="none" src={previewUrl} className="h-9 max-w-full" aria-label={`${currentDuration || 7} 秒试听片段`} />
        ) : null}
      </div>
      <p className="mt-2 text-[11px] font-bold text-slate-500">支持 MP3 / M4A / WAV / AAC，最大 100MB；服务器仅保存转码后的 7 秒 MP3。</p>
      <MusicUploadStatus stage={stage} conversionLabel="生成 7 秒试听" />
      {message ? <p className="mt-2 text-xs font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-xs font-black text-red-600" role="alert">{error}</p> : null}
    </div>
  )
}
