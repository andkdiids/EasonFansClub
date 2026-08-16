'use client'

import { useCallback, useEffect, useState } from 'react'

type AdminTab = 'records' | 'reports' | 'consultations'
type ContentStatus = 'ACTIVE' | 'HIDDEN' | 'DELETED' | 'REMOVED'
type ReportStatus = 'PENDING' | 'RESOLVED' | 'REJECTED'

type AdminUser = { id?: string; uid: string; username: string; nickname: string | null }
type AdminRecord = {
  id: string
  content: string
  category: string
  categoryLabel: string
  needType: string
  needLabel: string
  identityMode: 'PUBLIC' | 'ANONYMOUS'
  anonymousNumber: number
  publicDisplayName: string
  status: ContentStatus
  aspirinCount: number
  consultationCount: number
  mouthpieceCount: number
  createdAt: string
  author: AdminUser
  reportCount: number
}
type AdminConsultation = {
  id: string
  recordId: string
  parentId: string | null
  content: string
  identityMode: 'PUBLIC' | 'ANONYMOUS'
  anonymousNumber: number
  publicDisplayName: string
  status: ContentStatus
  aspirinCount: number
  mouthpieceCount: number
  createdAt: string
  author: AdminUser
  record: { category: string; status: ContentStatus; author: AdminUser }
}
type AdminReport = {
  id: string
  reason: string
  detail: string | null
  status: ReportStatus
  createdAt: string
  handledAt: string | null
  reporter: AdminUser
  record: (Pick<AdminRecord, 'id' | 'content' | 'status' | 'identityMode' | 'anonymousNumber' | 'author'>) | null
  consultation: (Pick<AdminConsultation, 'id' | 'recordId' | 'content' | 'status' | 'identityMode' | 'anonymousNumber' | 'author'>) | null
  handledBy: AdminUser | null
}
type AdminPayload = {
  tab: AdminTab
  page: number
  pageSize: number
  total: number
  totalPages: number
  items: AdminRecord[] | AdminConsultation[] | AdminReport[]
}

const tabs: readonly { id: AdminTab; label: string }[] = [
  { id: 'records', label: '全部病历' },
  { id: 'reports', label: '举报处理' },
  { id: 'consultations', label: '会诊管理' },
]

function userLabel(user: AdminUser | null | undefined) {
  if (!user) return '未知用户'
  return user.nickname || user.username || user.uid
}

function actualUser(user: AdminUser | null | undefined) {
  if (!user) return '未知用户'
  return `${userLabel(user)}（UID ${user.uid}）`
}

