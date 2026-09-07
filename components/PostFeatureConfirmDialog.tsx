'use client'

import { ConfirmDialog } from '@/components/ConfirmDialog'

export function PostFeatureConfirmDialog({
  open,
  nextIsFeatured,
  loading = false,
  error = '',
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean
  nextIsFeatured: boolean
  loading?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}>) {
  const isFeature = nextIsFeatured
  return (
    <ConfirmDialog
      open={open}
      title={isFeature ? '设为精华？' : '取消精华？'}
      description={isFeature
        ? '确认将这篇帖子设为精华吗？设为精华后将按照现有规则发放对应奖励。'
        : '确认取消这篇帖子的精华状态吗？'}
      confirmLabel={isFeature ? '确认设为精华' : '确认取消精华'}
      cancelLabel="取消"
      loading={loading}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
