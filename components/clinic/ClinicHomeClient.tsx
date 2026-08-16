'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pagination } from '@/components/ui/Pagination'
import { UiIcon } from '@/components/UiIcon'
import { clinicCategoryOptions, type ClinicSort } from '@/lib/clinic-config'
import type { ClinicCategory } from '@prisma/client'
import type { ClinicPublicRecord } from '@/lib/clinic-service'
import { ClinicRecordCard } from './ClinicRecordCard'
import { ClinicReportDialog } from './ClinicReportDialog'

type ClinicListData = {
  items: ClinicPublicRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function ClinicHomeClient({
  initialData,
  initialCategory,
  initialSort,
  isAuthenticated,
}: Readonly<{
  initialData: ClinicListData
  initialCategory?: ClinicCategory
  initialSort: ClinicSort
  isAuthenticated: boolean
}>) {
  const router = useRouter()
  const [data, setData] = useState(initialData)
  const [category, setCategory] = useState<ClinicCategory | undefined>(initialCategory)
  const [sort, setSort] = useState<ClinicSort>(initialSort)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reportTarget, setReportTarget] = useState<{ recordId: string } | null>(null)
  const skipFirstReload = useRef(true)

  async function load(page = 1, nextCategory = category, nextSort = sort) {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), sort: nextSort })
    if (nextCategory) params.set('category', nextCategory)
    try {
      const response = await fetch(`/api/clinic/records?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: ClinicListData; message?: string }
      if (!response.ok || !body?.ok || !body.data) throw new Error(body?.message || '门诊系统暂时有点忙，请稍后再试。')
      setData(body.data)
    } catch (requestError) {
      if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) setError(requestError instanceof Error ? requestError.message : '门诊系统暂时有点忙，请稍后再试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (skipFirstReload.current) {
      skipFirstReload.current = false
      return
    }
    void load(1)
    // category and sort intentionally trigger one stable reload path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sort])

  function requireLogin() {
    if (isAuthenticated) return true
    router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
    return false
  }

  async function handleAspirin(record: ClinicPublicRecord) {
    if (!requireLogin()) return
    const active = record.viewerHasAspirin
    setData((current) => ({ ...current, items: current.items.map((item) => item.id === record.id ? { ...item, viewerHasAspirin: !active, aspirinCount: Math.max(0, item.aspirinCount + (active ? -1 : 1)) } : item) }))
    try {
      const response = await fetch(`/api/clinic/records/${record.id}/aspirin`, { method: active ? 'DELETE' : 'POST' })
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: { count?: number }; message?: string }
      if (!response.ok || !body?.ok) throw new Error(body?.message || '药效没有记录下来，请稍后再试。')
      if (typeof body.data?.count === 'number') setData((current) => ({ ...current, items: current.items.map((item) => item.id === record.id ? { ...item, aspirinCount: body.data!.count! } : item) }))
    } catch (requestError) {
      await load(data.page)
      setError(requestError instanceof Error ? requestError.message : '药效没有记录下来，请稍后再试。')
    }
  }

  function changeCategory(next: ClinicCategory | undefined) {
    setCategory(next)
  }

  return (
    <main className="clinic-page-shell">
      <header className="clinic-hero">
        <div className="clinic-hero-copy">
          <p className="clinic-kicker"><UiIcon name="stethoscope" /> EASON FANS CLUB · COMMUNITY CLINIC</p>
          <h1>阿士匹灵门诊部</h1>
          <p>今日有咩唔舒服？入嚟坐低讲。</p>
          <div className="clinic-hero-actions">
            <Link href="/clinic/new" className="clinic-primary-button"><span aria-hidden="true">＋</span> 我要挂号</Link>
            <Link href="/clinic/daily-report" className="clinic-text-link">今日门诊 →</Link>
            {isAuthenticated ? <Link href="/clinic/me" className="clinic-text-link">我的门诊 →</Link> : <Link href="/login?redirect=%2Fclinic" className="clinic-text-link">登录后参与互动 →</Link>}
          </div>
        </div>
        <div className="clinic-hero-mark" aria-hidden="true"><UiIcon name="stethoscope" /><span>DROP IN<br />SIT DOWN</span></div>
      </header>

      <nav className="clinic-category-nav" aria-label="门诊分类">
        <button type="button" className={!category ? 'is-active' : ''} onClick={() => changeCategory(undefined)}>候诊大厅</button>
        {clinicCategoryOptions.map((item) => <button type="button" key={item.value} className={category === item.value ? 'is-active' : ''} onClick={() => changeCategory(item.value)}>{item.label}</button>)}
      </nav>

      <section className="clinic-toolbar" aria-label="病历排序">
        <div><p className="clinic-kicker">WAITING ROOM</p><h2>{category ? clinicCategoryOptions.find((item) => item.value === category)?.label : '候诊大厅'}</h2></div>
        <div className="clinic-sort-tabs" role="tablist" aria-label="病历排序">
          {([['latest', '最新'], ['consultations', '最多人会诊'], ['aspirin', '最多阿士匹灵']] as const).map(([value, label]) => <button type="button" key={value} role="tab" aria-selected={sort === value} className={sort === value ? 'is-active' : ''} onClick={() => setSort(value)}>{label}</button>)}
        </div>
      </section>

      {error ? <div className="clinic-error-state" role="alert">{error}<button type="button" onClick={() => void load(data.page)}>重试</button></div> : null}
      {loading && !data.items.length ? <div className="clinic-loading-state">正在读取候诊记录…</div> : null}
      {!loading && !data.items.length ? <section className="clinic-empty-state"><UiIcon name="stethoscope" /><p>今天这里还没有患者挂号。</p><Link href="/clinic/new" className="clinic-secondary-button">来做第一位患者</Link></section> : null}
      <section className="clinic-record-list" aria-live="polite">
        {data.items.map((record) => <ClinicRecordCard key={record.id} record={record} isAuthenticated={isAuthenticated} onAspirin={(item) => void handleAspirin(item)} onReport={(target) => { if (requireLogin()) setReportTarget(target) }} />)}
      </section>
      {data.totalPages > 1 ? <Pagination currentPage={data.page} totalPages={data.totalPages} onPageChange={(page) => void load(page)} disabled={loading} ariaLabel="门诊病历分页" className="clinic-pagination" /> : null}

      <footer className="clinic-disclaimer">阿士匹灵门诊部是病友交流与情绪树洞，不提供专业医疗或心理诊断。如遇真实身体或心理健康问题，请及时寻求专业帮助。</footer>
      {reportTarget ? <ClinicReportDialog target={reportTarget} onClose={() => setReportTarget(null)} /> : null}
    </main>
  )
}
