import Link from 'next/link'
import { UiIcon } from '@/components/UiIcon'
import type { ClinicPublicRecord } from '@/lib/clinic-service'
import { ClinicIdentityBadge } from './ClinicIdentityBadge'
import { ClinicTime } from './ClinicTime'

export function ClinicRecordCard({
  record,
  isAuthenticated,
  isAspirinPending,
  returnHref,
  onOpenDetail,
  onAspirin,
  onReport,
}: Readonly<{
  record: ClinicPublicRecord
  isAuthenticated: boolean
  isAspirinPending: boolean
  returnHref?: string
  onOpenDetail: (recordId: string) => void
  onAspirin: (record: ClinicPublicRecord) => void
  onReport: (target: { recordId: string }) => void
}>) {
  // 携带返回地址，详情页据此精准回到原列表状态（页码/筛选/排序）。
  const detailHref = returnHref ? `/clinic/${record.id}?from=${encodeURIComponent(returnHref)}` : `/clinic/${record.id}`
  const consultationHref = `${detailHref}#consultations`
  return (
    <article className="clinic-record-card" data-clinic-record-card data-post-id={record.id}>
      <header className="clinic-record-card-header">
        <ClinicIdentityBadge identity={record.author} />
        <span className="clinic-record-time"><ClinicTime value={record.createdAt} /></span>
        <button type="button" className="clinic-more-button" aria-label="病历更多操作" onClick={() => onReport({ recordId: record.id })}>···</button>
      </header>
      <Link href={detailHref} className="clinic-record-card-main" onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onOpenDetail(record.id) }}>
        <div className="clinic-record-meta"><span className="clinic-category-label">{record.categoryLabel}</span><span>患者诉求：{record.needLabel}</span></div>
        <p className="clinic-record-content">{record.content}</p>
      </Link>
      <footer className="clinic-record-card-footer">
        <button
          type="button"
          className={`clinic-action-button clinic-aspirin-button ${record.viewerHasAspirin ? 'is-active' : ''}`}
          aria-label={record.viewerHasAspirin ? '取消阿士匹灵' : '给颗阿士匹灵'}
          disabled={isAspirinPending}
          onClick={() => onAspirin(record)}
        >
          <UiIcon name="pill" />
          <span>{record.viewerHasAspirin ? '已经给药' : '给颗阿士匹灵'}</span>
          <b>{record.aspirinCount}</b>
        </button>
        <Link href={consultationHref} className="clinic-action-button" onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onOpenDetail(record.id) }}>
          <UiIcon name="stethoscope" />
          <span>会诊</span>
          <b>{record.consultationCount}</b>
        </Link>
      </footer>
      {record.bestMouthpiece ? <p className="clinic-best-mouthpiece"><span>本楼最佳嘴替</span>「{record.bestMouthpiece.content}」</p> : null}
      {!isAuthenticated ? <span className="sr-only">登录后可以参与互动</span> : null}
    </article>
  )
}
