'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { UiIcon } from '@/components/UiIcon'
import { confirmSessionForAction } from '@/lib/client-auth'
import { parseClinicIdentityMode } from '@/lib/clinic-config'
import { ShareButton } from '@/components/share/ShareButton'
import { canonicalShareUrl, type ShareCardData } from '@/lib/share-card'
import { appendAspirinClinicListRestoreParam, updateAspirinClinicListHistoryState } from '@/lib/clinic-scroll-state'
import type { ClinicPublicConsultation, ClinicPublicRecordDetail } from '@/lib/clinic-service'
import { ClinicIdentityBadge } from './ClinicIdentityBadge'
import { ClinicReportDialog } from './ClinicReportDialog'
import { ClinicTime } from './ClinicTime'

function updateConsultation(items: ClinicPublicConsultation[], id: string, update: (item: ClinicPublicConsultation) => ClinicPublicConsultation): ClinicPublicConsultation[] {
  return items.map((item) => item.id === id ? update(item) : { ...item, replies: updateConsultation(item.replies, id, update) })
}

function findConsultation(items: ClinicPublicConsultation[], id: string): ClinicPublicConsultation | null {
  for (const item of items) {
    if (item.id === id) return item
    const nested = findConsultation(item.replies, id)
    if (nested) return nested
  }
  return null
}

function findParentName(items: ClinicPublicConsultation[], id: string) {
  const item = findConsultation(items, id)
  return item?.author?.displayName || '这位医师'
}

