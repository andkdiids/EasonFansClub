import Link from 'next/link'
import { UiIcon } from '@/components/UiIcon'
import type { ClinicPublicRecord } from '@/lib/clinic-service'
import { ClinicIdentityBadge } from './ClinicIdentityBadge'
import { ClinicTime } from './ClinicTime'

export function ClinicRecordCard({
  record,
  isAuthenticated,
  isAspirinPending,
  onAspirin,
  onReport,
}: Readonly<{
  record: ClinicPublicRecord
  isAuthenticated: boolean
  isAspirinPending: boolean
  onAspirin: (record: ClinicPublicRecord) => void
  onReport: (target: { recordId: string }) => void
}>) {
  return (
    <article className="clinic-record-card" data-clinic-record-card>
      <header className="clinic-record-card-header">
        <ClinicIdentityBadge identity={record.author} />
        <span className="clinic-record-time"><ClinicTime value={record.createdAt} /></span>
        <button type="button" className="clinic-more-button" aria-label="病历更多操作" onClick={() => onReport({ recordId: record.id })}>···</button>
      </header>
      <Link href={`/clinic/${record.id}`} className="clinic-record-card-main">
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
        <Link href={`/clinic/${record.id}#consultations`} className="clinic-action-button">
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
