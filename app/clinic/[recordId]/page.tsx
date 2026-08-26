import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { ClinicDetailClient } from '@/components/clinic/ClinicDetailClient'
import { getPublicClinicRecordDetail } from '@/lib/clinic-service'
import { emitRealtime } from '@/lib/realtime'
import { markPersonalNotificationsForTargetRead } from '@/lib/notifications'
import { appendAspirinClinicListRestoreParam } from '@/lib/clinic-scroll-state'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClinicRecordPage({ params, searchParams }: { params: Promise<{ recordId: string }>; searchParams: Promise<{ focus?: string; from?: string }> }) {
  const [{ recordId }, query] = await Promise.all([params, searchParams])
  // Do not turn an auth database outage into an anonymous viewer.
  const user = await getCurrentUser()
  const record = await getPublicClinicRecordDetail(recordId, user?.id || null)
  if (!record) notFound()
  if (user) {
    const marked = await markPersonalNotificationsForTargetRead({ userId: user.id, linkPrefix: `/clinic/${recordId}`, types: ['REPLY'] })
    if (marked > 0) emitRealtime(user.id, 'notification')
  }
  // 列表进入详情时携带的原列表地址（含页码/筛选/排序），用于精准返回。
  const returnHref = query.from || null
  const returnLinkHref = returnHref ? appendAspirinClinicListRestoreParam(returnHref) : '/clinic'
  if ('unavailable' in record) {
    return <main className="clinic-page-shell clinic-unavailable-page"><div className="clinic-detail-back"><Link href={returnLinkHref}>← 返回门诊部</Link></div><section className="clinic-empty-state"><h1>{record.status === 'DELETED' ? '这份病历已经被患者烧掉了。' : '这份病历暂时无法公开。'}</h1><p>门诊记录的正文不会在这里继续显示。</p><Link href={returnLinkHref} className="clinic-secondary-button">回到候诊大厅</Link></section></main>
  }
  return <ClinicDetailClient record={record} isAuthenticated={Boolean(user)} initialFocusId={query.focus || null} returnHref={returnHref} />
}
