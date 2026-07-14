'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import {
  layoutAlignments,
  layoutDensities,
  layoutSpacings,
  layoutWidths,
  type PageLayoutConfig,
  type PageLayoutDevice,
  type PageLayoutModuleConfig,
  type PageLayoutModuleDefinition,
  type PageLayoutPageKey,
  type SerializedPageLayout,
  type SerializedPageLayoutRevision,
} from '@/lib/page-layout/types'

type PreviewModulePayload = { ok: true; data: unknown } | { ok: false; message: string }
type PreviewPayload = {
  pageKey: PageLayoutPageKey
  generatedAt: string
  modules: Record<string, PreviewModulePayload>
}

const pageOptions: { key: PageLayoutPageKey; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'checkin', label: '每日挂号' },
  { key: 'admin-home', label: '管理后台首页' },
]

function cloneConfig(config: PageLayoutConfig): PageLayoutConfig {
  return {
    desktop: config.desktop.map((item) => ({ ...item })),
    mobile: config.mobile.map((item) => ({ ...item })),
  }
}

function normalizeOrder(items: PageLayoutModuleConfig[]) {
  return items.map((item, index) => ({ ...item, order: (index + 1) * 10 }))
}

function findModule(registry: PageLayoutModuleDefinition[], key: string) {
  return registry.find((item) => item.key === key)
}

function formatDate(value: string | null) {
  if (!value) return '尚未发布'
  return new Date(value).toLocaleString('zh-CN')
}

function readArray(data: unknown) {
  return Array.isArray(data) ? data : []
}

