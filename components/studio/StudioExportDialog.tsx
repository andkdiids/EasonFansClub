'use client'

import type { StudioExportFormat } from '@/lib/studio/tools'
import styles from './studio.module.css'

const labels: Record<StudioExportFormat, { title: string; description: string }> = {
  PNG: { title: 'PNG 图纸', description: '适合保存、打印或分享图纸' },
  JPEG: { title: 'JPEG 图片', description: '导出为轻量图片文件' },
  PDF: { title: 'PDF 打印稿', description: 'A4 封面、材料清单与分板图纸' },
  SVG: { title: 'SVG 矢量图', description: '适合继续编辑的矢量文件' },
}

export function StudioExportDialog({ open, formats, onClose, onExport }: Readonly<{
  open: boolean
  formats: readonly StudioExportFormat[]
  onClose: () => void
  onExport: (format: StudioExportFormat) => void
}>) {
  if (!open) return null
  return (
    <div className={styles.exportDialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={styles.exportDialog} role="dialog" aria-modal="true" aria-labelledby="studio-export-title">
        <div className={styles.dialogHeader}>
          <div>
            <h2 id="studio-export-title">导出作品</h2>
            <p>按当前图纸显示选项生成文件，颜色会保持为所选色板。</p>
          </div>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="关闭导出弹窗">×</button>
        </div>
        <div className={styles.exportOptionGrid}>
          {formats.map((format) => {
            const label = labels[format]
            return <button key={format} type="button" className={styles.exportOption} onClick={() => onExport(format)}>
              <span className={styles.exportOptionIcon}>{format}</span>
              <span className={styles.exportOptionMeta}><strong>{label.title}</strong><span>{label.description}</span></span>
            </button>
          })}
        </div>
      </section>
    </div>
  )
}
