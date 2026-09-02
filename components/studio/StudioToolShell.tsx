'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import type { StudioExportFormat, StudioToolDefinition } from '@/lib/studio/tools'
import { UiIcon } from '@/components/UiIcon'
import { StudioExportDialog } from './StudioExportDialog'
import styles from './studio.module.css'

export type StudioSaveStatus = 'unsaved' | 'saving' | 'saved' | 'failed'

function saveStatusLabel(status: StudioSaveStatus) {
  if (status === 'saving') return '保存中'
  if (status === 'saved') return '已保存'
  if (status === 'failed') return '保存失败'
  return '未保存'
}

export function StudioToolShell({ tool, title, saveStatus, onSave, onShare, onExport, openExportOnMount = false, children }: Readonly<{
  tool: StudioToolDefinition
  title: string
  saveStatus: StudioSaveStatus
  onSave: () => void
  onShare: () => void
  onExport: (format: StudioExportFormat) => void
  openExportOnMount?: boolean
  children: ReactNode
}>) {
  const [exportOpen, setExportOpen] = useState(false)
  useEffect(() => {
    if (openExportOnMount) setExportOpen(true)
  }, [openExportOnMount])
  const status = saveStatusLabel(saveStatus)
  const openExport = () => setExportOpen(true)
  const exportFile = (format: StudioExportFormat) => {
    setExportOpen(false)
    onExport(format)
  }
  return (
    <div className={styles.toolShell}>
      <header className={styles.toolHeader}>
        <div className={styles.toolHeaderLeft}>
          <Link href="/studio" className={styles.toolBack}><span>←</span> 贝多芬与我</Link>
          <div className={styles.toolTitleBlock}>
            <span className={styles.toolEyebrow}>{tool.name}</span>
            <h1 className={styles.toolTitle}>{title}</h1>
          </div>
        </div>
        <div className={styles.toolHeaderActions}>
          <span className={styles.saveStatus}><i className={styles.saveDot} />{status}</span>
          {tool.supportsSave ? <button type="button" className={`${styles.actionButton} ${styles.actionButtonPrimary}`} onClick={onSave}><UiIcon name="check" />保存</button> : null}
          {tool.supportsExport ? <button type="button" className={styles.actionButton} onClick={openExport}>导出</button> : null}
          {tool.supportsShare ? <button type="button" className={styles.actionButton} onClick={onShare}>分享</button> : null}
        </div>
      </header>
      <div className={styles.toolBody}>{children}</div>
      <div className={styles.mobileActionBar}>
        {tool.supportsSave ? <button type="button" className={styles.actionButton} onClick={onSave}>保存</button> : null}
        {tool.supportsExport ? <button type="button" className={styles.actionButton} onClick={openExport}>导出</button> : null}
        {tool.supportsShare ? <button type="button" className={styles.actionButton} onClick={onShare}>分享</button> : null}
        {tool.supportsSave ? <button type="button" className={`${styles.actionButton} ${styles.actionButtonPrimary}`} onClick={onSave}>完成</button> : null}
      </div>
      <StudioExportDialog open={exportOpen} formats={tool.supportedExportFormats} onClose={() => setExportOpen(false)} onExport={exportFile} />
    </div>
  )
}