function readObject(data: unknown) {
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

function getModulePreview(preview: PreviewPayload | null, key: string): PreviewModulePayload | null {
  return preview?.modules?.[key] || null
}

function PreviewFallback({ payload }: { payload: PreviewModulePayload | null }) {
  if (payload?.ok === false) {
    return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">{payload.message}</p>
  }
  return <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-slate-500">暂无可预览数据</p>
}

function renderPreviewContent(item: PageLayoutModuleConfig, definition: PageLayoutModuleDefinition | undefined, payload: PreviewModulePayload | null) {
  const title = item.title || definition?.name || item.key
  const subtitle = item.subtitle || definition?.description
  const data = payload?.ok ? payload.data : null

  if (item.key === 'home.hero') {
    const slides = readArray(readObject(data).slides)
    const first = readObject(slides[0])
    return (
      <div className="layout-card rounded-2xl border border-sky-100 bg-brand-950 text-white shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-100">Preview Mode</p>
        <h3 className="mt-3 text-2xl font-black">{item.title || String(first.title || title)}</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-sky-50">{item.subtitle || String(first.subtitle || subtitle || '')}</p>
        <button disabled className="mt-4 rounded-full bg-white/20 px-4 py-2 text-sm font-black text-white">预览中不可操作</button>
      </div>
    )
  }

  if (item.key.includes('Posts')) {
    const posts = readArray(data).slice(0, 3)
    return (
      <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
        <h3 className="text-xl font-black text-brand-950">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm font-bold text-slate-500">{subtitle}</p> : null}
        <div className="mt-4 grid gap-2">
          {posts.map((post, index) => {
            const record = readObject(post)
            return <p key={String(record.id || index)} className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-slate-700">{String(record.title || '未命名帖子')}</p>
          })}
          {!posts.length ? <PreviewFallback payload={payload} /> : null}
        </div>
      </div>
    )
  }

  if (item.key === 'home.dailyMessages' || item.key === 'checkin.messages') {
    const messages = readArray(data).slice(0, 3)
    return (
      <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
        <h3 className="text-xl font-black text-brand-950">{title}</h3>
        <div className="mt-4 grid gap-2">
          {messages.map((message, index) => {
            const record = readObject(message)
            return <p key={String(record.id || index)} className="line-clamp-2 rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-slate-700">{String(record.content || record.message || '留言内容')}</p>
          })}
          {!messages.length ? <PreviewFallback payload={payload} /> : null}
        </div>
      </div>
    )
  }

  if (item.key === 'checkin.stats' || item.key === 'admin.stats') {
    const record = readObject(data)
    const values = Object.entries(record).slice(0, 6)
    return (
      <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
        <h3 className="text-xl font-black text-brand-950">{title}</h3>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {values.map(([label, value]) => (
            <div key={label} className="rounded-xl bg-sky-50 px-3 py-2">
              <p className="text-xs font-black text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-black text-brand-950">{String(value ?? 0)}</p>
            </div>
          ))}
          {!values.length ? <PreviewFallback payload={payload} /> : null}
        </div>
      </div>
    )
  }

  if (item.key === 'checkin.formOrMood') {
    return (
      <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
        <h3 className="text-xl font-black text-brand-950">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm font-bold text-slate-500">{subtitle}</p> : null}
        <button disabled className="mt-4 rounded-full bg-slate-200 px-4 py-2 text-sm font-black text-slate-500">挂号按钮在预览中禁用</button>
      </div>
    )
  }

  if (item.key === 'admin.registrationStatus') {
    const record = readObject(data)
    return (
      <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
        <h3 className="text-xl font-black text-brand-950">{title}</h3>
        <p className="mt-3 text-sm font-bold text-slate-600">注册模式：{String(record.registrationModeLabel || record.registrationMode || '未知')}</p>
        <p className="mt-1 text-sm font-bold text-slate-600">注册开关：{record.allowRegister ? '允许注册' : '关闭注册'}</p>
      </div>
    )
  }

  if (item.key === 'home.music' || item.key === 'home.culture') {
    const rows = readArray(data).slice(0, 3)
    return (
      <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
        <h3 className="text-xl font-black text-brand-950">{title}</h3>
        <div className="mt-4 grid gap-2">
          {rows.map((row, index) => {
            const record = readObject(row)
            return <p key={String(record.id || index)} className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-slate-700">{String(record.title || '预览条目')}</p>
          })}
          {!rows.length ? <PreviewFallback payload={payload} /> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="layout-card rounded-2xl border border-sky-100 bg-white shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">{item.key}</p>
      <h3 className="mt-2 text-xl font-black text-brand-950">{title}</h3>
      {subtitle ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{subtitle}</p> : null}
      {payload?.ok === false ? <div className="mt-3"><PreviewFallback payload={payload} /></div> : null}
    </div>
  )
}

export function LayoutEditorClient({ initialPage }: { initialPage: PageLayoutPageKey }) {
  const [pageKey, setPageKeyState] = useState<PageLayoutPageKey>(initialPage)
  const [device, setDevice] = useState<PageLayoutDevice>('desktop')
  const [layout, setLayout] = useState<SerializedPageLayout | null>(null)
  const [workingConfig, setWorkingConfig] = useState<PageLayoutConfig | null>(null)
  const [previewData, setPreviewData] = useState<PreviewPayload | null>(null)
  const [revisions, setRevisions] = useState<SerializedPageLayoutRevision[]>([])
  const [selectedRevision, setSelectedRevision] = useState<SerializedPageLayoutRevision | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [draggingKey, setDraggingKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  function loadRevisions(nextPageKey: PageLayoutPageKey) {
    fetch(`/api/admin/page-layouts/${nextPageKey}/revisions?limit=20`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.message || '加载版本历史失败')
        setRevisions(data.revisions || [])
      })
      .catch(() => setRevisions([]))
  }

  useEffect(() => {
    setMessage('')
    setError('')
    setLayout(null)
    setWorkingConfig(null)
    setPreviewData(null)
    setSelectedRevision(null)
    setIsDirty(false)

    fetch(`/api/admin/page-layouts/${pageKey}`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.message || '加载布局失败')
        setLayout(data)
        setWorkingConfig(cloneConfig(data.draftConfig))
        setSelectedKey(data.draftConfig.desktop?.[0]?.key || '')
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '加载布局失败'))

    fetch(`/api/admin/page-layouts/${pageKey}/preview`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.message || '加载预览数据失败')
        setPreviewData(data)
      })
      .catch(() => setPreviewData(null))

    loadRevisions(pageKey)
  }, [pageKey])

  const previewConfig = selectedRevision?.config || workingConfig
  const modules = useMemo(
    () => (workingConfig ? [...workingConfig[device]].sort((a, b) => a.order - b.order) : []),
    [workingConfig, device],
  )
  const previewModules = useMemo(
    () => (previewConfig ? [...previewConfig[device]].filter((item) => item.visible).sort((a, b) => a.order - b.order) : []),
    [previewConfig, device],
  )
  const selected = modules.find((item) => item.key === selectedKey) || modules[0]
  const selectedModule = selected ? findModule(layout?.registry || [], selected.key) : null

  useEffect(() => {
    if (modules.length && !modules.some((item) => item.key === selectedKey)) {
      setSelectedKey(modules[0].key)
    }
  }, [modules, selectedKey])

  function setPageKey(nextPageKey: PageLayoutPageKey) {
    if (nextPageKey === pageKey) return
    if (isDirty && !window.confirm('当前草稿有未保存修改，切换页面会丢失这些本地修改。继续切换吗？')) return
    setPageKeyState(nextPageKey)
  }

  function updateDeviceItems(updater: (items: PageLayoutModuleConfig[]) => PageLayoutModuleConfig[]) {
    setSelectedRevision(null)
    setIsDirty(true)
    setWorkingConfig((current) => current ? { ...current, [device]: updater([...current[device]].sort((a, b) => a.order - b.order)) } : current)
  }

  function updateSelected(patch: Partial<PageLayoutModuleConfig>) {
    if (!selected) return
    updateDeviceItems((items) => items.map((item) => (item.key === selected.key ? { ...item, ...patch } : item)))
  }

  function moveModule(key: string, direction: -1 | 1) {
    updateDeviceItems((items) => {
      const index = items.findIndex((item) => item.key === key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= items.length) return items
      const next = [...items]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return normalizeOrder(next)
    })
  }

  function dropModule(targetKey: string) {
    if (!draggingKey || draggingKey === targetKey) return
    updateDeviceItems((items) => {
      const from = items.findIndex((item) => item.key === draggingKey)
      const to = items.findIndex((item) => item.key === targetKey)
      if (from < 0 || to < 0) return items
      const next = [...items]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return normalizeOrder(next)
    })
    setDraggingKey('')
  }

  async function submit(url: string, method: 'PUT' | 'POST', successMessage: string, config = workingConfig) {
    if (!layout || !config) return
    setIsSaving(true)
    setMessage('')
    setError('')
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: layout.version, config }),
    })
    const data = await response.json().catch(() => null)
    setIsSaving(false)
    if (!response.ok) {
      setError(data?.message || '操作失败')
      return
    }
    setLayout(data)
    setWorkingConfig(cloneConfig(data.draftConfig))
    setSelectedRevision(null)
    setIsDirty(false)
    setMessage(data.message || successMessage)
    loadRevisions(pageKey)
  }

  async function restoreRevision(revision: SerializedPageLayoutRevision, publish: boolean) {
    if (!layout) return
    const confirmed = window.confirm(publish ? `确认将 v${revision.version} 恢复并发布为新版本吗？` : `确认将 v${revision.version} 恢复到草稿吗？`)
    if (!confirmed) return
    await submit(
      `/api/admin/page-layouts/${pageKey}/revisions/${revision.id}/${publish ? 'publish' : 'restore-draft'}`,
      'POST',
      publish ? '历史版本已恢复并发布' : '历史版本已恢复为草稿',
      revision.config,
    )
  }

  if (!workingConfig || !layout) {
    return (
      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-6 text-sm font-black text-slate-600 shadow-sm">
        {error || '正在加载布局编辑器...'}
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Layout Editor</p>
            <h1 className="mt-1 text-3xl font-black text-brand-950">页面布局编辑器</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={isSaving || !isDirty} onClick={() => { setWorkingConfig(cloneConfig(layout.draftConfig)); setSelectedRevision(null); setIsDirty(false) }} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50">撤销未保存</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/reset`, 'POST', '已恢复默认草稿', layout.defaults)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">恢复默认草稿</button>
            <button disabled={isSaving} onClick={() => submit(`/api/admin/page-layouts/${pageKey}/draft`, 'PUT', '草稿已保存')} className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">保存草稿</button>
            <button
              disabled={isSaving}
              onClick={() => {
                if (window.confirm('发布后将立即影响前台页面，确认发布当前草稿吗？')) {
                  submit(`/api/admin/page-layouts/${pageKey}/publish`, 'POST', '布局已发布')
                }
              }}
              className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white"
            >
              发布
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm font-bold text-slate-600 md:grid-cols-4">
          <p>当前版本：{layout.version}{isDirty ? '（本地未保存）' : ''}</p>
          <p>发布时间：{formatDate(layout.publishedAt)}</p>
          <p>最近修改：{formatDate(layout.updatedAt)}</p>
          <p>当前设备：{device === 'desktop' ? '桌面端' : '移动端'}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {pageOptions.map((item) => (
            <button key={item.key} onClick={() => setPageKey(item.key)} className={`rounded-full px-4 py-2 text-sm font-black ${pageKey === item.key ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{item.label}</button>
          ))}
          {(['desktop', 'mobile'] as const).map((item) => (
            <button key={item} onClick={() => setDevice(item)} className={`rounded-full px-4 py-2 text-sm font-black ${device === item ? 'bg-brand-700 text-white' : 'bg-sky-50 text-brand-700'}`}>{item === 'desktop' ? '桌面端' : '移动端'}</button>
          ))}
        </div>

        {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
          <h2 className="text-lg font-black text-brand-950">模块列表</h2>
          <div className="mt-4 grid gap-2">
            {modules.map((item, index) => {
              const definition = findModule(layout.registry, item.key)
              return (
                <button
                  key={item.key}
                  draggable
                  onDragStart={() => setDraggingKey(item.key)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropModule(item.key)}
                  onClick={() => { setSelectedKey(item.key); setSelectedRevision(null) }}
                  className={`rounded-2xl border px-3 py-3 text-left transition ${selected?.key === item.key ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white hover:bg-sky-50/70'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-brand-950">{definition?.name || item.key}</span>
                    <span className="text-xs font-black text-slate-400">#{index + 1}</span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">{item.visible ? '显示' : '隐藏'} · {item.width} · {item.gapTop}/{item.gapBottom}</p>
                  <div className="mt-2 flex gap-2">
                    <span role="button" onClick={(event) => { event.stopPropagation(); moveModule(item.key, -1) }} className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">上移</span>
                    <span role="button" onClick={(event) => { event.stopPropagation(); moveModule(item.key, 1) }} className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">下移</span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="min-h-[620px] rounded-[24px] border border-sky-100 bg-sky-50/70 p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-brand-950">实时预览</h2>
              <p className="mt-1 text-xs font-black text-slate-500">{selectedRevision ? `正在预览历史版本 v${selectedRevision.version}` : '正在预览当前草稿'} · 预览模式不执行写操作</p>
            </div>
            {selectedRevision ? <button onClick={() => setSelectedRevision(null)} className="rounded-full bg-white px-3 py-2 text-xs font-black text-brand-700">返回草稿预览</button> : null}
          </div>
          <div className={`mx-auto flex flex-wrap gap-x-4 rounded-[22px] bg-white/78 p-4 ${device === 'mobile' ? 'max-w-sm' : 'max-w-6xl'}`}>
            {previewModules.map((item) => {
              const definition = findModule(layout.registry, item.key)
              return (
                <PageLayoutFrame key={item.key} config={item}>
                  {renderPreviewContent(item, definition, getModulePreview(previewData, item.key))}
                </PageLayoutFrame>
              )
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
            <h2 className="text-lg font-black text-brand-950">属性面板</h2>
            {selected && selectedModule ? (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-sm font-black text-brand-950">{selectedModule.name}</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{selectedModule.description}</p>
                </div>

                <label className="flex items-center gap-2 text-sm font-black text-slate-600">
                  <input type="checkbox" checked={selected.visible} disabled={selectedModule.required} onChange={(event) => updateSelected({ visible: event.target.checked })} />
                  显示模块{selectedModule.required ? '（核心模块）' : ''}
                </label>

                <SelectField label="宽度" value={selected.width} options={layoutWidths.filter((item) => selectedModule.allowedWidths.includes(item))} onChange={(value) => updateSelected({ width: value as PageLayoutModuleConfig['width'] })} />
                <SelectField label="上间距" value={selected.gapTop} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} onChange={(value) => updateSelected({ gapTop: value as PageLayoutModuleConfig['gapTop'] })} />
                <SelectField label="下间距" value={selected.gapBottom} options={layoutSpacings.filter((item) => selectedModule.allowedSpacing.includes(item))} onChange={(value) => updateSelected({ gapBottom: value as PageLayoutModuleConfig['gapBottom'] })} />
                <SelectField label="对齐" value={selected.alignment} options={layoutAlignments} onChange={(value) => updateSelected({ alignment: value as PageLayoutModuleConfig['alignment'] })} />
                <SelectField label="密度" value={selected.density} options={layoutDensities} onChange={(value) => updateSelected({ density: value as PageLayoutModuleConfig['density'] })} />

                {selectedModule.supportsTitle ? (
                  <label className="block">
                    <span className="text-sm font-black text-slate-600">标题</span>
                    <input value={selected.title || ''} maxLength={60} onChange={(event) => updateSelected({ title: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-bold outline-none" />
                  </label>
                ) : null}

                {selectedModule.supportsSubtitle ? (
                  <label className="block">
                    <span className="text-sm font-black text-slate-600">副标题</span>
                    <textarea value={selected.subtitle || ''} maxLength={160} onChange={(event) => updateSelected({ subtitle: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-bold outline-none" />
                  </label>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm font-bold text-slate-500">请选择一个模块。</p>
            )}
          </section>

          <section className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
            <h2 className="text-lg font-black text-brand-950">版本历史</h2>
            <div className="mt-4 grid gap-2">
              {revisions.map((revision) => (
                <div key={revision.id} className={`rounded-2xl border p-3 ${selectedRevision?.id === revision.id ? 'border-brand-700 bg-sky-50' : 'border-sky-100 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-brand-950">v{revision.version} · {revision.source}</p>
                    <button onClick={() => setSelectedRevision(revision)} className="rounded-full bg-white px-2 py-1 text-xs font-black text-brand-700">预览</button>
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-500">{formatDate(revision.createdAt)} · {revision.publishedByName || '未知管理员'}</p>
                  {revision.note ? <p className="mt-1 text-xs font-bold text-slate-500">{revision.note}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button disabled={isSaving} onClick={() => restoreRevision(revision, false)} className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-brand-700">恢复到草稿</button>
                    <button disabled={isSaving} onClick={() => restoreRevision(revision, true)} className="rounded-full bg-brand-950 px-3 py-1.5 text-xs font-black text-white">恢复并发布</button>
                  </div>
                </div>
              ))}
              {!revisions.length ? <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-slate-500">暂无发布历史，首次发布后会生成版本记录。</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-600">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none">
        {options.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  )
}
