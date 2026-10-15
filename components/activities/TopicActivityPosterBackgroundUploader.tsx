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

export async function uploadTopicActivityEditorImage(file: File) {
  const path = topicActivityPosterBackgroundPath(await uploadActivityImage(file))
  if (!path) throw new Error('图片上传结果路径无效')
  return path
}

export function TopicActivityEditorImageUploader({ value, disabled = false, kind = 'result', onChange, onUploadingChange }: Readonly<{
  value: string | null
  disabled?: boolean
  kind?: 'result' | 'background'
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
  const background = kind === 'background'
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
    void uploadTopicActivityEditorImage(selection.file).then((path) => {
      if (currentId !== requestId.current) return
      callbacks.current.onChange(path)
      setStatus('success')
    }).catch((cause) => {
      if (currentId !== requestId.current) return
      const detail = cause instanceof Error ? cause.message : '图片上传失败'
      setError(`${detail}，未替换当前${background ? '背景图' : '结果图片'}`)
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
      label={background ? '结果海报背景图' : '结果图片'}
      initialUrl={value}
      resetSignal={resetSignal}
      disabled={disabled || status === 'uploading'}
      status={status}
      uploadLabel={background ? '上传背景图' : '上传图片'}
      replaceLabel={background ? '替换背景' : '替换图片'}
      removeLabel={background ? '移除背景' : '移除图片'}
      previewClassName={background ? 'h-64 w-36 max-w-full object-cover rounded-sm' : 'max-h-64 w-full object-contain rounded-sm'}
      errorMessage={error}
      onSelectionChange={select}
    />
    <p className="text-xs text-[var(--foreground-muted)]">{background ? '建议使用 1080 × 1920 竖图；未上传时使用默认背景。' : '可选；未上传时不会预留图片空位。'}上传后点击保存才会写入活动配置；替换失败会保留原图。</p>
  </div>
}

export function TopicActivityPosterBackgroundUploader(props: Omit<Parameters<typeof TopicActivityEditorImageUploader>[0], 'kind'>) {
  return <TopicActivityEditorImageUploader {...props} kind="background" />
}
