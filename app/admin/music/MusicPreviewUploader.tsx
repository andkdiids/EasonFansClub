'use client'

import { useState } from 'react'

const MAX_AUDIO_SIZE = 100 * 1024 * 1024
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/aac'])

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

  function chooseFile(nextFile: File | null) {
    setMessage('')
    setError('')
    if (!nextFile) return setFile(null)
    if (!AUDIO_TYPES.has(nextFile.type)) {
      setFile(null)
      setError('仅支持 MP3、M4A、WAV、AAC')
      return
    }
    if (nextFile.size > MAX_AUDIO_SIZE) {
      setFile(null)
      setError('音频文件不能超过 100MB')
      return
    }
    setFile(nextFile)
  }

  async function upload() {
    if (!file || uploading) return
    setUploading(true)
    setMessage('正在上传并生成 7 秒试听片段，请勿关闭页面…')
    setError('')
    const formData = new FormData()
    formData.set('file', file)
    try {
      const response = await fetch(`/api/admin/music/songs/${songId}/preview`, { method: 'POST', body: formData })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const fallback = response.status === 413
          ? '音频文件超过服务器上传限制'
          : response.status === 401 || response.status === 403
            ? '登录状态或管理员权限已失效'
            : '试听片段上传失败，请稍后重试'
        throw new Error(data?.message || fallback)
      }
      setPreviewUrl(data.previewUrl)
      setFile(null)
      setMessage('7 秒试听片段已生成并保存，完整音频未上传')
      onUploaded?.(data.previewUrl, data.previewDuration)
    } catch (uploadError) {
      setMessage('')
      setError(uploadError instanceof TypeError
        ? '网络连接中断，请检查网络后重试'
        : uploadError instanceof Error ? uploadError.message : '试听片段上传失败，请稍后重试')
    } finally {
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
          onChange={(event) => chooseFile(event.target.files?.[0] || null)}
          className="min-w-0 max-w-full text-xs"
        />
        <button
          type="button"
          disabled={!file || uploading}
          onClick={() => void upload()}
          className="rounded-full bg-brand-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
        >
          {uploading ? '生成中…' : '生成 7 秒试听'}
        </button>
        {previewUrl ? <audio controls preload="none" src={previewUrl} className="h-9 max-w-full" aria-label={`${currentDuration || 7} 秒试听片段`} /> : null}
      </div>
      <p className="mt-2 text-[11px] font-bold text-slate-500">支持 MP3 / M4A / WAV / AAC，最大 100MB；服务器仅保存转码后的 7 秒 MP3。</p>
      {message ? <p className="mt-2 text-xs font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-xs font-black text-red-600">{error}</p> : null}
    </div>
  )
}
