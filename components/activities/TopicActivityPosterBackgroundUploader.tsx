'use client'

import { useEffect, useRef, useState } from 'react'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection, type ActivityImageUploadStatus } from '@/components/activities/ActivityImageUploader'
import { topicActivityPosterBackgroundPath } from '@/lib/topic-activity-poster-background'
import type { TopicActivityV2Test } from '@/lib/topic-activity-v2-config'

export function topicActivityEditorImagesMatch(expected: TopicActivityV2Test, actual: TopicActivityV2Test) {
  return (expected.poster.backgroundUrl || null) === (actual.poster.backgroundUrl || null)
    && expected.results.length === actual.results.length
    && expected.results.every((result) => {
      const found = actual.results.find((item) => item.id === result.id)
      return Boolean(found) && (result.imageUrl || null) === (found?.imageUrl || null)
    })
}

export async function uploadTopicActivityPosterBackground(file: File) {
  const path = topicActivityPosterBackgroundPath(await uploadActivityImage(file))
  if (!path) throw new Error('图片上传结果路径无效')
  return path
}

export function TopicActivityPosterBackgroundUploader({ value, disabled = false, onChange, onUploadingChange }: Readonly<{
  value: string | null
  disabled?: boolean
  onChange: (url: string | null) => void
  onUploadingChange?: (uploading: boolean) => void
}>) {
  const requestId = useRef(0)
  const uploading = useRef(false)
  const callbacks = useRef({ onChange, onUploadingChange })
  callbacks.current = { onChange, onUploadingChange }
  const [status, setStatus] = useState<ActivityImageUploadStatus>('idle')
  const [error, setError] = useState('')
  const [resetSignal, setResetSignal] = useState(0)
  useEffect(() => () => {
    requestId.current++
    if (uploading.current) callbacks.current.onUploadingChange?.(false)
    uploading.current = false
  }, [])

  function select(selection: ActivityImageSelection) {
    if (disabled || uploading.current) return
    const currentId = ++requestId.current
    setError('')
    if (selection.removed) {
      callbacks.current.onChange(null)
      setStatus('success')
      return
    }
    if (!selection.file) return
    uploading.current = true
    setStatus('uploading')
    callbacks.current.onUploadingChange?.(true)
    void uploadTopicActivityPosterBackground(selection.file).then((path) => {
      if (currentId !== requestId.current) return
      callbacks.current.onChange(path)
      setStatus('success')
    }).catch((cause) => {
      if (currentId !== requestId.current) return
      const detail = cause instanceof Error ? cause.message : '图片上传失败'
      setError(`${detail}，未替换当前统一海报背景`)
      setStatus('error')
      setResetSignal((value) => value + 1)
    }).finally(() => {
      if (currentId === requestId.current) {
        uploading.current = false
        callbacks.current.onUploadingChange?.(false)
      }
    })
  }

  return <div className="space-y-2">
    <ActivityImageUploader
      label="统一结果海报背景"
      initialUrl={value}
      resetSignal={resetSignal}
      disabled={disabled || status === 'uploading'}
      status={status}
      uploadLabel="上传背景图"
      replaceLabel="替换背景"
      removeLabel="移除背景"
      previewClassName="h-64 w-36 max-w-full object-contain rounded-sm"
      errorMessage={error}
      onSelectionChange={select}
    />
    <p className="text-xs text-[var(--foreground-muted)]">建议尺寸：1080 × 1440，比例 3:4。此背景将用于该测试的所有结果海报；非 3:4 图片会按比例铺满并居中裁切。未上传时兼容旧结果图片或默认背景。上传后保存才会写入活动配置；替换失败会保留原图。</p>
  </div>
}
