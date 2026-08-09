'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type AdminSticker = {
  id: string
  name: string | null
  url: string
  type: 'STATIC' | 'GIF'
  usageCount: number
  isHidden: boolean
  enabled: boolean
  isOfficial: boolean
  category: string | null
  packName: string
  creator: { id: string; nickname: string; uid: number } | null
  reportCount: number
  createdAt: string
}

type StickerReport = {
  id: string
  reason: string
  detail: string | null
  status: 'PENDING' | 'HIDDEN' | 'DISMISSED'
  createdAt: string
  reporter: { id: string; nickname: string; uid: number } | null
}

type FilterKey = 'ALL' | 'USER' | 'OFFICIAL' | 'REPORTED' | 'HIDDEN'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'OFFICIAL', label: '官方' },
  { key: 'USER', label: '用户上传' },
  { key: 'REPORTED', label: '被举报' },
  { key: 'HIDDEN', label: '已隐藏' },
]

const REPORT_REASON_LABEL: Record<string, string> = {
  PORN: '色情',
  ABUSE: '辱骂',
  VIOLATION: '违规',
  OTHER: '其他',
}

export function StickerAdminManager() {
  const [sub, setSub] = useState<'manage' | 'hot'>('manage')
  const [filter, setFilter] = useState<FilterKey>('ALL')
  const [stickers, setStickers] = useState<AdminSticker[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [hotRange, setHotRange] = useState<'total' | 'week'>('total')
  const [hot, setHot] = useState<{ id: string; name: string | null; url: string; type: 'STATIC' | 'GIF' }[]>([])
  const [hotLoading, setHotLoading] = useState(false)

  const [reportSticker, setReportSticker] = useState<AdminSticker | null>(null)
  const [reports, setReports] = useState<StickerReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)

  const loadStickers = useCallback(async (f: FilterKey) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/stickers?view=stickers&filter=${f}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '加载失败')
      setStickers(Array.isArray(json.stickers) ? json.stickers : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHot = useCallback(async (r: 'total' | 'week') => {
    setHotLoading(true)
    try {
      const res = await fetch(`/api/admin/stickers?view=hot&range=${r}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      setHot(Array.isArray(json.stickers) ? json.stickers : [])
    } catch {
      setHot([])
    } finally {
      setHotLoading(false)
    }
  }, [])

  useEffect(() => {
    if (sub === 'manage') void loadStickers(filter)
    else void loadHot(hotRange)
  }, [sub, filter, hotRange, loadStickers, loadHot])

  async function act(sticker: AdminSticker, action: string, extra?: Record<string, unknown>) {
    setError(null)
    try {
      const res = await fetch(`/api/admin/sticker/${sticker.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '操作失败')
      await loadStickers(filter)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    }
  }

  async function openReports(sticker: AdminSticker) {
    setReportSticker(sticker)
    setReportsLoading(true)
    try {
      const reportsRes = await fetch(`/api/admin/sticker/${sticker.id}/reports`, { cache: 'no-store' })
      const json = await reportsRes.json().catch(() => ({}))
      setReports(Array.isArray(json.reports) ? json.reports : [])
    } catch {
      setReports([])
    } finally {
      setReportsLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSub('manage')} className={tabClass(sub === 'manage')}>表情管理</button>
        <button type="button" onClick={() => setSub('hot')} className={tabClass(sub === 'hot')}>热门排行</button>
      </div>

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null}

      {sub === 'manage' ? (
        <ManagePanel
          filter={filter}
          setFilter={setFilter}
          stickers={stickers}
          loading={loading}
          onAct={act}
          onOpenReports={openReports}
        />
      ) : (
        <HotPanel
          range={hotRange}
          setRange={setHotRange}
          stickers={hot}
          loading={hotLoading}
        />
      )}

      {reportSticker ? (
        <ReportModal
          sticker={reportSticker}
          reports={reports}
          loading={reportsLoading}
          onClose={() => setReportSticker(null)}
          onDismiss={async (reportId) => {
            const res = await fetch(`/api/admin/sticker/${reportSticker.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'dismissReport', reportId, reports: true }),
            })
            const json = await res.json().catch(() => ({}))
            if (res.ok && Array.isArray(json.reports)) setReports(json.reports)
          }}
        />
      ) : null}
    </div>
  )
}

function tabClass(active: boolean) {
  return `rounded-full px-4 py-1.5 text-sm font-black transition ${
    active ? 'bg-brand-600 text-white' : 'bg-white/80 text-slate-600 ring-1 ring-slate-200 hover:bg-white'
  }`
}

function ManagePanel({
  filter,
  setFilter,
  stickers,
  loading,
  onAct,
  onOpenReports,
}: {
  filter: FilterKey
  setFilter: (f: FilterKey) => void
  stickers: AdminSticker[]
  loading: boolean
  onAct: (s: AdminSticker, action: string, extra?: Record<string, unknown>) => void
  onOpenReports: (s: AdminSticker) => void
}) {
  return (
    <div className="space-y-4">
      <OfficialUploadForm onUploaded={() => setFilter('OFFICIAL')} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-black transition ${
              filter === f.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm font-bold text-slate-400">加载中…</p>
      ) : stickers.length === 0 ? (
        <p className="py-8 text-center text-sm font-bold text-slate-400">暂无表情</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {stickers.map((s) => (
            <div key={s.id} className={`rounded-2xl border p-3 ${s.isHidden ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={s.name || '表情'} className="mx-auto h-20 w-20 rounded-lg bg-white object-contain" />
              <div className="mt-2 space-y-1 text-center">
                <p className="truncate text-xs font-black text-slate-700">{s.name || '(未命名)'}</p>
                <p className="text-[10px] font-bold text-slate-400">
                  {s.type === 'GIF' ? '动图' : '静态'} · 使用 {s.usageCount}
                </p>
                <div className="flex flex-wrap justify-center gap-1 text-[10px] font-black">
                  {s.isOfficial ? <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-700">官方</span> : null}
                  {s.isHidden ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-600">已隐藏</span> : null}
                  {!s.enabled ? <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">已下架</span> : null}
                  {s.reportCount > 0 ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">举报 {s.reportCount}</span> : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-1">
                {s.isOfficial && (
                  <button type="button" onClick={() => onAct(s, s.enabled ? 'disable' : 'enable')} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-700">
                    {s.enabled ? '下架' : '上架'}
                  </button>
                )}
                <button type="button" onClick={() => onAct(s, s.isHidden ? 'restore' : 'hide')} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-700">
                  {s.isHidden ? '恢复' : '隐藏'}
                </button>
                {s.reportCount > 0 ? (
                  <button type="button" onClick={() => onOpenReports(s)} className="rounded bg-amber-100 px-2 py-1 text-[11px] font-black text-amber-700">举报</button>
                ) : null}
                <button type="button" onClick={() => onAct(s, 'delete')} className="rounded bg-red-100 px-2 py-1 text-[11px] font-black text-red-600">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OfficialUploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState<'STATIC' | 'GIF'>('STATIC')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setMsg('请选择表情图片')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', name)
      fd.append('category', category)
      fd.append('type', type)
      const res = await fetch('/api/admin/stickers', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '上传失败')
      setFile(null)
      setName('')
      setCategory('')
      if (inputRef.current) inputRef.current.value = ''
      setMsg('官方表情已上传')
      onUploaded()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-sky-100 bg-white p-4">
      <p className="text-sm font-black text-brand-950">上传官方表情</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-slate-600">
          图片（JPG/PNG/APNG/WEBP 或 GIF，≤5MB）
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/apng,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-xs" />
        </label>
        <label className="text-xs font-bold text-slate-600">
          类型
          <select value={type} onChange={(e) => setType(e.target.value as 'STATIC' | 'GIF')} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="STATIC">静态</option>
            <option value="GIF">动图 GIF</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          名称（≤4字，可空）
          <input value={name} maxLength={4} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-bold text-slate-600">
          分类（可空）
          <input value={category} maxLength={40} onChange={(e) => setCategory(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-full bg-brand-600 px-5 py-1.5 text-sm font-black text-white disabled:opacity-50">
          {busy ? '上传中…' : '上传官方表情'}
        </button>
        {msg ? <span className="text-xs font-bold text-slate-500">{msg}</span> : null}
      </div>
    </form>
  )
}

function HotPanel({
  range,
  setRange,
  stickers,
  loading,
}: {
  range: 'total' | 'week'
  setRange: (r: 'total' | 'week') => void
  stickers: { id: string; name: string | null; url: string; type: 'STATIC' | 'GIF' }[]
  loading: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setRange('total')} className={tabClass(range === 'total')}>总使用最多</button>
        <button type="button" onClick={() => setRange('week')} className={tabClass(range === 'week')}>近 7 天</button>
      </div>
      {loading ? (
        <p className="py-8 text-center text-sm font-bold text-slate-400">加载中…</p>
      ) : stickers.length === 0 ? (
        <p className="py-8 text-center text-sm font-bold text-slate-400">暂无数据</p>
      ) : (
        <ol className="space-y-2">
          {stickers.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
              <span className="w-6 text-center text-sm font-black text-brand-700">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={s.name || '表情'} className="h-12 w-12 rounded-lg bg-white object-contain" />
              <span className="text-sm font-bold text-slate-700">{s.name || '(未命名)'}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function ReportModal({
  sticker,
  reports,
  loading,
  onClose,
  onDismiss,
}: {
  sticker: AdminSticker
  reports: StickerReport[]
  loading: boolean
  onClose: () => void
  onDismiss: (reportId: string) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-sky-100 bg-white shadow-xl sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-black text-brand-950">举报记录 · {sticker.name || '表情'}</h3>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm font-black text-slate-400 hover:bg-slate-100">关闭</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {loading ? (
            <p className="py-8 text-center text-sm font-bold text-slate-400">加载中…</p>
          ) : reports.length === 0 ? (
            <p className="py-8 text-center text-sm font-bold text-slate-400">暂无举报</p>
          ) : (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-100 p-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-700">{REPORT_REASON_LABEL[r.reason] || r.reason}</span>
                    <span className="text-[10px] font-bold text-slate-400">{r.status === 'DISMISSED' ? '已忽略' : r.status === 'HIDDEN' ? '已处理' : '待处理'}</span>
                  </div>
                  {r.detail ? <p className="mt-2 text-sm text-slate-600">{r.detail}</p> : null}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">举报人：{r.reporter?.nickname || '匿名'} · {new Date(r.createdAt).toLocaleString()}</span>
                    {r.status === 'PENDING' ? (
                      <button type="button" onClick={() => onDismiss(r.id)} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-700">忽略</button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