export function ClinicDetailClient({ record: initialRecord, isAuthenticated, initialFocusId, returnHref }: Readonly<{ record: ClinicPublicRecordDetail; isAuthenticated: boolean; initialFocusId?: string | null; returnHref?: string | null }>) {
  const router = useRouter()
  const [record, setRecord] = useState(initialRecord)
  const [identityMode, setIdentityMode] = useState<'PUBLIC' | 'ANONYMOUS'>('PUBLIC')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [recordAspirinPending, setRecordAspirinPending] = useState(false)
  const [actionError, setActionError] = useState('')
  const [reportTarget, setReportTarget] = useState<{ recordId: string } | { consultationId: string } | null>(null)
  const focusId = useMemo(() => initialFocusId || '', [initialFocusId])
  const returnLinkHref = returnHref ? appendAspirinClinicListRestoreParam(returnHref) : '/clinic'

  useEffect(() => {
    // Do not let a custom list state copied by a router implementation leak into
    // the detail history entry or into a later fresh visit to /clinic.
    window.history.replaceState(updateAspirinClinicListHistoryState(window.history.state, null), '', window.location.href)
  }, [])

  function handleReturnToClinic(event: MouseEvent<HTMLAnchorElement>) {
    if (!returnHref || window.history.length <= 1 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    router.back()
  }

  async function requireLogin() {
    if (isAuthenticated) return true
    return confirmSessionForAction('clinic.detail.action', window.location.pathname)
  }

  async function toggleRecordAspirin() {
    if (!(await requireLogin()) || recordAspirinPending) return
    const active = record.viewerHasAspirin
    const previousRecord = record
    setRecordAspirinPending(true)
    setActionError('')
    setRecord((current) => ({ ...current, viewerHasAspirin: !active, aspirinCount: Math.max(0, current.aspirinCount + (active ? -1 : 1)) }))
    try {
      const response = await fetch(`/api/clinic/${record.id}/aspirin`, { method: active ? 'DELETE' : 'POST' })
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: { count?: number }; message?: string }
      if (!response.ok || !body?.ok) throw new Error(body?.message || '药效没有记录下来，请稍后再试。')
      if (typeof body.data?.count === 'number') setRecord((current) => ({ ...current, aspirinCount: body.data!.count! }))
    } catch (error) {
      setRecord(previousRecord)
      setActionError(error instanceof Error ? error.message : '药效没有记录下来，请稍后再试。')
    } finally {
      setRecordAspirinPending(false)
    }
  }

  async function submitConsultation() {
    if (!(await requireLogin()) || sending) return
    if (draft.trim().length < 2) {
      setActionError('会诊内容至少需要 2 个有效字符。')
      return
    }
    setSending(true)
    setActionError('')
    try {
      const response = await fetch(`/api/clinic/${record.id}/consultations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft, identityMode, parentId: replyTo }),
      })
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: { record?: ClinicPublicRecordDetail }; message?: string }
      if (!response.ok || !body?.ok || !body.data?.record || 'unavailable' in body.data.record) throw new Error(body?.message || '会诊提交失败，请稍后再试。')
      setRecord(body.data.record)
      setDraft('')
      setReplyTo(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '会诊提交失败，请稍后再试。')
    } finally {
      setSending(false)
    }
  }

  async function toggleConsultationAspirin(item: ClinicPublicConsultation) {
    if (!(await requireLogin())) return
    const active = item.viewerHasAspirin
    setRecord((current) => ({ ...current, consultations: updateConsultation(current.consultations, item.id, (value) => ({ ...value, viewerHasAspirin: !active, aspirinCount: Math.max(0, value.aspirinCount + (active ? -1 : 1)) })) }))
    try {
      const response = await fetch(`/api/clinic/consultations/${item.id}/aspirin`, { method: active ? 'DELETE' : 'POST' })
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: { count?: number }; message?: string }
      if (!response.ok || !body?.ok) throw new Error(body?.message || '药效没有记录下来，请稍后再试。')
      if (typeof body.data?.count === 'number') setRecord((current) => ({ ...current, consultations: updateConsultation(current.consultations, item.id, (value) => ({ ...value, aspirinCount: body.data!.count! })) }))
    } catch (error) {
      setRecord(initialRecord)
      setActionError(error instanceof Error ? error.message : '药效没有记录下来，请稍后再试。')
    }
  }

  async function toggleMouthpiece(item: ClinicPublicConsultation) {
    if (!(await requireLogin())) return
    const active = item.viewerHasMouthpiece
    setRecord((current) => ({ ...current, mouthpieceCount: Math.max(0, current.mouthpieceCount + (active ? -1 : 1)), consultations: updateConsultation(current.consultations, item.id, (value) => ({ ...value, viewerHasMouthpiece: !active, mouthpieceCount: Math.max(0, value.mouthpieceCount + (active ? -1 : 1)) })) }))
    try {
      const response = await fetch(`/api/clinic/consultations/${item.id}/mouthpiece`, { method: active ? 'DELETE' : 'POST' })
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: { count?: number; recordCount?: number }; message?: string }
      if (!response.ok || !body?.ok) throw new Error(body?.message || '嘴替标记没有记录下来，请稍后再试。')
      setRecord((current) => ({ ...current, mouthpieceCount: typeof body.data?.recordCount === 'number' ? body.data.recordCount : current.mouthpieceCount, consultations: updateConsultation(current.consultations, item.id, (value) => ({ ...value, mouthpieceCount: typeof body.data?.count === 'number' ? body.data.count : value.mouthpieceCount })) }))
    } catch (error) {
      setRecord(initialRecord)
      setActionError(error instanceof Error ? error.message : '嘴替标记没有记录下来，请稍后再试。')
    }
  }

  async function deleteRecord() {
    if (!(await requireLogin()) || !window.confirm('删除后，这份病历和下面的全部会诊将不再公开显示，无法恢复。\n\n确定要烧掉这份病历吗？')) return
    const response = await fetch(`/api/clinic/${record.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string }
      setActionError(body?.message || '病历删除失败，请稍后再试。')
      return
    }
    window.location.assign(`/clinic/${record.id}`)
  }

  async function deleteConsultation(item: ClinicPublicConsultation) {
    if (!(await requireLogin()) || !window.confirm('确定要删除这条会诊吗？有楼中楼回复时会保留删除占位。')) return
    const response = await fetch(`/api/clinic/consultations/${item.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string }
      setActionError(body?.message || '会诊删除失败，请稍后再试。')
      return
    }
    setRecord((current) => ({ ...current, consultationCount: Math.max(0, current.consultationCount - (item.isDeleted ? 0 : 1)), consultations: updateConsultation(current.consultations, item.id, (value) => ({ ...value, isDeleted: true, author: null, content: '这条会诊已被删除。', canDelete: false })) }))
  }

  async function openReply(item: ClinicPublicConsultation) {
    if (!(await requireLogin())) return
    setReplyTo(item.id)
    document.getElementById('clinic-consultation-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function openReport(target: { recordId: string } | { consultationId: string }) {
    if (await requireLogin()) setReportTarget(target)
  }

  const clinicShareCardData: ShareCardData = {
    type: 'clinic',
    title: `${record.categoryLabel} · ${record.needLabel}`,
    description: record.content,
    image: null,
    url: canonicalShareUrl(`/clinic/${record.id}`),
    author: record.author.displayName,
    authorAvatar: record.author.type === 'public' ? record.author.avatarUrl : null,
    date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(record.createdAt)),
    meta: [
      { label: '分类', value: record.categoryLabel },
      { label: '诉求', value: record.needLabel },
    ],
  }

  return (
    <main className="clinic-page-shell clinic-detail-page">
      <div className="clinic-detail-back"><Link href={returnLinkHref} onClick={handleReturnToClinic}>← 返回候诊大厅</Link></div>
      <article className="clinic-detail-record">
        <header className="clinic-detail-header"><div><span className="clinic-category-label">{record.categoryLabel}</span><span className="clinic-record-time"><ClinicTime value={record.createdAt} /></span></div><div className="clinic-detail-header-actions"><button type="button" className="clinic-more-button" aria-label="病历举报" onClick={() => { void openReport({ recordId: record.id }) }}>···</button>{record.canDelete ? <button type="button" className="clinic-danger-link" onClick={() => void deleteRecord()}>烧掉这份病历</button> : null}</div></header>
        <div className="clinic-detail-author"><ClinicIdentityBadge identity={record.author} /><span className="clinic-detail-separator">·</span><span>患者诉求：{record.needLabel}</span></div>
        <p className="clinic-detail-content">{record.content}</p>
        <footer className="clinic-detail-actions">
          <button type="button" className={`clinic-action-button ${record.viewerHasAspirin ? 'is-active' : ''}`} onClick={() => void toggleRecordAspirin()} disabled={recordAspirinPending} aria-label={record.viewerHasAspirin ? '取消阿士匹灵' : '给颗阿士匹灵'}><UiIcon name="pill" /><span>{record.viewerHasAspirin ? '已经给药' : '给颗阿士匹灵'}</span><b>{record.aspirinCount}</b></button>
          <button type="button" className="clinic-action-button" onClick={() => document.getElementById('clinic-consultation-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><UiIcon name="stethoscope" /><span>参与会诊</span><b>{record.consultationCount}</b></button>
          <ShareButton data={clinicShareCardData} linkTitle={clinicShareCardData.title} linkText={record.content} label="分享病历" triggerClassName="clinic-action-button" messageClassName="clinic-inline-message" />
        </footer>
      </article>

      <section id="consultations" className="clinic-consultations-section" aria-labelledby="clinic-consultations-title">
        <header className="clinic-section-heading"><div><h2 id="clinic-consultations-title">病友会诊</h2></div><span>{record.consultationCount} 次会诊</span></header>
        {record.bestMouthpiece ? <p className="clinic-best-mouthpiece clinic-detail-best"><span>本楼最佳嘴替</span>「{record.bestMouthpiece.content}」 · {record.bestMouthpiece.mouthpieceCount} 人认同</p> : null}
        {!record.consultations.length ? <p className="clinic-empty-consultation">暂时还没有病友会诊。</p> : <div className="clinic-consultation-list">{record.consultations.map((item) => <ClinicConsultationItem key={item.id} item={item} focusId={focusId} onAspirin={(id) => { const target = findConsultation(record.consultations, id); if (target) void toggleConsultationAspirin(target) }} onMouthpiece={(id) => { const target = findConsultation(record.consultations, id); if (target) void toggleMouthpiece(target) }} onReply={(id) => { const target = findConsultation(record.consultations, id); if (target) void openReply(target) }} onDelete={(id) => { const target = findConsultation(record.consultations, id); if (target) void deleteConsultation(target) }} onReport={(id) => { void openReport({ consultationId: id }) }} />)}</div>}
      </section>

      <section id="clinic-consultation-composer" className="clinic-composer-section">
        <div className="clinic-composer-heading"><div><h2>{replyTo ? `回复 @${findParentName(record.consultations, replyTo)}` : '各位医师点睇？'}</h2></div>{replyTo ? <button type="button" className="clinic-text-link" onClick={() => setReplyTo(null)}>取消回复</button> : null}</div>
        <div className="clinic-identity-switch" role="group" aria-label="会诊身份"><button type="button" className={identityMode === 'PUBLIC' ? 'is-active' : ''} onClick={() => setIdentityMode(parseClinicIdentityMode('PUBLIC'))}>用自己的身份</button><button type="button" className={identityMode === 'ANONYMOUS' ? 'is-active' : ''} onClick={() => setIdentityMode(parseClinicIdentityMode('ANONYMOUS'))}>匿名会诊</button></div>
        <textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} placeholder="跟患者说点什么……" aria-label="会诊内容" />
        <div className="clinic-composer-footer"><span>普通病友无法看到匿名医师的真实身份。</span><button type="button" className="clinic-primary-button" disabled={sending} onClick={() => void submitConsultation()}>{sending ? '提交中…' : '参与会诊'}</button></div>
      </section>

      {actionError ? <p className="clinic-inline-message" role="status">{actionError}</p> : null}
      <footer className="clinic-disclaimer">阿士匹灵门诊部是病友交流与情绪树洞，不提供专业医疗或心理诊断。如遇真实身体或心理健康问题，请及时寻求专业帮助。</footer>
      {reportTarget ? <ClinicReportDialog target={reportTarget} onClose={() => setReportTarget(null)} /> : null}
    </main>
  )
}

function ClinicConsultationItem({ item, focusId, onAspirin, onMouthpiece, onReply, onDelete, onReport }: Readonly<{ item: ClinicPublicConsultation; focusId: string; onAspirin: (id: string) => void; onMouthpiece: (id: string) => void; onReply: (id: string) => void; onDelete: (id: string) => void; onReport: (id: string) => void }>) {
  return (
    <article className={`clinic-consultation ${item.isDeleted ? 'is-deleted' : ''} ${focusId === item.id ? 'is-focused' : ''}`} id={`clinic-consultation-${item.id}`}>
      <header><div>{item.author ? <ClinicIdentityBadge identity={item.author} compact /> : <span className="clinic-deleted-author">已删除会诊</span>}<ClinicTime value={item.createdAt} /></div><div className="clinic-consultation-menu"><button type="button" className="clinic-more-button" aria-label="会诊更多操作" onClick={() => onReport(item.id)}>···</button>{item.canDelete ? <button type="button" className="clinic-danger-link" onClick={() => onDelete(item.id)}>删除</button> : null}</div></header>
      <p className="clinic-consultation-content">{item.content}</p>
      {!item.isDeleted ? <footer className="clinic-consultation-actions"><button type="button" className={`clinic-action-button ${item.viewerHasAspirin ? 'is-active' : ''}`} onClick={() => onAspirin(item.id)} aria-label={item.viewerHasAspirin ? '取消会诊阿士匹灵' : '给会诊一颗阿士匹灵'}><UiIcon name="pill" /><span>阿士匹灵</span><b>{item.aspirinCount}</b></button><button type="button" className={`clinic-action-button clinic-mouthpiece-button ${item.viewerHasMouthpiece ? 'is-active' : ''}`} onClick={() => onMouthpiece(item.id)} aria-label={item.viewerHasMouthpiece ? '取消嘴替' : '你是我的嘴替'}>🗣️ <span>{item.viewerHasMouthpiece ? '已标记嘴替' : '你是我的嘴替'}</span><b>{item.mouthpieceCount}</b></button>{!item.parentId ? <button type="button" className="clinic-action-button" onClick={() => onReply(item.id)}>回复</button> : null}</footer> : null}
      {item.replies.length ? <div className="clinic-replies">{item.replies.map((reply) => <ClinicConsultationItem key={reply.id} item={reply} focusId={focusId} onAspirin={onAspirin} onMouthpiece={onMouthpiece} onReply={onReply} onDelete={onDelete} onReport={onReport} />)}</div> : null}
    </article>
  )
}
