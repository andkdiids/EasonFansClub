'use client'

import { useRef, useState } from 'react'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection, type ActivityImageUploadStatus } from '@/components/activities/ActivityImageUploader'
import { topicActivityPosterBackgroundPath } from '@/lib/topic-activity-poster-background'

export function TopicActivityPosterBackgroundUploader({ value, disabled = false, onChange, onUploadingChange }: Readonly<{
  value: string | null
  disabled?: boolean
  onChange: (url: string | null) => void
  onUploadingChange?: (uploading: boolean) => void
}>) {
  const requestId = useRef(0)
  const [status, setStatus] = useState<ActivityImageUploadStatus>('idle')
  const [error, setError] = useState('')
  const [resetSignal, setResetSignal] = useState(0)

  function select(selection: ActivityImageSelection) {
    const currentId = ++requestId.current
    setError('')
    if (selection.removed) {
      onChange(null)
      setStatus('success')
      onUploadingChange?.(false)
      return
    }
    if (!selection.file) return
    setStatus('uploading')
    onUploadingChange?.(true)
    void uploadActivityImage(selection.file).then((url) => {
      if (currentId !== requestId.current) return
      const path = topicActivityPosterBackgroundPath(url)
      if (!path) throw new Error('图片上传结果路径无效')
      onChange(path)
      setStatus('success')
    }).catch((cause) => {
      if (currentId !== requestId.current) return
      const detail = cause instanceof Error ? cause.message : '图片上传失败'
      setError(`${detail}，未替换当前背景图`)
      setStatus('error')
      setResetSignal((value) => value + 1)
    }).finally(() => {
      if (currentId === requestId.current) onUploadingChange?.(false)
    })
  }

  return <div className="space-y-2">
    <ActivityImageUploader
      label="结果海报背景图"
      initialUrl={value}
      resetSignal={resetSignal}
      disabled={disabled || status === 'uploading'}
      status={status}
      replaceLabel="替换背景"
      removeLabel="移除背景"
      errorMessage={error}
      onSelectionChange={select}
    />
    <p className="text-xs text-[var(--foreground-muted)]">建议使用 1080 × 1920 竖图。未上传时也会生成完整海报；替换上传失败不会清除当前背景。</p>
  </div>
}