function publicLabel(identityMode: 'PUBLIC' | 'ANONYMOUS', publicDisplayName: string, user: AdminUser) {
  return identityMode === 'ANONYMOUS' ? publicDisplayName : userLabel(user)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function ClinicAdminPanel() {
  const [tab, setTab] = useState<AdminTab>('records')
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState<AdminPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/clinic?tab=${tab}&page=${page}`, { cache: 'no-store' })
      const body = await response.json().catch(() => null) as { message?: string } & Partial<AdminPayload>
      if (!response.ok || !body || !Array.isArray(body.items)) throw new Error(body?.message || '门诊管理数据加载失败。')
      setPayload(body as AdminPayload)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '门诊管理数据加载失败。')
    } finally {
      setLoading(false)
    }
  }, [page, tab])

  useEffect(() => { void load() }, [load])

  function switchTab(nextTab: AdminTab) {
    setTab(nextTab)
    setPage(1)
  }

  async function updateContent(target: 'record' | 'consultation', id: string, status: ContentStatus) {
    const actionText = status === 'ACTIVE' ? '恢复' : status === 'HIDDEN' ? '隐藏' : status === 'REMOVED' ? '移除' : '删除'
    if (!window.confirm(`确定要${actionText}这条门诊内容吗？`)) return
    setBusyId(id)
    try {
      const response = await fetch('/api/admin/clinic', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, id, status }),
      })
      const body = await response.json().catch(() => null) as { message?: string }
      if (!response.ok) throw new Error(body?.message || '门诊内容处理失败。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '门诊内容处理失败。')
    } finally {
      setBusyId('')
    }
  }

  async function updateReport(id: string, status: ReportStatus) {
    setBusyId(id)
    try {
      const response = await fetch('/api/admin/clinic', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'report', reportId: id, status }),
      })
      const body = await response.json().catch(() => null) as { message?: string }
      if (!response.ok) throw new Error(body?.message || '举报处理失败。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '举报处理失败。')
    } finally {
      setBusyId('')
    }
  }

  const items = payload?.items || []

  return (
    <section className="clinic-admin-panel">
      <div className="clinic-admin-toolbar">
        <div>
          <p className="clinic-kicker">MODERATION</p>
          <p style={{ margin: '7px 0 0', color: 'var(--foreground-muted)', fontSize: 11 }}>匿名原始身份仅向拥有 clinic_manage 权限的管理员返回。</p>
        </div>
        <nav className="clinic-admin-tabs" aria-label="门诊后台分类">
          {tabs.map((item) => <button key={item.id} className={tab === item.id ? 'is-active' : ''} type="button" onClick={() => switchTab(item.id)}>{item.label}</button>)}
        </nav>
      </div>

      {error ? <p className="clinic-error" role="alert">{error}</p> : null}
      {loading ? <p className="clinic-loading">正在读取门诊管理数据……</p> : null}
      {!loading && !items.length ? <p className="clinic-empty">当前分类还没有记录。</p> : null}

      {!loading && tab === 'records' ? (
        <div className="clinic-admin-table">
          <table>
            <thead><tr><th>ID / 时间</th><th>前台身份</th><th>实际用户</th><th>分类 / 诉求</th><th>原文</th><th>计数</th><th>状态</th><th>处理</th></tr></thead>
            <tbody>{(items as AdminRecord[]).map((item) => <tr key={item.id}>
              <td>{item.id}<small>{formatDate(item.createdAt)}</small></td>
              <td>{publicLabel(item.identityMode, item.publicDisplayName, item.author)}<small>{item.identityMode === 'ANONYMOUS' ? '匿名展示' : '公开展示'}</small></td>
              <td>{actualUser(item.author)}</td>
              <td>{item.categoryLabel}<small>{item.needLabel}</small></td>
              <td><pre>{item.content}</pre></td>
              <td>{item.consultationCount} 会诊<br />{item.aspirinCount} 药丸<br />{item.reportCount} 举报</td>
              <td className="clinic-status">{item.status}</td>
              <td><div className="clinic-admin-actions">
                {item.status !== 'ACTIVE' ? <button type="button" disabled={busyId === item.id} onClick={() => void updateContent('record', item.id, 'ACTIVE')}>恢复</button> : null}
                {item.status === 'ACTIVE' ? <button type="button" disabled={busyId === item.id} onClick={() => void updateContent('record', item.id, 'HIDDEN')}>隐藏</button> : null}
                {item.status !== 'REMOVED' ? <button type="button" disabled={busyId === item.id} onClick={() => void updateContent('record', item.id, 'REMOVED')}>移除</button> : null}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
      ) : null}

      {!loading && tab === 'consultations' ? (
        <div className="clinic-admin-table">
          <table>
            <thead><tr><th>ID / 时间</th><th>前台身份</th><th>实际用户</th><th>病历</th><th>原文</th><th>计数</th><th>状态</th><th>处理</th></tr></thead>
            <tbody>{(items as AdminConsultation[]).map((item) => <tr key={item.id}>
              <td>{item.id}<small>{formatDate(item.createdAt)}</small></td>
              <td>{publicLabel(item.identityMode, item.publicDisplayName, item.author)}<small>{item.identityMode === 'ANONYMOUS' ? '匿名医师' : '实名医师'}</small></td>
              <td>{actualUser(item.author)}</td>
              <td>{item.recordId}<small>{item.record.status}</small></td>
              <td><pre>{item.content}</pre></td>
              <td>{item.aspirinCount} 药丸<br />{item.mouthpieceCount} 嘴替</td>
              <td className="clinic-status">{item.status}</td>
              <td><div className="clinic-admin-actions">
                {item.status !== 'ACTIVE' ? <button type="button" disabled={busyId === item.id} onClick={() => void updateContent('consultation', item.id, 'ACTIVE')}>恢复</button> : null}
                {item.status === 'ACTIVE' ? <button type="button" disabled={busyId === item.id} onClick={() => void updateContent('consultation', item.id, 'HIDDEN')}>隐藏</button> : null}
                {item.status !== 'REMOVED' ? <button type="button" disabled={busyId === item.id} onClick={() => void updateContent('consultation', item.id, 'REMOVED')}>移除</button> : null}
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>
      ) : null}

      {!loading && tab === 'reports' ? (
        <div className="clinic-admin-table">
          <table>
            <thead><tr><th>时间 / 举报人</th><th>举报原因</th><th>目标内容</th><th>实际作者</th><th>状态</th><th>处理</th></tr></thead>
            <tbody>{(items as AdminReport[]).map((item) => {
              const target = item.record || item.consultation
              const targetAuthor = target?.author
              return <tr key={item.id}>
                <td>{formatDate(item.createdAt)}<small>{actualUser(item.reporter)}</small></td>
                <td>{item.reason}<small>{item.detail || '无补充说明'}</small></td>
                <td><pre>{target?.content || '目标内容已不存在'}</pre><small>{target?.identityMode === 'ANONYMOUS' ? '前台：匿名身份' : '前台：公开身份'}</small></td>
                <td>{actualUser(targetAuthor)}</td>
                <td className="clinic-status">{item.status}</td>
                <td><div className="clinic-admin-actions">
                  {item.status === 'PENDING' ? <><button type="button" disabled={busyId === item.id} onClick={() => void updateReport(item.id, 'RESOLVED')}>已处理</button><button type="button" disabled={busyId === item.id} onClick={() => void updateReport(item.id, 'REJECTED')}>驳回</button></> : null}
                </div></td>
              </tr>
            })}</tbody>
          </table>
        </div>
      ) : null}

      {payload && payload.totalPages > 1 ? <div className="clinic-pagination">
        <button className="clinic-secondary-button" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
        <span className="is-current">第 {payload.page} / {payload.totalPages} 页</span>
        <button className="clinic-secondary-button" type="button" disabled={page >= payload.totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
      </div> : null}
    </section>
  )
}
